const PROTHEUS_URLS = Object.freeze(['https://erp.positiva.com.br/*', 'https://erp-corretora.positiva.com.br/*']);
const DEBUGGER_VERSION = '1.3';
const CONTENT_VERSION = '5.7.8';
const REASSERT_INTERVAL_MS = 10000;
const protectionSessions = new Map();
const recorderSessions = new Map();
// Alias mantido apenas para compatibilidade de diagnóstico/testes antigos; a UI agora usa o Gravador Geral.
const filterCaptureSessions = recorderSessions;
const RECORDER_MAX_NETWORK_EVENTS = 4000;
const RECORDER_MAX_TEXT = 30000;

function truncateCaptureText(value, maxLength) {
  const text = String(value == null ? '' : value);
  const limit = Math.max(100, Number(maxLength) || RECORDER_MAX_TEXT);
  return text.length > limit ? text.slice(0, limit) + `\n...[TRUNCATED ${text.length - limit} chars]` : text;
}

function sanitizeCaptureHeaders(headers) {
  const source = headers && typeof headers === 'object' ? headers : {};
  const result = {};
  const sensitive = /^(authorization|proxy-authorization|cookie|set-cookie|x-csrf-token|x-xsrf-token|x-auth-token|sec-websocket-protocol)$/i;
  for (const [name, value] of Object.entries(source)) {
    result[name] = sensitive.test(String(name || '')) ? '[REDACTED]' : truncateCaptureText(value, 2000);
  }
  return result;
}

function sanitizeCapturePayloadText(value) {
  let text = truncateCaptureText(value, RECORDER_MAX_TEXT);
  try {
    text = text
      .replace(/((?:password|passwd|senha|token|secret|authorization|api[_-]?key|session[_-]?key)\s*[=:]\s*)([^&\s,;}]+)/gi, '$1[REDACTED]')
      .replace(/(["'](?:password|passwd|senha|token|secret|authorization|api[_-]?key|session[_-]?key)["']\s*:\s*["'])([^"']*)(["'])/gi, '$1[REDACTED]$3');
  } catch (_) {}
  return text;
}

function sanitizeCaptureUrl(value) {
  const text = truncateCaptureText(value, 12000);
  try {
    const url = new URL(text);
    for (const name of Array.from(url.searchParams.keys())) {
      if (/password|passwd|senha|token|secret|authorization|api[_-]?key|session[_-]?key/i.test(name)) url.searchParams.set(name, '[REDACTED]');
    }
    return url.toString();
  } catch (_) {
    return sanitizeCapturePayloadText(text);
  }
}

function pushRecorderNetworkEvent(tabId, method, params) {
  const session = recorderSessions.get(tabId);
  if (!session || session.events.length >= RECORDER_MAX_NETWORK_EVENTS) {
    if (session && session.events.length >= RECORDER_MAX_NETWORK_EVENTS) session.truncated = true;
    return;
  }
  const p = params || {};
  let data = null;

  if (method === 'Network.requestWillBeSent') {
    const request = p.request || {};
    data = {
      requestId: String(p.requestId || ''),
      resourceType: String(p.type || ''),
      url: sanitizeCaptureUrl(request.url || ''),
      method: String(request.method || ''),
      headers: sanitizeCaptureHeaders(request.headers),
      postData: sanitizeCapturePayloadText(request.postData || ''),
      hasPostData: request.hasPostData === true,
      initiatorType: String(p.initiator && p.initiator.type || ''),
      cdpTimestamp: Number(p.timestamp || 0)
    };
  } else if (method === 'Network.responseReceived') {
    const response = p.response || {};
    data = {
      requestId: String(p.requestId || ''),
      resourceType: String(p.type || ''),
      url: sanitizeCaptureUrl(response.url || ''),
      status: Number(response.status || 0),
      statusText: String(response.statusText || ''),
      mimeType: String(response.mimeType || ''),
      cdpTimestamp: Number(p.timestamp || 0)
    };
  } else if (method === 'Network.webSocketCreated') {
    data = { requestId: String(p.requestId || ''), url: sanitizeCaptureUrl(p.url || '') };
  } else if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived') {
    const response = p.response || {};
    data = {
      requestId: String(p.requestId || ''),
      opcode: Number(response.opcode || 0),
      mask: response.mask === true,
      payloadData: sanitizeCapturePayloadText(response.payloadData || ''),
      cdpTimestamp: Number(p.timestamp || 0)
    };
  } else if (method === 'Network.webSocketClosed') {
    data = { requestId: String(p.requestId || ''), cdpTimestamp: Number(p.timestamp || 0) };
  } else if (method === 'Network.loadingFailed') {
    data = {
      requestId: String(p.requestId || ''),
      resourceType: String(p.type || ''),
      errorText: String(p.errorText || ''),
      canceled: p.canceled === true,
      cdpTimestamp: Number(p.timestamp || 0)
    };
  }

  if (!data) return;
  session.events.push({ at: new Date().toISOString(), method, data });
}

async function startRecorder(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('A aba do Protheus não pôde ser identificada.');
  if (recorderSessions.has(tabId)) {
    const current = recorderSessions.get(tabId);
    return { ok: true, active: true, startedAt: current.startedAt, eventCount: current.events.length };
  }

  const hadProtection = protectionSessions.has(tabId);
  if (!hadProtection) await startProtection(tabId);
  else await reassertProtection(tabId);

  try {
    await sendCdp(tabId, 'Network.enable', { maxPostDataSize: RECORDER_MAX_TEXT });
  } catch (error) {
    if (!hadProtection) { try { await stopProtection(tabId); } catch (_) {} }
    throw error;
  }

  const session = {
    tabId,
    startedAt: new Date().toISOString(),
    startedProtectionForRecorder: !hadProtection,
    events: [],
    truncated: false
  };
  recorderSessions.set(tabId, session);
  return { ok: true, active: true, startedAt: session.startedAt, eventCount: 0 };
}

async function captureRecorderScreenshot(tabId, eventId, reason) {
  if (!Number.isInteger(tabId)) throw new Error('A aba do Protheus não pôde ser identificada.');
  if (!recorderSessions.has(tabId)) throw new Error('O Gravador Geral não está ativo nesta aba.');
  if (!protectionSessions.has(tabId)) await startProtection(tabId);
  else await reassertProtection(tabId);
  const result = await sendCdp(tabId, 'Page.captureScreenshot', {
    format: 'jpeg',
    quality: 68,
    fromSurface: true,
    captureBeyondViewport: false
  });
  return {
    ok: true,
    at: new Date().toISOString(),
    eventId: String(eventId || ''),
    reason: String(reason || ''),
    format: 'jpeg',
    data: String(result && result.data || '')
  };
}

async function stopRecorder(tabId, options) {
  if (!Number.isInteger(tabId)) throw new Error('A aba do Protheus não pôde ser identificada.');
  const session = recorderSessions.get(tabId);
  if (!session) return { ok: false, active: false, error: 'Nenhuma gravação geral está ativa.' };
  recorderSessions.delete(tabId);

  try { await sendCdp(tabId, 'Network.disable', {}); } catch (_) {}
  const keepProtection = !!(options && options.keepProtection);
  if (!keepProtection && protectionSessions.has(tabId)) {
    try { await stopProtection(tabId); } catch (_) {}
  }

  return {
    ok: true,
    active: false,
    startedAt: session.startedAt,
    stoppedAt: new Date().toISOString(),
    eventCount: session.events.length,
    truncated: session.truncated === true || session.events.length >= RECORDER_MAX_NETWORK_EVENTS,
    events: session.events
  };
}

// Compatibilidade com o antigo capturador de filtro.
async function startFilterCapture(tabId) { return startRecorder(tabId); }
async function stopFilterCapture(tabId) { return stopRecorder(tabId, {}); }


async function isCurrentContentVersionLoaded(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (version) => {
        try {
          return !!(window.__PosProtheusContentRuntime &&
            window.__PosProtheusContentRuntime.initialized === true &&
            window.__PosProtheusContentRuntime.version === version);
        } catch (_) {
          return false;
        }
      },
      args: [CONTENT_VERSION]
    });
    return !!(results && results[0] && results[0].result === true);
  } catch (_) {
    return false;
  }
}

async function injectIntoOpenProtheus() {
  let tabs = [];

  try {
    tabs = await chrome.tabs.query({ url: PROTHEUS_URLS });
  } catch (_) {
    return;
  }

  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      const alreadyLoaded = await isCurrentContentVersionLoaded(tab.id);
      if (alreadyLoaded) continue;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['diagnostic.js', 'automation.js', 'content.js']
      });
    } catch (_) {
      // Algumas telas internas do PWA podem nao aceitar injecao durante transicoes.
    }
  }
}

function getTarget(tabId) {
  return { tabId };
}

function normalizeError(error) {
  const message = error && error.message ? String(error.message) : String(error || 'Erro desconhecido');
  if (/another debugger|already attached|devtools/i.test(message)) {
    return 'O Edge não permitiu anexar a proteção porque outro depurador/DevTools já está ligado ao Protheus. Feche o DevTools dessa tela e tente novamente.';
  }
  return message;
}

async function sendCdp(tabId, method, params) {
  return chrome.debugger.sendCommand(getTarget(tabId), method, params || {});
}

async function dispatchTrustedClick(tabId, x, y) {
  if (!Number.isInteger(tabId)) throw new Error('A aba do Protheus não pôde ser identificada.');
  const clientX = Number(x);
  const clientY = Number(y);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    throw new Error('Coordenadas inválidas para o clique confiável.');
  }

  if (!protectionSessions.has(tabId)) await startProtection(tabId);
  else await reassertProtection(tabId);

  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: clientX,
    y: clientY,
    button: 'none',
    buttons: 0
  });
  const rendererSettled = await yieldRendererInputTurn(tabId);
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: clientX,
    y: clientY,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: clientX,
    y: clientY,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });

  return { ok: true, trusted: true, rendererSettled, x: clientX, y: clientY };
}


async function dispatchTrustedDoubleClick(tabId, x, y) {
  if (!Number.isInteger(tabId)) throw new Error('A aba do Protheus não pôde ser identificada.');
  const clientX = Number(x);
  const clientY = Number(y);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    throw new Error('Coordenadas inválidas para o duplo clique confiável.');
  }

  if (!protectionSessions.has(tabId)) await startProtection(tabId);
  else await reassertProtection(tabId);

  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: clientX, y: clientY, button: 'none', buttons: 0
  });
  const rendererSettled = await yieldRendererInputTurn(tabId);
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: clientX, y: clientY, button: 'left', buttons: 1, clickCount: 1
  });
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: clientX, y: clientY, button: 'left', buttons: 0, clickCount: 1
  });
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: clientX, y: clientY, button: 'left', buttons: 1, clickCount: 2
  });
  await sendCdp(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: clientX, y: clientY, button: 'left', buttons: 0, clickCount: 2
  });

  return { ok: true, trusted: true, rendererSettled, doubleClick: true, x: clientX, y: clientY };
}

async function yieldRendererInputTurn(tabId) {
  try {
    await sendCdp(tabId, 'Runtime.evaluate', {
      expression: 'new Promise(resolve => setTimeout(resolve, 0))',
      awaitPromise: true,
      returnByValue: true
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function dispatchTrustedKey(tabId, key) {
  if (!Number.isInteger(tabId)) throw new Error('A aba do Protheus não pôde ser identificada.');
  const normalized = String(key || '').trim();
  let keyInfo = normalized === 'F2'
    ? { key: 'F2', code: 'F2', windowsVirtualKeyCode: 113, nativeVirtualKeyCode: 113 }
    : normalized === 'Enter'
      ? { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
      : normalized === 'Tab'
        ? { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 }
        : normalized === 'ArrowDown'
          ? { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 }
          : null;
  const printable = normalized.length === 1;
  if (!keyInfo && printable) {
    const ch = normalized;
    const upper = ch.toUpperCase();
    const isDigit = /^[0-9]$/.test(ch);
    const isLetter = /^[A-Z]$/.test(upper);
    const vk = isDigit ? ch.charCodeAt(0) : (isLetter ? upper.charCodeAt(0) : ch.charCodeAt(0));
    keyInfo = {
      key: ch,
      code: isDigit ? ('Digit' + ch) : (isLetter ? ('Key' + upper) : ''),
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk
    };
  }
  if (!keyInfo) throw new Error('Tecla confiável não suportada: ' + normalized);

  if (!protectionSessions.has(tabId)) await startProtection(tabId);
  else await reassertProtection(tabId);

  await sendCdp(tabId, 'Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, keyInfo));
  if (printable) {
    await sendCdp(tabId, 'Input.dispatchKeyEvent', Object.assign({ type: 'char', text: normalized, unmodifiedText: normalized }, keyInfo));
  }
  await sendCdp(tabId, 'Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, keyInfo));
  return { ok: true, trusted: true, key: normalized };
}

async function dispatchTrustedText(tabId, text) {
  if (!Number.isInteger(tabId)) throw new Error('A aba do Protheus não pôde ser identificada.');
  const value = String(text == null ? '' : text);

  if (!protectionSessions.has(tabId)) await startProtection(tabId);
  else await reassertProtection(tabId);

  await sendCdp(tabId, 'Input.insertText', { text: value });
  return { ok: true, trusted: true, textLength: value.length };
}

async function readRendererState(tabId) {
  try {
    const response = await sendCdp(tabId, 'Runtime.evaluate', {
      expression: '(() => ({ visibility: document.visibilityState, focus: document.hasFocus(), hidden: document.hidden, now: Date.now() }))()',
      returnByValue: true,
      awaitPromise: false
    });
    const value = response && response.result && response.result.value;
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    return null;
  }
}

async function reassertProtection(tabId) {
  const session = protectionSessions.get(tabId);
  if (!session) return { ok: false, active: false, error: 'Sessão de proteção não encontrada.' };

  try {
    // Primeiro lemos o estado real. Enquanto o Protheus estiver visível, NÃO
    // emulamos foco: isso preserva a interação normal da tela. A emulação só
    // entra quando o Edge realmente marcar a página como hidden.
    const beforeState = await readRendererState(tabId);
    const shouldEmulateFocus = !!(beforeState && (beforeState.visibility === 'hidden' || beforeState.hidden === true));

    // Não usamos comandos que tragam a janela do Edge para frente. O lifecycle
    // permanece ativo e o foco é emulado
    // apenas quando necessário para a execução em segundo plano.
    await sendCdp(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: shouldEmulateFocus });
    await sendCdp(tabId, 'Page.setWebLifecycleState', { state: 'active' });

    session.lastAppliedAt = Date.now();
    session.lastError = '';
    session.focusEmulation = shouldEmulateFocus;
    session.rendererState = await readRendererState(tabId) || beforeState;

    return {
      ok: true,
      active: true,
      attached: true,
      focusEmulation: shouldEmulateFocus,
      lifecycleState: 'active',
      rendererState: session.rendererState,
      lastAppliedAt: session.lastAppliedAt
    };
  } catch (error) {
    session.lastError = normalizeError(error);
    return {
      ok: false,
      active: true,
      attached: true,
      error: session.lastError,
      rendererState: session.rendererState || null
    };
  }
}

async function startProtection(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('A aba do Protheus não pôde ser identificada.');

  const existing = protectionSessions.get(tabId);
  if (existing) {
    const status = await reassertProtection(tabId);
    if (!status.ok) throw new Error(status.error || 'Falha ao reativar a proteção de segundo plano.');
    return status;
  }

  const target = getTarget(tabId);
  try {
    await chrome.debugger.attach(target, DEBUGGER_VERSION);
  } catch (error) {
    throw new Error(normalizeError(error));
  }

  const session = {
    tabId,
    attachedAt: Date.now(),
    lastAppliedAt: 0,
    lastError: '',
    rendererState: null,
    timer: null
  };
  protectionSessions.set(tabId, session);

  try {
    const status = await reassertProtection(tabId);
    if (!status.ok) throw new Error(status.error || 'O Edge não confirmou a proteção de segundo plano.');

    // Uma sessão chrome.debugger ativa mantém o service worker vivo no Chromium moderno.
    // Reaplicamos o estado em baixa frequência para sobreviver a transições internas do PWA.
    session.timer = setInterval(() => reassertProtection(tabId), REASSERT_INTERVAL_MS);
    return status;
  } catch (error) {
    protectionSessions.delete(tabId);
    try { await chrome.debugger.detach(target); } catch (_) {}
    throw error;
  }
}

async function stopProtection(tabId) {
  const session = protectionSessions.get(tabId);
  if (!session) return { ok: true, active: false, detached: true };
  if (recorderSessions.has(tabId)) {
    return { ok: true, active: true, attached: true, detached: false, keptForRecorder: true };
  }

  protectionSessions.delete(tabId);
  if (session.timer) {
    try { clearInterval(session.timer); } catch (_) {}
  }

  const target = getTarget(tabId);
  try { await sendCdp(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: false }); } catch (_) {}
  try { await chrome.debugger.detach(target); } catch (_) {}
  return { ok: true, active: false, detached: true };
}

function getProtectionStatus(tabId) {
  const session = protectionSessions.get(tabId);
  if (!session) return { ok: true, active: false, attached: false };
  return {
    ok: !session.lastError,
    active: true,
    attached: true,
    lastAppliedAt: session.lastAppliedAt,
    error: session.lastError || '',
    rendererState: session.rendererState || null
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'pos-protheus-trusted-click') {
    const tabId = sender && sender.tab && sender.tab.id;
    (async () => {
      try {
        return await dispatchTrustedClick(tabId, message.x, message.y);
      } catch (error) {
        return { ok: false, trusted: false, error: normalizeError(error) };
      }
    })().then(sendResponse, (error) => sendResponse({ ok: false, trusted: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-trusted-double-click') {
    const tabId = sender && sender.tab && sender.tab.id;
    (async () => {
      try {
        return await dispatchTrustedDoubleClick(tabId, message.x, message.y);
      } catch (error) {
        return { ok: false, trusted: false, error: normalizeError(error) };
      }
    })().then(sendResponse, (error) => sendResponse({ ok: false, trusted: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-trusted-key') {
    const tabId = sender && sender.tab && sender.tab.id;
    (async () => {
      try {
        return await dispatchTrustedKey(tabId, message.key);
      } catch (error) {
        return { ok: false, trusted: false, error: normalizeError(error) };
      }
    })().then(sendResponse, (error) => sendResponse({ ok: false, trusted: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-trusted-text') {
    const tabId = sender && sender.tab && sender.tab.id;
    (async () => {
      try {
        return await dispatchTrustedText(tabId, message.text);
      } catch (error) {
        return { ok: false, trusted: false, error: normalizeError(error) };
      }
    })().then(sendResponse, (error) => sendResponse({ ok: false, trusted: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-recorder-start') {
    const tabId = sender && sender.tab && sender.tab.id;
    startRecorder(tabId).then(sendResponse, (error) => sendResponse({ ok: false, active: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-recorder-screenshot') {
    const tabId = sender && sender.tab && sender.tab.id;
    captureRecorderScreenshot(tabId, message.eventId, message.reason).then(sendResponse, (error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-recorder-stop') {
    const tabId = sender && sender.tab && sender.tab.id;
    stopRecorder(tabId, { keepProtection: message.keepProtection === true }).then(sendResponse, (error) => sendResponse({ ok: false, active: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-filter-capture-start') {
    const tabId = sender && sender.tab && sender.tab.id;
    startFilterCapture(tabId).then(sendResponse, (error) => sendResponse({ ok: false, active: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-filter-capture-stop') {
    const tabId = sender && sender.tab && sender.tab.id;
    stopFilterCapture(tabId).then(sendResponse, (error) => sendResponse({ ok: false, active: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-excel-sync') {
    (async () => {
      try {
        const payload = Object.assign({ action: 'syncInternalCommissions' }, message.payload || {});
        return await new Promise((resolve) => {
          chrome.runtime.sendNativeMessage('com.positiva.protheus_excel', payload, (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              resolve({ ok: false, error: lastError.message || 'Falha ao iniciar o helper nativo do Excel.' });
              return;
            }
            resolve(response && typeof response === 'object' ? response : { ok: false, error: 'O helper nativo do Excel não retornou uma resposta válida.' });
          });
        });
      } catch (error) {
        return { ok: false, error: normalizeError(error) };
      }
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-jorge-read') {
    (async () => {
      try {
        const payload = Object.assign({ action: 'readJorgeReimbursementPdf' }, message.payload || {});
        return await new Promise((resolve) => {
          chrome.runtime.sendNativeMessage('com.positiva.protheus_excel', payload, (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              resolve({ ok: false, error: lastError.message || 'Falha ao iniciar o helper nativo para leitura do PDF do Jorge.' });
              return;
            }
            resolve(response && typeof response === 'object' ? response : { ok: false, error: 'O helper nativo não retornou uma resposta válida para o PDF do Jorge.' });
          });
        });
      } catch (error) {
        return { ok: false, error: normalizeError(error) };
      }
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-iss-corretora-read') {
    (async () => {
      try {
        const payload = Object.assign({ action: 'readIssCorretoraPdf' }, message.payload || {});
        return await new Promise((resolve) => {
          chrome.runtime.sendNativeMessage('com.positiva.protheus_excel', payload, (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              resolve({ ok: false, error: lastError.message || 'Falha ao iniciar o helper nativo para leitura do PDF do ISS Corretora.' });
              return;
            }
            resolve(response && typeof response === 'object' ? response : { ok: false, error: 'O helper nativo não retornou uma resposta válida para o PDF do ISS Corretora.' });
          });
        });
      } catch (error) {
        return { ok: false, error: normalizeError(error) };
      }
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-iss-corretora-csv-read') {
    (async () => {
      try {
        const payload = Object.assign({ action: 'readIssCorretoraCsvSources' }, message.payload || {});
        return await new Promise((resolve) => {
          chrome.runtime.sendNativeMessage('com.positiva.protheus_excel', payload, (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              resolve({ ok: false, error: lastError.message || 'Falha ao iniciar o helper nativo para leitura dos CSVs do ISS Corretora.' });
              return;
            }
            resolve(response && typeof response === 'object' ? response : { ok: false, error: 'O helper nativo não retornou uma resposta válida para os CSVs do ISS Corretora.' });
          });
        });
      } catch (error) {
        return { ok: false, error: normalizeError(error) };
      }
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message && message.type === 'pos-protheus-soomar-read') {
    (async () => {
      try {
        const payload = Object.assign({ action: 'readSoomarExpenses' }, message.payload || {});
        return await new Promise((resolve) => {
          chrome.runtime.sendNativeMessage('com.positiva.protheus_excel', payload, (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              resolve({ ok: false, error: lastError.message || 'Falha ao iniciar o helper nativo para leitura do Soomar.' });
              return;
            }
            resolve(response && typeof response === 'object' ? response : { ok: false, error: 'O helper nativo não retornou uma resposta válida para o Soomar.' });
          });
        });
      } catch (error) {
        return { ok: false, error: normalizeError(error) };
      }
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (!message || message.type !== 'pos-protheus-background-protection') return false;
  const tabId = sender && sender.tab && sender.tab.id;

  (async () => {
    try {
      if (message.action === 'start') return await startProtection(tabId);
      if (message.action === 'refresh') return await reassertProtection(tabId);
      if (message.action === 'stop') return await stopProtection(tabId);
      if (message.action === 'status') return getProtectionStatus(tabId);
      throw new Error('Ação de proteção desconhecida.');
    } catch (error) {
      return { ok: false, active: false, error: normalizeError(error) };
    }
  })().then(sendResponse, (error) => sendResponse({ ok: false, active: false, error: normalizeError(error) }));

  return true;
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source && source.tabId;
  if (!Number.isInteger(tabId) || !recorderSessions.has(tabId)) return;
  if (method === 'Network.requestWillBeSent' ||
      method === 'Network.responseReceived' ||
      method === 'Network.webSocketCreated' ||
      method === 'Network.webSocketFrameSent' ||
      method === 'Network.webSocketFrameReceived' ||
      method === 'Network.webSocketClosed' ||
      method === 'Network.loadingFailed') {
    pushRecorderNetworkEvent(tabId, method, params);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source && source.tabId;
  if (!Number.isInteger(tabId)) return;
  const session = protectionSessions.get(tabId);
  if (session && session.timer) {
    try { clearInterval(session.timer); } catch (_) {}
  }
  protectionSessions.delete(tabId);
  recorderSessions.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = protectionSessions.get(tabId);
  if (session && session.timer) {
    try { clearInterval(session.timer); } catch (_) {}
  }
  protectionSessions.delete(tabId);
  recorderSessions.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!protectionSessions.has(tabId)) return;
  if (changeInfo && changeInfo.status === 'complete') reassertProtection(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenProtheus();
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoOpenProtheus();
});

// Também executa quando o service worker nasce após "Recarregar" em edge://extensions.
injectIntoOpenProtheus();

// Export interno apenas para testes Node; não interfere no service worker do Edge.
if (typeof globalThis !== 'undefined') {
  globalThis.__PosProtheusBackground = {
    startProtection,
    stopProtection,
    reassertProtection,
    getProtectionStatus,
    startRecorder,
    stopRecorder,
    captureRecorderScreenshot,
    startFilterCapture,
    stopFilterCapture,
    sanitizeCaptureHeaders,
    sanitizeCapturePayloadText
  };
}
