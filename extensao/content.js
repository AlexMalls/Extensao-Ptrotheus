(() => {
  if (window.top !== window) return;

  const EXTENSION_VERSION = '5.15.7';
  const existingRuntime = window.__PosProtheusContentRuntime;
  const sameVersion = !!(existingRuntime && existingRuntime.initialized === true && existingRuntime.version === EXTENSION_VERSION);
  if (sameVersion) return; // same-version reinjection

  if (existingRuntime && typeof existingRuntime.cleanup === 'function') {
    try { existingRuntime.cleanup('runtime-replaced'); } catch (_) {}
  } else {
    try { if (typeof window.__PosProtheusUiCleanup === 'function') window.__PosProtheusUiCleanup('runtime-replaced'); } catch (_) {}
  }

  const api = window.PosProtheusAutomation;
  const diagnosticApi = window.PosProtheusDiagnostic || {
    EXPECTED_DIRECTORY: 'C:\\Users\\Alexandre Mallorca\\Documents\\Projetos TI\\ProtheusAutomations\\Logs',
    describeEventTarget: () => ({ tag: 'unknown' }),
    sanitizeKeyboardEvent: () => ({ key: '[unknown]', editable: false, ctrl: false, alt: false, shift: false, meta: false }),
    createDiagnosticLogger: () => ({
      init: async () => ({ supported: false, permission: 'unavailable', directoryVerified: false, pendingLines: 0 }),
      authorizeDirectory: async () => { throw new Error('Diagnóstico de arquivo indisponível.'); },
      startRun: async () => null,
      stopRun: async () => null,
      log: () => {},
      flush: async () => false,
      getState: () => ({ supported: false, permission: 'unavailable', directoryVerified: false, pendingLines: 0 }),
      isActive: () => false
    })
  };
  if (!api || !document.body) return;


  const menu = api.getMenuDefinition();
  const environmentProbeText = (() => {
    try { return String(document.body.innerText || document.body.textContent || ''); } catch (_) { return ''; }
  })();
  const protheusEnvironment = api.resolveProtheusEnvironment(window.location.hostname, environmentProbeText);
  const routines = api.getRoutineDefinitions(protheusEnvironment);

  const DEBUG_PANEL_ID = 'positiva-protheus-debug-panel';
  const DEBUG_STATUS_ID = 'positiva-protheus-debug-status';
  const DEBUG_ELAPSED_ID = 'positiva-protheus-debug-elapsed';
  const DEBUG_UPDATED_ID = 'positiva-protheus-debug-updated';
  const DEBUG_CANCEL_ID = 'positiva-protheus-debug-cancel';
  const DEBUG_LOG_STATUS_ID = 'positiva-protheus-debug-log-status';
  const DEBUG_LOG_AUTH_ID = 'positiva-protheus-debug-log-authorize';
  const DEBUG_RECORDER_ID = 'positiva-protheus-general-recorder';
  const RECORDER_MAX_EVENTS = 2000;
  const RECORDER_MAX_MUTATION_BATCHES = 1000;
  const RECORDER_MAX_CHECKPOINTS = 250;
  const RECORDER_MAX_SCREENSHOTS = 120;
  const UI_MOTION_STYLE_ID = 'positiva-protheus-ui-motion-styles';
  const RUN_OPTIONS_ID = 'positiva-protheus-run-options';
  const LAUNCHER_FINAL_LEFT_PX = 16;
  const LAUNCHER_SIZE_PX = 44;
  const LAUNCHER_BOTTOM_PX = 16;
  const LAUNCHER_PROXIMITY_PX = 60;

  let runningController = null;
  let debugTimer = null;
  let debugStepStartedAt = Date.now();
  let debugCurrentStatus = 'Aguardando início da rotina.';
  let debugLogStatus = null;
  let debugLogAuthorize = null;
  let loggerState = null;
  let driftTimer = null;
  let lastDriftTickAt = 0;
  let backgroundProtectionActive = false;
  let debugBackgroundStatus = null;
  let runningAbortOrigin = 'none';
  let generalRecorderActive = false;
  let recorderStartedAt = '';
  let recorderStartSnapshot = null;
  let recorderEvents = [];
  let recorderMutations = [];
  let recorderCheckpoints = [];
  let recorderScreenshots = [];
  let recorderObservers = [];
  let recorderObservedRoots = new WeakSet();
  let recorderMutationBuffer = [];
  let recorderMutationTimer = null;
  let recorderScreenshotTimer = null;
  let recorderPendingScreenshot = null;
  let recorderElementStates = new WeakMap();
  let recorderNextEventId = 0;
  let recorderTruncated = { events: false, mutations: false, checkpoints: false, screenshots: false, network: false };
  let recorderLimitLogged = new Set();
  let debugRecorderButton = null;
  let debugRecorderStatus = null;
  let menuRecorderButton = null;

  document.getElementById(UI_MOTION_STYLE_ID)?.remove();
  const motionStyle = document.createElement('style');
  motionStyle.id = UI_MOTION_STYLE_ID;
  motionStyle.textContent = `
    #${DEBUG_PANEL_ID} {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translate3d(0, 12px, 0) scale(.985);
      transform-origin: right bottom;
      transition:
        opacity 220ms ease,
        transform 300ms cubic-bezier(.16, 1, .3, 1),
        visibility 0s linear 300ms;
      will-change: opacity, transform;
    }

    #${DEBUG_PANEL_ID}.pos-ui-debug-visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translate3d(0, 0, 0) scale(1);
      transition-delay: 0s;
    }

    .pos-ui-menu-panel {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translate3d(0, 9px, 0) scale(.965);
      transform-origin: left bottom;
      transition:
        opacity 170ms ease,
        transform 220ms cubic-bezier(.4, 0, .2, 1),
        visibility 0s linear 220ms;
      will-change: opacity, transform;
    }

    .pos-ui-menu-panel.pos-ui-panel-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translate3d(0, 0, 0) scale(1);
      animation: posMenuOpen 310ms cubic-bezier(.16, 1, .3, 1) both;
      transition-delay: 0s;
    }

    @keyframes posMenuOpen {
      0% { opacity: 0; transform: translate3d(0, 10px, 0) scale(.955); }
      72% { opacity: 1; transform: translate3d(0, -1px, 0) scale(1.008); }
      100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
    }

    .pos-ui-launcher {
      transform: translateX(-80%);
      scale: 1;
      transition:
        transform 260ms cubic-bezier(.4, 0, .2, 1),
        scale 110ms ease,
        box-shadow 180ms ease,
        border-color 180ms ease;
      will-change: transform, scale;
    }

    .pos-ui-launcher:hover {
      border-color: #94acba !important;
      box-shadow: 0 7px 20px rgba(0, 0, 0, .23) !important;
      scale: 1.025;
    }

    .pos-ui-launcher.pos-ui-launcher-expanded {
      transform: translateX(16px);
      animation: posLauncherReveal 390ms cubic-bezier(.16, 1, .3, 1) both;
      border-color: #94acba !important;
      box-shadow: 0 7px 20px rgba(0, 0, 0, .23) !important;
    }

    .pos-ui-launcher:active {
      scale: .93;
    }

    @keyframes posLauncherReveal {
      0% { transform: translateX(-80%); }
      72% { transform: translateX(19px); }
      100% { transform: translateX(16px); }
    }

    .pos-ui-routine {
      position: relative;
      transition:
        background-color 160ms ease,
        color 160ms ease,
        transform 180ms cubic-bezier(.16, 1, .3, 1),
        box-shadow 180ms ease;
      transform: translateX(0) scale(1);
    }

    .pos-ui-routine:hover:not(:disabled) {
      background: #eef6fb !important;
      transform: translateX(3px) scale(1);
      box-shadow: inset 3px 0 0 rgba(0, 121, 184, .42);
    }

    .pos-ui-routine:active:not(:disabled) {
      transform: translateX(2px) scale(.985);
      background: #e5f2f9 !important;
    }

    .pos-ui-routine:focus-visible {
      outline: 2px solid rgba(0, 121, 184, .42);
      outline-offset: -2px;
    }

    .pos-ui-routine:disabled {
      transform: none;
      box-shadow: none;
    }

    .pos-ui-run-options-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      box-sizing: border-box;
      background: rgba(5, 31, 49, .20);
      backdrop-filter: blur(2px);
      opacity: 0;
      transition: opacity 150ms ease;
    }

    .pos-ui-run-options-backdrop.pos-ui-run-options-visible {
      opacity: 1;
    }

    .pos-ui-run-options-card {
      width: min(390px, calc(100vw - 40px));
      box-sizing: border-box;
      padding: 18px;
      border: 1px solid #d3dce2;
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 18px 55px rgba(0,0,0,.24);
      transform: translateY(9px) scale(.97);
      transition: transform 220ms cubic-bezier(.16, 1, .3, 1);
    }

    .pos-ui-run-options-visible .pos-ui-run-options-card {
      transform: translateY(0) scale(1);
    }

    @media (prefers-reduced-motion: reduce) {
      #${DEBUG_PANEL_ID},
      .pos-ui-menu-panel,
      .pos-ui-launcher,
      .pos-ui-routine,
      .pos-ui-run-options-backdrop,
      .pos-ui-run-options-card {
        animation: none !important;
        transition-duration: 0.01ms !important;
        transition-delay: 0ms !important;
      }

      .pos-ui-launcher.pos-ui-launcher-expanded {
        transform: translateX(16px);
      }
    }
  `;
  (document.head || document.documentElement || document.body).appendChild(motionStyle);

  function isPointerWithinLauncherRange(clientX, clientY, viewportHeight) {
    const x = Number(clientX);
    const y = Number(clientY);
    const height = Number(viewportHeight);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(height) || height <= 0 || x < 0 || y < 0 || y > height) {
      return false;
    }

    const finalRight = LAUNCHER_FINAL_LEFT_PX + LAUNCHER_SIZE_PX;
    const finalBottom = height - LAUNCHER_BOTTOM_PX;
    const finalTop = finalBottom - LAUNCHER_SIZE_PX;

    return x <= finalRight + LAUNCHER_PROXIMITY_PX
      && y >= Math.max(0, finalTop - LAUNCHER_PROXIMITY_PX)
      && y <= Math.min(height, finalBottom + LAUNCHER_PROXIMITY_PX);
  }

  const runtimeHandle = { version: EXTENSION_VERSION, initialized: true, cleanup: null };
  window.__PosProtheusContentRuntime = runtimeHandle;

  function renderBackgroundProtection(state) {
    if (!debugBackgroundStatus) return;
    const current = state || {};
    if (current.active && current.ok !== false) {
      debugBackgroundStatus.textContent = 'Segundo plano: protegido via Edge/CDP';
      debugBackgroundStatus.style.color = '#227a40';
      return;
    }
    if (current.error) {
      debugBackgroundStatus.textContent = 'Segundo plano: ' + String(current.error);
      debugBackgroundStatus.style.color = '#a12622';
      return;
    }
    debugBackgroundStatus.textContent = 'Segundo plano: proteção inativa';
    debugBackgroundStatus.style.color = '#53616a';
  }

  function sendBackgroundProtection(action) {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
          resolve({ ok: false, active: false, error: 'API da extensão do Edge indisponível nesta tela.' });
          return;
        }
        chrome.runtime.sendMessage({
          type: 'pos-protheus-background-protection',
          action
        }, (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            resolve({ ok: false, active: false, error: runtimeError.message || 'Falha na comunicação com o service worker.' });
            return;
          }
          resolve(response || { ok: false, active: false, error: 'O service worker não retornou resposta.' });
        });
      } catch (error) {
        resolve({ ok: false, active: false, error: error && error.message ? String(error.message) : 'Falha ao acionar proteção de segundo plano.' });
      }
    });
  }


  function markIssTrustedTarget(element, protectInput) {
    const native = api.getNativeActionTarget(element);
    if (!native || !native.isConnected || typeof native.getRootNode !== 'function') throw new Error('ISS: alvo desconectado.');
    const host = native.getRootNode().host;
    if (!host) throw new Error('ISS: controle nativo sem host identificado.');
    const attr = 'data-pos-protheus-target';
    const previous = native.getAttribute(attr);
    const token = 'iss-' + crypto.randomUUID();
    const events = protectInput ? api.armIssInputEventGuard(element) : null;
    native.setAttribute(attr, token);
    return {
      blocked: () => !!events && events.blocked(),
      expectedTarget: {
        token,
        hostId: host.getAttribute('id'),
        hostType: host.getAttribute('type') || '',
        hostPicture: host.getAttribute('picture') || '',
        hostName: host.getAttribute('name') || '',
        ensureChecked: !protectInput && String(host.tagName || '').toUpperCase() === 'WA-CHECKBOX',
        value: String(native.value),
        selectionStart: native.selectionStart,
        selectionEnd: native.selectionEnd,
        ensureVisible: true
      },
      release() {
        if (events) events.release();
        if (native.getAttribute(attr) !== token) return;
        if (previous === null) native.removeAttribute(attr);
        else native.setAttribute(attr, previous);
      }
    };
  }

  async function sendTrustedClick(element, options) {
    let guard = null;
    try {
      if (!element) return false;
      const nativeTarget = api && typeof api.getNativeActionTarget === 'function' ? api.getNativeActionTarget(element) : element;
      if (!nativeTarget || typeof nativeTarget.getBoundingClientRect !== 'function') return false;
      const anchor = options && options.issGuard ? api.getIssTrustedClickAnchor(element) : nativeTarget;
      if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return false;
      try {
        if (typeof anchor.scrollIntoView === 'function') anchor.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (_) {}
      try {
        if (!(options && options.issGuard) && typeof nativeTarget.focus === 'function') {
          try { nativeTarget.focus({ preventScroll: true }); } catch (_) { try { nativeTarget.focus(); } catch (_) {} }
        }
      } catch (_) {}
      const rect = anchor.getBoundingClientRect();
      const x = Number(rect && rect.left) + (Number(rect && rect.width) / 2);
      const y = Number(rect && rect.top) + (Number(rect && rect.height) / 2);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (options && options.issGuard) guard = markIssTrustedTarget(element);

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'pos-protheus-trusted-click', x, y, expectedTarget: guard && guard.expectedTarget }, (result) => {
          const runtimeError = chrome.runtime && chrome.runtime.lastError;
          if (runtimeError) {
            resolve({ ok: false, error: runtimeError.message || 'Falha no clique confiável.' });
            return;
          }
          resolve(result || { ok: false, error: 'Sem resposta do service worker.' });
        });
      });
      diagnosticLogger.log('TRUSTED_CLICK', 'Resultado do clique confiável via Edge/CDP.', response);
      return !!(response && response.ok === true);
    } catch (error) {
      diagnosticLogger.log('TRUSTED_CLICK_FAIL', 'Falha ao executar clique confiável via Edge/CDP.', { message: String(error && error.message || error) });
      return false;
    } finally {
      if (guard) guard.release();
    }
  }

  async function sendTrustedHover(element) {
    let guard = null;
    try {
      if (!element) return false;
      const anchor = api.getIssTrustedClickAnchor(element);
      if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return false;
      guard = markIssTrustedTarget(element);
      const rect = anchor.getBoundingClientRect();
      const x = Number(rect && rect.left) + (Number(rect && rect.width) / 2);
      const y = Number(rect && rect.top) + (Number(rect && rect.height) / 2);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'pos-protheus-trusted-hover', x, y, expectedTarget: guard.expectedTarget }, (result) => {
          const runtimeError = chrome.runtime && chrome.runtime.lastError;
          resolve(runtimeError ? { ok: false, error: runtimeError.message || 'Falha no hover confiável.' } :
            (result || { ok: false, error: 'Sem resposta do service worker.' }));
        });
      });
      diagnosticLogger.log('TRUSTED_HOVER', 'Resultado do hover confiável via Edge/CDP.', response);
      return !!(response && response.ok === true);
    } catch (error) {
      diagnosticLogger.log('TRUSTED_HOVER_FAIL', 'Falha ao executar hover confiável via Edge/CDP.', { message: String(error && error.message || error) });
      return false;
    } finally {
      if (guard) guard.release();
    }
  }


  async function sendTrustedDoubleClick(element) {
    try {
      if (!element) return false;
      const nativeTarget = api && typeof api.getNativeActionTarget === 'function' ? api.getNativeActionTarget(element) : element;
      if (!nativeTarget || typeof nativeTarget.getBoundingClientRect !== 'function') return false;
      try {
        if (typeof nativeTarget.scrollIntoView === 'function') nativeTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (_) {}
      const rect = nativeTarget.getBoundingClientRect();
      const x = Number(rect && rect.left) + (Number(rect && rect.width) / 2);
      const y = Number(rect && rect.top) + (Number(rect && rect.height) / 2);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'pos-protheus-trusted-double-click', x, y }, (result) => {
          const runtimeError = chrome.runtime && chrome.runtime.lastError;
          if (runtimeError) {
            resolve({ ok: false, error: runtimeError.message || 'Falha no duplo clique confiável.' });
            return;
          }
          resolve(result || { ok: false, error: 'Sem resposta do service worker.' });
        });
      });
      diagnosticLogger.log('TRUSTED_DOUBLE_CLICK', 'Resultado do duplo clique confiável via Edge/CDP.', response);
      return !!(response && response.ok === true);
    } catch (error) {
      diagnosticLogger.log('TRUSTED_DOUBLE_CLICK_FAIL', 'Falha ao executar duplo clique confiável via Edge/CDP.', { message: String(error && error.message || error) });
      return false;
    }
  }

  async function sendTrustedKey(key, expectedControl) {
    let guard = null;
    try {
      if (expectedControl) guard = markIssTrustedTarget(expectedControl, true);
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'pos-protheus-trusted-key', key: String(key || ''), expectedTarget: guard && guard.expectedTarget }, (result) => {
          const runtimeError = chrome.runtime && chrome.runtime.lastError;
          if (runtimeError) {
            resolve({ ok: false, error: runtimeError.message || 'Falha na tecla confiável.' });
            return;
          }
          resolve(result || { ok: false, error: 'Sem resposta do service worker.' });
        });
      });
      diagnosticLogger.log('TRUSTED_KEY', 'Resultado da tecla confiável via Edge/CDP.', response);
      if (guard && guard.blocked()) diagnosticLogger.log('ISS_INPUT_GUARD_BLOCKED', 'Evento de tecla bloqueado antes de atingir outro campo.');
      return !!(response && response.ok === true) && !(guard && guard.blocked());
    } catch (error) {
      diagnosticLogger.log('TRUSTED_KEY_FAIL', 'Falha ao executar tecla confiável via Edge/CDP.', { message: String(error && error.message || error), key: String(key || '') });
      return false;
    } finally {
      if (guard) guard.release();
    }
  }

  async function sendTrustedText(text, expectedControl) {
    let guard = null;
    try {
      if (expectedControl) guard = markIssTrustedTarget(expectedControl, true);
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'pos-protheus-trusted-text', text: String(text == null ? '' : text), expectedTarget: guard && guard.expectedTarget }, (result) => {
          const runtimeError = chrome.runtime && chrome.runtime.lastError;
          if (runtimeError) {
            resolve({ ok: false, error: runtimeError.message || 'Falha na digitação confiável.' });
            return;
          }
          resolve(result || { ok: false, error: 'Sem resposta do service worker.' });
        });
      });
      diagnosticLogger.log('TRUSTED_TEXT', 'Resultado da digitação confiável via Edge/CDP.', response);
      if (guard && guard.blocked()) diagnosticLogger.log('ISS_INPUT_GUARD_BLOCKED', 'Evento de texto bloqueado antes de atingir outro campo.');
      return !!(response && response.ok === true) && !(guard && guard.blocked());
    } catch (error) {
      diagnosticLogger.log('TRUSTED_TEXT_FAIL', 'Falha ao executar digitação confiável via Edge/CDP.', { message: String(error && error.message || error) });
      return false;
    } finally {
      if (guard) guard.release();
    }
  }

  async function startBackgroundProtection() {
    setDebugStatus('Ativando proteção de segundo plano do Edge...');
    const result = await sendBackgroundProtection('start');
    renderBackgroundProtection(result);
    diagnosticLogger.log('BACKGROUND', 'Resultado ao ativar proteção de segundo plano.', result);
    if (!result || result.ok !== true || result.active !== true) {
      throw new Error('Proteção de segundo plano não pôde ser ativada: ' + String(result && result.error || 'sem confirmação do Edge'));
    }
    backgroundProtectionActive = true;
    return result;
  }

  async function stopBackgroundProtection() {
    if (!backgroundProtectionActive) return { ok: true, active: false };
    const result = await sendBackgroundProtection('stop');
    diagnosticLogger.log('BACKGROUND', 'Resultado ao desativar proteção de segundo plano.', result);
    backgroundProtectionActive = false;
    renderBackgroundProtection(result);
    return result;
  }

  function renderLoggerState(state) {
    loggerState = state || loggerState || {};
    if (!debugLogStatus || !debugLogAuthorize) return;
    const current = loggerState || {};
    if (!current.supported) {
      debugLogStatus.textContent = 'Logs: memória apenas (seletor de pasta indisponível)';
      debugLogAuthorize.style.display = 'none';
      return;
    }
    if (current.permission === 'granted' && current.directoryVerified) {
      debugLogStatus.textContent = 'Logs: autorizado' + (current.runId ? ' · RUN ' + current.runId : '') + (current.pendingLines ? ' · fila ' + current.pendingLines : '');
      debugLogAuthorize.textContent = 'Trocar pasta';
      debugLogAuthorize.style.display = 'inline-block';
      debugLogAuthorize.disabled = false;
      return;
    }
    debugLogStatus.textContent = current.lastError
      ? 'Logs: ' + current.lastError
      : 'Logs: pasta ainda não autorizada';
    debugLogAuthorize.textContent = 'Autorizar pasta de logs';
    debugLogAuthorize.style.display = 'inline-block';
    debugLogAuthorize.disabled = false;
  }

  const diagnosticLogger = diagnosticApi.createDiagnosticLogger({
    window,
    indexedDB: window.indexedDB,
    onStateChange: renderLoggerState
  });

  function runtimeState() {
    let focus = false;
    try { focus = document.hasFocus(); } catch (_) {}
    return {
      visibility: String(document.visibilityState || 'unknown'),
      focus,
      href: String((window.location && window.location.href) || (typeof location !== 'undefined' && location.href) || '')
    };
  }

  function formatClock(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value) => String(value).padStart(2, '0');
    return hours > 0
      ? pad(hours) + ':' + pad(minutes) + ':' + pad(seconds)
      : pad(minutes) + ':' + pad(seconds);
  }

  function isRecorderElementVisible(element) {
    if (!element || element.hidden) return false;
    try {
      const style = window.getComputedStyle(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (_) {
      return false;
    }
  }

  function compactRecorderText(value, maxLength) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const limit = Math.max(40, Number(maxLength) || 500);
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  }

  function isRecorderSensitiveHint(value) {
    return /password|passwd|senha|token|secret|authorization|cookie|credential|credencial|api[-_]?key|session[-_]?key/i.test(String(value || ''));
  }

  function isRecorderSensitiveElement(element) {
    if (!element || element.nodeType !== 1) return false;
    try {
      const type = String(element.getAttribute('type') || element.type || '').toLowerCase();
      if (type === 'password') return true;
      const hint = [
        element.getAttribute('name'), element.getAttribute('id'), element.getAttribute('autocomplete'),
        element.getAttribute('aria-label'), element.getAttribute('placeholder'), element.getAttribute('caption'),
        element.getAttribute('title')
      ].filter(Boolean).join(' ');
      return isRecorderSensitiveHint(hint);
    } catch (_) {
      return false;
    }
  }

  function sanitizeRecorderValue(value, elementOrHint) {
    const sensitive = elementOrHint && elementOrHint.nodeType === 1
      ? isRecorderSensitiveElement(elementOrHint)
      : isRecorderSensitiveHint(elementOrHint);
    if (sensitive) return '[REDACTED]';
    return compactRecorderText(value, 6000);
  }

  function getRecorderAttributes(element) {
    const attributes = {};
    if (!element || !element.attributes) return attributes;
    try {
      const elementSensitive = isRecorderSensitiveElement(element);
      for (const attr of Array.from(element.attributes)) {
        const name = String(attr.name || '');
        let value = String(attr.value == null ? '' : attr.value);
        if (isRecorderSensitiveHint(name) || (elementSensitive && /^(value|data-value)$/i.test(name))) value = '[REDACTED]';
        else value = compactRecorderText(value, 5000);
        attributes[name] = value;
      }
    } catch (_) {}
    return attributes;
  }

  function sanitizeRecorderHtml(element) {
    if (!element || element.nodeType !== 1) return '';
    try {
      const clone = element.cloneNode(true);
      const nodes = [clone].concat(Array.from(clone.querySelectorAll ? clone.querySelectorAll('*') : []));
      for (const node of nodes) {
        if (!node || node.nodeType !== 1) continue;
        const sensitive = isRecorderSensitiveElement(node);
        for (const attr of Array.from(node.attributes || [])) {
          const name = String(attr.name || '');
          if (isRecorderSensitiveHint(name) || (sensitive && /^(value|data-value)$/i.test(name))) {
            try { node.setAttribute(name, '[REDACTED]'); } catch (_) {}
          }
        }
        if (sensitive && 'value' in node) {
          try { node.value = '[REDACTED]'; } catch (_) {}
        }
      }
      return compactRecorderText(clone.outerHTML || '', 16000);
    } catch (_) {
      try {
        let html = String(element.outerHTML || '');
        if (isRecorderSensitiveElement(element)) html = html.replace(/\svalue=(['"])[\s\S]*?\1/gi, ' value="[REDACTED]"');
        return compactRecorderText(html, 16000);
      } catch (_) { return ''; }
    }
  }

  function getRecorderPrimaryNative(element) {
    if (!element || !element.shadowRoot) return null;
    try {
      return element.shadowRoot.querySelector('input, textarea, select, button, [role="button"], [role="checkbox"], [role="combobox"]');
    } catch (_) { return null; }
  }

  function readRecorderElementState(element) {
    if (!element || element.nodeType !== 1) return null;
    const native = getRecorderPrimaryNative(element);
    const source = native || element;
    let value = '';
    let checked = null;
    let selectedIndex = null;
    let selectedText = '';
    try {
      value = source.value == null ? '' : String(source.value);
      checked = typeof source.checked === 'boolean' ? source.checked : null;
      selectedIndex = Number.isInteger(source.selectedIndex) ? source.selectedIndex : null;
      if (selectedIndex != null && selectedIndex >= 0 && source.options && source.options[selectedIndex]) {
        selectedText = String(source.options[selectedIndex].textContent || source.options[selectedIndex].label || '');
      }
    } catch (_) {}
    return {
      value: sanitizeRecorderValue(value, source),
      checked,
      selectedIndex,
      selectedText: sanitizeRecorderValue(selectedText, source),
      disabled: source.disabled === true || element.disabled === true,
      readOnly: source.readOnly === true || element.readOnly === true
    };
  }

  function recorderNodeLabel(node) {
    if (!node || node.nodeType !== 1) return '';
    const tag = String(node.tagName || '').toLowerCase();
    const id = String(node.id || '');
    const name = String(node.getAttribute && node.getAttribute('name') || '');
    const caption = compactRecorderText(node.getAttribute && node.getAttribute('caption') || '', 80);
    const title = compactRecorderText(node.getAttribute && node.getAttribute('title') || '', 80);
    let part = tag || 'element';
    if (id) part += '#' + id;
    if (name) part += '[name="' + name + '"]';
    else if (caption) part += '[caption="' + caption + '"]';
    else if (title) part += '[title="' + title + '"]';
    return part;
  }

  function buildRecorderDomPath(element) {
    const parts = [];
    let current = element;
    let guard = 0;
    while (current && guard++ < 24) {
      if (current.nodeType === 1) parts.unshift(recorderNodeLabel(current));
      let parent = current.parentElement || null;
      if (!parent && current.getRootNode) {
        const root = current.getRootNode();
        if (root && root.host) {
          parts.unshift('::shadow');
          parent = root.host;
        }
      }
      current = parent;
    }
    return parts.filter(Boolean).join(' > ');
  }

  function captureRecorderAncestors(element) {
    const result = [];
    let current = element;
    let guard = 0;
    while (current && guard++ < 16) {
      let parent = current.parentElement || null;
      if (!parent && current.getRootNode) {
        const root = current.getRootNode();
        if (root && root.host) parent = root.host;
      }
      current = parent;
      if (!current || current.nodeType !== 1) continue;
      const tag = String(current.tagName || '').toLowerCase();
      if (/^(wa-dialog|wa-tgrid|wa-tcbrowse|wa-panel|form|main|section|article)$/i.test(tag) || result.length < 5) {
        result.push({
          tag,
          attributes: getRecorderAttributes(current),
          text: compactRecorderText(current.innerText || current.textContent || '', 500)
        });
      }
      if (result.length >= 10) break;
    }
    return result;
  }

  function captureRecorderNearbyLabels(element) {
    const labels = [];
    const add = (node) => {
      if (!node || labels.length >= 10) return;
      const text = compactRecorderText(node.innerText || node.textContent || node.getAttribute && (node.getAttribute('caption') || node.getAttribute('title')) || '', 500);
      if (text && !labels.some((item) => item.text === text)) labels.push({ tag: String(node.tagName || '').toLowerCase(), text });
    };
    try {
      if (element.labels) for (const label of Array.from(element.labels)) add(label);
      const id = String(element.id || '');
      if (id && document.querySelectorAll) {
        for (const label of Array.from(document.querySelectorAll('label[for="' + CSS.escape(id) + '"]'))) add(label);
      }
      const parent = element.parentElement;
      if (parent) {
        for (const node of Array.from(parent.children || [])) {
          if (node !== element && /^(label|span|wa-text-view|wa-label)$/i.test(String(node.tagName || ''))) add(node);
        }
      }
      let previous = element.previousElementSibling;
      let count = 0;
      while (previous && count++ < 3) { add(previous); previous = previous.previousElementSibling; }
    } catch (_) {}
    return labels;
  }

  function captureRecorderShadowTree(root, depth, budget) {
    const remaining = budget || { value: 100 };
    if (!root || depth > 4 || remaining.value <= 0) return [];
    const result = [];
    let children = [];
    try { children = Array.from(root.children || root.querySelectorAll(':scope > *') || []); } catch (_) {}
    for (const node of children) {
      if (!node || node.nodeType !== 1 || remaining.value-- <= 0) break;
      const state = readRecorderElementState(node) || {};
      const item = {
        tag: String(node.tagName || '').toLowerCase(),
        attributes: getRecorderAttributes(node),
        outerHTML: sanitizeRecorderHtml(node),
        text: compactRecorderText(node.innerText || node.textContent || '', 800),
        value: state.value,
        checked: state.checked
      };
      const childTree = captureRecorderShadowTree(node, depth + 1, remaining);
      if (childTree.length) item.children = childTree;
      if (node.shadowRoot) item.shadow = captureRecorderShadowTree(node.shadowRoot, depth + 1, remaining);
      result.push(item);
    }
    return result;
  }

  function captureRecorderElementSummary(element) {
    if (!element || element.nodeType !== 1) return null;
    const state = readRecorderElementState(element) || {};
    let rect = null;
    try {
      const r = element.getBoundingClientRect();
      rect = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    } catch (_) {}
    const id = String(element.id || '');
    return {
      tag: String(element.tagName || '').toLowerCase(),
      id,
      unsafeDynamicId: /^COMP\d+$/i.test(id),
      advpl: String(element.getAttribute && element.getAttribute('data-advpl') || ''),
      name: String(element.getAttribute && element.getAttribute('name') || ''),
      caption: compactRecorderText(element.getAttribute && element.getAttribute('caption') || '', 600),
      title: compactRecorderText(element.getAttribute && element.getAttribute('title') || '', 600),
      text: compactRecorderText(element.innerText || element.textContent || '', 1000),
      value: state.value,
      checked: state.checked,
      selectedIndex: state.selectedIndex,
      selectedText: state.selectedText,
      disabled: state.disabled,
      readOnly: state.readOnly,
      visible: isRecorderElementVisible(element),
      rect
    };
  }

  function captureRecorderElementDna(element, event) {
    if (!element || element.nodeType !== 1) return null;
    const summary = captureRecorderElementSummary(element);
    const native = getRecorderPrimaryNative(element);
    const nativeSummary = native ? Object.assign(captureRecorderElementSummary(native) || {}, {
      attributes: getRecorderAttributes(native),
      outerHTML: sanitizeRecorderHtml(native)
    }) : null;
    let componentHost = null;
    try {
      const root = element.getRootNode && element.getRootNode();
      if (root && root.host && root.host.nodeType === 1) {
        componentHost = Object.assign(captureRecorderElementSummary(root.host) || {}, {
          attributes: getRecorderAttributes(root.host),
          outerHTML: sanitizeRecorderHtml(root.host)
        });
      }
    } catch (_) {}
    let composedPath = [];
    try {
      composedPath = event && typeof event.composedPath === 'function'
        ? event.composedPath().filter((node) => node && node.nodeType === 1).slice(0, 20).map(recorderNodeLabel)
        : [];
    } catch (_) {}
    return Object.assign({}, summary, {
      attributes: getRecorderAttributes(element),
      outerHTML: sanitizeRecorderHtml(element),
      focused: document.activeElement === element || document.activeElement === native,
      domPath: buildRecorderDomPath(element),
      composedPath,
      ancestors: captureRecorderAncestors(element),
      nearbyLabels: captureRecorderNearbyLabels(element),
      componentHost,
      native: nativeSummary,
      shadow: element.shadowRoot ? captureRecorderShadowTree(element.shadowRoot, 0, { value: 100 }) : []
    });
  }

  function collectDeepRecorderElements(root, selector, result, seen) {
    const out = result || [];
    const visited = seen || new Set();
    if (!root || visited.has(root)) return out;
    visited.add(root);
    try {
      for (const node of root.querySelectorAll(selector)) if (!out.includes(node)) out.push(node);
      for (const node of root.querySelectorAll('*')) if (node.shadowRoot) collectDeepRecorderElements(node.shadowRoot, selector, out, visited);
    } catch (_) {}
    return out;
  }

  function captureBrowseDiagnosticSnapshot() {
    const grids = [];
    const hosts = Array.from(document.querySelectorAll('wa-tgrid')).filter(isRecorderElementVisible);
    for (const host of hosts) {
      try {
        const root = host.shadowRoot;
        const table = root && root.querySelector('table');
        if (!table) continue;
        const headers = Array.from(table.querySelectorAll('thead th')).map((th) => compactRecorderText(th.innerText || th.textContent || '', 250));
        const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 40).map((tr) => ({
          id: String(tr.id || ''),
          className: String(tr.className || ''),
          cells: Array.from(tr.querySelectorAll('td')).slice(0, 80).map((td) => ({ text: compactRecorderText(td.innerText || td.textContent || '', 800) }))
        }));
        grids.push({ host: captureRecorderElementSummary(host), headers, rowCountRendered: rows.length, rows });
      } catch (_) {}
    }
    return { at: new Date().toISOString(), grids };
  }

  function captureRecorderContextSnapshot(reason) {
    const selector = 'wa-dialog, wa-tgrid, wa-tcbrowse, wa-button, wa-text-input, wa-number-input, wa-date-input, wa-combo-box, wa-combobox, wa-select, wa-radio, wa-checkbox, wa-text-view, input, textarea, select, button';
    const elements = [];
    try {
      for (const element of collectDeepRecorderElements(document, selector)) {
        if (elements.length >= 180) break;
        if (!isRecorderElementVisible(element)) continue;
        if (debugPanel && (element === debugPanel || debugPanel.contains(element))) continue;
        const info = captureRecorderElementSummary(element);
        if (info) elements.push(info);
      }
    } catch (_) {}
    return {
      at: new Date().toISOString(),
      reason: String(reason || 'snapshot'),
      page: { href: String(window.location.href || ''), title: String(document.title || '') },
      activeElement: captureRecorderElementSummary(document.activeElement),
      elements,
      browse: captureBrowseDiagnosticSnapshot()
    };
  }

  // Compatibilidade diagnóstica antiga: o gravador geral cobre o antigo "Capturar filtro" / "Parar captura".
  // Mensagens legadas aceitas pelo background: pos-protheus-filter-capture-start / pos-protheus-filter-capture-stop.
  const LEGACY_FILTER_CAPTURE_ID = 'positiva-protheus-filter-capture';
  const LEGACY_FILTER_DIAGNOSTIC_FILENAME = 'Protheus_Filtro_Diagnostico_';
  function captureVisibleFilterUi() { return captureRecorderContextSnapshot('legacy-filter-ui'); }

  function recorderLimit(category) {
    recorderTruncated[category] = true;
    if (!recorderLimitLogged.has(category)) {
      recorderLimitLogged.add(category);
      diagnosticLogger.log('RECORDER_LIMIT', 'Limite do gravador atingido.', { category });
    }
  }

  function nextRecorderEventId(prefix) {
    recorderNextEventId += 1;
    return String(prefix || 'evt') + '-' + String(recorderNextEventId).padStart(6, '0');
  }

  function getRecorderEventTarget(event) {
    let target = event && event.target;
    try {
      const path = event && typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (path && path[0] && path[0].nodeType === 1) target = path[0];
    } catch (_) {}
    return target && target.nodeType === 1 ? target : null;
  }

  function isRecorderOwnUi(element) {
    if (!element || element.nodeType !== 1) return false;
    try {
      let current = element;
      let guard = 0;
      while (current && guard++ < 20) {
        const id = String(current.id || '');
        if (id === DEBUG_PANEL_ID || id === String(menu.panelId || '') || id === String(menu.launcherId || '') || id === RUN_OPTIONS_ID) return true;
        if (current.getAttribute && current.getAttribute('data-recorder-action')) return true;
        let parent = current.parentElement || null;
        if (!parent && current.getRootNode) {
          const root = current.getRootNode();
          if (root && root.host && root.host.nodeType === 1) parent = root.host;
        }
        current = parent;
      }
    } catch (_) {}
    return false;
  }

  function recorderEventKey(event, target) {
    if (!event || !/^key/.test(String(event.type || ''))) return null;
    const key = String(event.key || '');
    if (isRecorderSensitiveElement(target) && key.length === 1) return '[CHAR]';
    return key.length === 1 ? '[CHAR:' + key + ']' : key;
  }

  function scheduleRecorderPostState(item, target) {
    if (!item || !target || target.nodeType !== 1) return;
    window.setTimeout(() => {
      if (!generalRecorderActive) return;
      try {
        const after = readRecorderElementState(target);
        item.after = after;
        item.afterTarget = captureRecorderElementSummary(target);
        recorderElementStates.set(target, after);
      } catch (_) {}
    }, 0);
  }

  function recordGeneralRecorderEvent(type, event) {
    if (!generalRecorderActive || recorderEvents.length >= RECORDER_MAX_EVENTS) {
      if (generalRecorderActive && recorderEvents.length >= RECORDER_MAX_EVENTS) recorderLimit('events');
      return;
    }
    if (!event || event.isTrusted !== true) return;
    const target = getRecorderEventTarget(event);
    if (!target || isRecorderOwnUi(target)) return;
    const currentState = readRecorderElementState(target);
    const previous = recorderElementStates.get(target) || null;
    const now = Date.now();
    const path = buildRecorderDomPath(target);
    const normalizedType = String(type || event.type || 'event');
    const capturesBeforeDefault = /^(click|dblclick|keydown)$/.test(normalizedType);
    const before = capturesBeforeDefault ? currentState : (previous || currentState);
    const after = currentState;

    if (normalizedType === 'input') {
      const last = recorderEvents[recorderEvents.length - 1];
      if (last && last.type === 'input' && last.target && last.target.domPath === path && now - Number(last.epochMs || 0) < 140) {
        last.at = new Date().toISOString();
        last.epochMs = now;
        last.after = after;
        last.target = captureRecorderElementDna(target, event);
        last.inputCount = Number(last.inputCount || 1) + 1;
        recorderElementStates.set(target, after);
        renderRecorderStatus();
        return;
      }
    }

    const item = {
      eventId: nextRecorderEventId('evt'),
      at: new Date().toISOString(),
      epochMs: now,
      type: normalizedType,
      key: recorderEventKey(event, target),
      before: before,
      after: after,
      target: captureRecorderElementDna(target, event),
      afterTarget: null
    };
    recorderEvents.push(item);
    recorderElementStates.set(target, after);
    if (capturesBeforeDefault) scheduleRecorderPostState(item, target);
    diagnosticLogger.log('RECORDER_EVENT', 'Evento capturado pelo gravador geral.', { eventId: item.eventId, type: item.type, target: item.target && { tag: item.target.tag, name: item.target.name, title: item.target.title, caption: item.target.caption, unsafeDynamicId: item.target.unsafeDynamicId } });
    if (/^(click|dblclick|change|focusout)$/.test(normalizedType)) scheduleRecorderScreenshot(item.eventId, normalizedType);
    renderRecorderStatus();
  }

  function sanitizeRecorderInlineSecrets(value, maxLength) {
    let text = compactRecorderText(value, maxLength || 1500);
    try {
      text = text
        .replace(/((?:password|passwd|senha|token|secret|authorization|api[-_]?key|session[-_]?key)\s*[=:]\s*)([^&\s,;}]+)/gi, '$1[REDACTED]')
        .replace(/(["'](?:password|passwd|senha|token|secret|authorization|api[-_]?key|session[-_]?key)["']\s*:\s*["'])([^"']*)(["'])/gi, '$1[REDACTED]$3');
    } catch (_) {}
    return text;
  }

  function sanitizeRecorderMutationValue(value, target, attributeName) {
    if (isRecorderSensitiveHint(attributeName) || isRecorderSensitiveElement(target)) return '[REDACTED]';
    return sanitizeRecorderInlineSecrets(value, 1500);
  }

  function summarizeRecorderMutation(record) {
    const rawTarget = record && record.target;
    const target = rawTarget && rawTarget.nodeType === 1 ? rawTarget : (rawTarget && rawTarget.parentElement ? rawTarget.parentElement : null);
    const attributeName = String(record && record.attributeName || '');
    const added = [];
    const removed = [];
    try {
      for (const node of Array.from(record.addedNodes || []).slice(0, 12)) if (node.nodeType === 1) added.push(captureRecorderElementSummary(node));
      for (const node of Array.from(record.removedNodes || []).slice(0, 12)) if (node.nodeType === 1) {
        const removedText = sanitizeRecorderValue(node.textContent || '', node);
        removed.push({ tag: String(node.tagName || '').toLowerCase(), text: sanitizeRecorderInlineSecrets(removedText, 300) });
      }
    } catch (_) {}
    return {
      type: String(record && record.type || ''),
      attributeName,
      oldValue: sanitizeRecorderMutationValue(record && record.oldValue || '', target, attributeName),
      target: target ? captureRecorderElementSummary(target) : null,
      added,
      removed
    };
  }

  function queueRecorderMutations(records, rootLabel) {
    if (!generalRecorderActive) return;
    for (const record of Array.from(records || [])) {
      if (recorderMutationBuffer.length >= 250) break;
      const target = record && record.target;
      if (target && target.nodeType === 1 && isRecorderOwnUi(target)) continue;
      recorderMutationBuffer.push({ root: String(rootLabel || 'document'), mutation: summarizeRecorderMutation(record) });
      try {
        for (const node of Array.from(record.addedNodes || [])) if (node && node.nodeType === 1) discoverRecorderShadowRoots(node);
      } catch (_) {}
    }
    if (recorderMutationTimer) window.clearTimeout(recorderMutationTimer);
    recorderMutationTimer = window.setTimeout(flushRecorderMutations, 140);
  }

  function flushRecorderMutations() {
    if (!recorderMutationBuffer.length) return;
    const records = recorderMutationBuffer.splice(0, recorderMutationBuffer.length);
    if (recorderMutations.length >= RECORDER_MAX_MUTATION_BATCHES) {
      recorderLimit('mutations');
      return;
    }
    const batch = { mutationId: nextRecorderEventId('mut'), at: new Date().toISOString(), records };
    recorderMutations.push(batch);
    const structural = records.some((item) => item.mutation && item.mutation.type === 'childList' && ((item.mutation.added && item.mutation.added.length) || (item.mutation.removed && item.mutation.removed.length)));
    if (structural && recorderCheckpoints.length < RECORDER_MAX_CHECKPOINTS) {
      recorderCheckpoints.push({ checkpointId: nextRecorderEventId('chk'), trigger: batch.mutationId, snapshot: captureRecorderContextSnapshot('dom-change') });
      scheduleRecorderScreenshot(batch.mutationId, 'dom-change');
    } else if (structural && recorderCheckpoints.length >= RECORDER_MAX_CHECKPOINTS) recorderLimit('checkpoints');
    renderRecorderStatus();
  }

  function observeRecorderRoot(root, label) {
    if (!root || recorderObservedRoots.has(root)) return;
    recorderObservedRoots.add(root);
    try {
      const observer = new MutationObserver((records) => queueRecorderMutations(records, label));
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
      recorderObservers.push(observer);
    } catch (_) {}
    discoverRecorderShadowRoots(root);
  }

  function discoverRecorderShadowRoots(root) {
    if (!root) return;
    try {
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      if (root.nodeType === 1) nodes.unshift(root);
      for (const node of nodes) {
        if (node && node.shadowRoot) observeRecorderRoot(node.shadowRoot, 'shadow:' + recorderNodeLabel(node));
      }
    } catch (_) {}
  }

  function startGeneralRecorderObservers() {
    stopGeneralRecorderObservers();
    recorderObservedRoots = new WeakSet();
    observeRecorderRoot(document.documentElement, 'document');
  }

  function stopGeneralRecorderObservers() {
    for (const observer of recorderObservers.splice(0, recorderObservers.length)) { try { observer.disconnect(); } catch (_) {} }
    if (recorderMutationTimer) { try { window.clearTimeout(recorderMutationTimer); } catch (_) {} }
    recorderMutationTimer = null;
    recorderMutationBuffer = [];
  }

  function sendRecorderMessage(type, extra) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ type }, extra || {}), (response) => {
          const lastError = chrome.runtime && chrome.runtime.lastError;
          if (lastError) { reject(new Error(lastError.message || 'Falha ao comunicar com o gravador geral.')); return; }
          if (!response || response.ok !== true) { reject(new Error(response && response.error || 'O gravador geral não confirmou a operação.')); return; }
          resolve(response);
        });
      } catch (error) { reject(error); }
    });
  }

  function hasVisibleRecorderSensitiveInput() {
    try {
      const selector = 'input, textarea, select, wa-text-input, wa-number-input, wa-date-input, wa-combobox, wa-select';
      const candidates = collectDeepRecorderElements(document, selector);
      for (const element of candidates) {
        if (!isRecorderElementVisible(element)) continue;
        const native = getRecorderPrimaryNative(element);
        if (isRecorderSensitiveElement(element) || isRecorderSensitiveElement(native)) return true;
      }
    } catch (_) {}
    return false;
  }

  async function captureRecorderScreenshot(eventId, reason) {
    if (!generalRecorderActive || recorderScreenshots.length >= RECORDER_MAX_SCREENSHOTS) {
      if (generalRecorderActive && recorderScreenshots.length >= RECORDER_MAX_SCREENSHOTS) recorderLimit('screenshots');
      return null;
    }
    if (hasVisibleRecorderSensitiveInput()) {
      diagnosticLogger.log('RECORDER_SCREENSHOT_SKIPPED_SENSITIVE', 'Screenshot não capturado porque há campo sensível visível na tela.', { eventId: String(eventId || ''), reason: String(reason || '') });
      return null;
    }
    try {
      const response = await sendRecorderMessage('pos-protheus-recorder-screenshot', { eventId: String(eventId || ''), reason: String(reason || '') });
      if (response && response.data) {
        const shot = {
          screenshotId: nextRecorderEventId('shot'),
          eventId: String(eventId || ''),
          reason: String(reason || ''),
          at: String(response.at || new Date().toISOString()),
          format: String(response.format || 'jpeg'),
          dataUrl: 'data:image/jpeg;base64,' + String(response.data || '')
        };
        recorderScreenshots.push(shot);
        renderRecorderStatus();
        return shot;
      }
    } catch (error) {
      diagnosticLogger.log('RECORDER_ERROR', 'Falha ao capturar screenshot.', { message: String(error && error.message || error), eventId, reason });
    }
    return null;
  }

  function scheduleRecorderScreenshot(eventId, reason) {
    if (!generalRecorderActive || recorderScreenshots.length >= RECORDER_MAX_SCREENSHOTS) return;
    recorderPendingScreenshot = { eventId: String(eventId || ''), reason: String(reason || '') };
    if (recorderScreenshotTimer) return;
    recorderScreenshotTimer = window.setTimeout(async () => {
      recorderScreenshotTimer = null;
      const pending = recorderPendingScreenshot;
      recorderPendingScreenshot = null;
      if (pending) await captureRecorderScreenshot(pending.eventId, pending.reason);
    }, 220);
  }

  function renderRecorderStatus() {
    if (!debugRecorderStatus) return;
    if (!generalRecorderActive) {
      debugRecorderStatus.textContent = 'Gravador: inativo';
      return;
    }
    const elapsed = recorderStartedAt ? formatElapsed(Date.now() - Date.parse(recorderStartedAt)) : '00:00';
    debugRecorderStatus.textContent = 'REC ' + elapsed + ' · ' + recorderEvents.length + ' eventos · ' + recorderScreenshots.length + ' imagens';
  }

  async function startGeneralRecorder() {
    const response = await sendRecorderMessage('pos-protheus-recorder-start');
    generalRecorderActive = true;
    recorderStartedAt = String(response.startedAt || new Date().toISOString());
    recorderNextEventId = 0;
    recorderEvents = [];
    recorderMutations = [];
    recorderCheckpoints = [];
    recorderScreenshots = [];
    recorderMutationBuffer = [];
    recorderElementStates = new WeakMap();
    recorderTruncated = { events: false, mutations: false, checkpoints: false, screenshots: false, network: false };
    recorderLimitLogged = new Set();
    recorderStartSnapshot = captureRecorderContextSnapshot('recording-start');
    startGeneralRecorderObservers();
    diagnosticLogger.log('RECORDER_START', 'Gravador geral iniciado.', { startedAt: recorderStartedAt, page: String(window.location.href || '') });
    await captureRecorderScreenshot('recording-start', 'start');
    renderRecorderStatus();
    return response;
  }

  async function stopGeneralRecorder() {
    if (recorderScreenshotTimer) {
      try { window.clearTimeout(recorderScreenshotTimer); } catch (_) {}
      recorderScreenshotTimer = null;
      recorderPendingScreenshot = null;
    }
    flushRecorderMutations();
    const endSnapshot = captureRecorderContextSnapshot('recording-stop');
    await captureRecorderScreenshot('recording-stop', 'stop');
    stopGeneralRecorderObservers();
    const response = await sendRecorderMessage('pos-protheus-recorder-stop', { keepProtection: backgroundProtectionActive === true });
    generalRecorderActive = false;
    recorderTruncated.network = response.truncated === true;
    const stoppedAt = String(response.stoppedAt || new Date().toISOString());
    const payload = {
      kind: 'positiva-protheus-general-recording',
      schemaVersion: 1,
      extensionVersion: EXTENSION_VERSION,
      page: { href: String(window.location.href || ''), title: String(document.title || ''), environment: protheusEnvironment },
      startedAt: recorderStartedAt,
      stoppedAt,
      debug: diagnosticLogger.getState(),
      startSnapshot: recorderStartSnapshot,
      events: recorderEvents,
      mutations: recorderMutations,
      checkpoints: recorderCheckpoints,
      screenshots: recorderScreenshots,
      network: {
        eventCount: Number(response.eventCount || 0),
        truncated: response.truncated === true,
        events: Array.isArray(response.events) ? response.events : []
      },
      endSnapshot,
      limits: {
        maxEvents: RECORDER_MAX_EVENTS,
        maxMutationBatches: RECORDER_MAX_MUTATION_BATCHES,
        maxCheckpoints: RECORDER_MAX_CHECKPOINTS,
        maxScreenshots: RECORDER_MAX_SCREENSHOTS,
        truncated: Object.assign({}, recorderTruncated)
      }
    };
    diagnosticLogger.log('RECORDER_STOP', 'Gravador geral finalizado.', { stoppedAt, events: recorderEvents.length, mutations: recorderMutations.length, screenshots: recorderScreenshots.length, network: payload.network.eventCount });
    renderRecorderStatus();
    return payload;
  }

  function downloadGeneralRecording(payload) {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    const filename = 'Protheus_Gravacao_' + stamp + '.json';
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    return filename;
  }


  document.getElementById(DEBUG_PANEL_ID)?.remove();

  const debugPanel = document.createElement('div');
  debugPanel.id = DEBUG_PANEL_ID;
  Object.assign(debugPanel.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    width: '340px',
    boxSizing: 'border-box',
    padding: '10px 12px 11px',
    border: '1px solid #c6d0d7',
    borderRadius: '9px',
    background: 'rgba(255,255,255,.97)',
    color: '#263238',
    boxShadow: '0 5px 18px rgba(0,0,0,.20)',
    fontFamily: 'Arial, sans-serif',
    fontSize: '12px',
    lineHeight: '1.35'
  });

  const debugHeader = document.createElement('div');
  Object.assign(debugHeader.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '6px'
  });

  const debugTitle = document.createElement('div');
  debugTitle.textContent = 'Automação Protheus · Debug';
  Object.assign(debugTitle.style, { fontWeight: '700', color: '#0079b8' });

  const debugCancel = document.createElement('button');
  debugCancel.id = DEBUG_CANCEL_ID;
  debugCancel.type = 'button';
  debugCancel.textContent = '×';
  debugCancel.title = 'Cancelar rotina';
  debugCancel.setAttribute('aria-label', 'Cancelar rotina em execução');
  debugCancel.disabled = false;
  Object.assign(debugCancel.style, {
    width: '24px',
    height: '24px',
    padding: '0',
    border: '0',
    borderRadius: '5px',
    background: 'transparent',
    color: '#69767d',
    fontSize: '20px',
    lineHeight: '20px',
    cursor: 'default'
  });

  const debugStatus = document.createElement('div');
  debugStatus.id = DEBUG_STATUS_ID;
  debugStatus.textContent = debugCurrentStatus;
  Object.assign(debugStatus.style, { fontWeight: '600', marginBottom: '5px', overflowWrap: 'anywhere' });

  const debugElapsed = document.createElement('div');
  debugElapsed.id = DEBUG_ELAPSED_ID;
  debugElapsed.textContent = 'Tempo nesta etapa: 00:00';
  Object.assign(debugElapsed.style, { color: '#53616a' });

  const debugUpdated = document.createElement('div');
  debugUpdated.id = DEBUG_UPDATED_ID;
  debugUpdated.textContent = 'Última atualização: ' + formatClock(new Date());
  Object.assign(debugUpdated.style, { color: '#53616a' });

  debugBackgroundStatus = document.createElement('div');
  debugBackgroundStatus.textContent = 'Segundo plano: proteção inativa';
  Object.assign(debugBackgroundStatus.style, { color: '#53616a', marginTop: '3px', fontSize: '11px' });

  const debugLogRow = document.createElement('div');
  Object.assign(debugLogRow.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginTop: '7px',
    paddingTop: '7px',
    borderTop: '1px solid #e1e7eb'
  });

  debugLogStatus = document.createElement('div');
  debugLogStatus.id = DEBUG_LOG_STATUS_ID;
  debugLogStatus.textContent = 'Logs: verificando autorização...';
  debugLogStatus.title = diagnosticApi.EXPECTED_DIRECTORY;
  Object.assign(debugLogStatus.style, { color: '#53616a', fontSize: '11px', minWidth: '0', flex: '1 1 auto', overflowWrap: 'anywhere' });

  debugLogAuthorize = document.createElement('button');
  debugLogAuthorize.id = DEBUG_LOG_AUTH_ID;
  debugLogAuthorize.type = 'button';
  debugLogAuthorize.textContent = 'Autorizar pasta de logs';
  debugLogAuthorize.title = 'Selecione exatamente: ' + diagnosticApi.EXPECTED_DIRECTORY;
  Object.assign(debugLogAuthorize.style, {
    flex: '0 0 auto',
    padding: '4px 7px',
    border: '1px solid #9eb5c3',
    borderRadius: '5px',
    background: '#f7fbfd',
    color: '#00659a',
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    cursor: 'pointer'
  });

  debugLogRow.appendChild(debugLogStatus);
  debugLogRow.appendChild(debugLogAuthorize);

  const debugRecorderRow = document.createElement('div');
  Object.assign(debugRecorderRow.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '8px', paddingTop: '7px', borderTop: '1px solid #e1e7eb' });

  debugRecorderStatus = document.createElement('div');
  debugRecorderStatus.textContent = 'Gravador: inativo';
  Object.assign(debugRecorderStatus.style, { color: '#53616a', fontSize: '11px', minWidth: '0', flex: '1 1 auto', overflowWrap: 'anywhere' });

  debugRecorderButton = document.createElement('button');
  debugRecorderButton.id = DEBUG_RECORDER_ID;
  debugRecorderButton.type = 'button';
  debugRecorderButton.textContent = '● Gravar';
  debugRecorderButton.title = 'Grava ações, elementos HTML/Shadow DOM, mudanças, screenshots e comunicação do Protheus.';
  Object.assign(debugRecorderButton.style, {
    flex: '0 0 auto', padding: '4px 8px', border: '1px solid #0079b8', borderRadius: '5px',
    background: '#f7fbfd', color: '#0079b8', fontFamily: 'Arial, sans-serif', fontSize: '10px', cursor: 'pointer', fontWeight: '700'
  });
  debugRecorderRow.appendChild(debugRecorderStatus);
  debugRecorderRow.appendChild(debugRecorderButton);

  debugHeader.appendChild(debugTitle);
  debugHeader.appendChild(debugCancel);
  debugPanel.appendChild(debugHeader);
  debugPanel.appendChild(debugStatus);
  debugPanel.appendChild(debugElapsed);
  debugPanel.appendChild(debugUpdated);
  debugPanel.appendChild(debugBackgroundStatus);
  debugPanel.appendChild(debugLogRow);
  debugPanel.appendChild(debugRecorderRow);
  document.body.appendChild(debugPanel);

  function showDebugPanel() {
    debugPanel.classList.add('pos-ui-debug-visible');
  }

  function hideDebugPanel(force) {
    if (generalRecorderActive && force !== true) return;
    debugPanel.classList.remove('pos-ui-debug-visible');
  }

  function setDebugStatus(message) {
    const next = String(message || '').trim() || 'Aguardando...';
    const now = new Date();
    if (next !== debugCurrentStatus) {
      debugCurrentStatus = next;
      debugStepStartedAt = Date.now();
      debugStatus.textContent = next;
      debugElapsed.textContent = 'Tempo nesta etapa: 00:00';
    }
    debugUpdated.textContent = 'Última atualização: ' + formatClock(now);
  }

  function setCancelEnabled(enabled) {
    debugCancel.disabled = false;
    debugCancel.style.cursor = 'pointer';
    debugCancel.style.color = enabled ? '#a12622' : '#69767d';
    debugCancel.style.background = enabled ? '#fff1f0' : 'transparent';
    debugCancel.title = enabled ? 'Cancelar rotina em execução' : 'Fechar painel de debug';
    debugCancel.setAttribute('aria-label', debugCancel.title);
  }

  setCancelEnabled(false);

  debugTimer = window.setInterval(() => {
    debugElapsed.textContent = 'Tempo nesta etapa: ' + formatElapsed(Date.now() - debugStepStartedAt);
    if (generalRecorderActive) renderRecorderStatus();
  }, 1000);

  function showContinuationToast(message) {
    const id = 'positiva-protheus-continuation-toast';
    document.getElementById(id)?.remove();

    const toast = document.createElement('div');
    toast.id = id;
    toast.textContent = message || api.CONTINUATION_MESSAGE;
    Object.assign(toast.style, {
      position: 'fixed',
      right: '18px',
      bottom: '146px',
      zIndex: '2147483647',
      maxWidth: '360px',
      padding: '13px 16px',
      borderRadius: '8px',
      background: '#263238',
      color: '#ffffff',
      boxShadow: '0 6px 22px rgba(0,0,0,.28)',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      lineHeight: '1.35'
    });

    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 6000);
  }

  function requestEmergencyStop(origin) {
    const activeController = runningController;
    if (activeController && !activeController.signal.aborted) {
      runningAbortOrigin = origin === 'user-f11' ? 'user-f11' : 'user-debug-x';
      const byF11 = runningAbortOrigin === 'user-f11';
      setDebugStatus(byF11 ? 'EMERGÊNCIA F11 — cancelando rotina imediatamente...' : 'Cancelando rotina...');
      diagnosticLogger.log(
        byF11 ? 'EMERGENCY_ABORT' : 'RUN_ABORT',
        byF11 ? 'F11 acionado; cancelamento imediato solicitado.' : 'Cancelamento solicitado pelo X do painel de debug.',
        { origin: runningAbortOrigin, state: runtimeState() }
      );
      try { activeController.abort(); } catch (_) {}
      setCancelEnabled(false);
      return true;
    }

    // Sem rotina ativa, o X/F11 continua tendo efeito útil: fecha o painel.
    // O Gravador Geral, se estiver ativo, continua rodando e pode ser parado pelo botão próprio.
    hideDebugPanel(true);
    diagnosticLogger.log('DEBUG_PANEL_CLOSE', 'Painel de debug fechado sem rotina ativa.', { origin: String(origin || '') });
    return false;
  }

  const onDebugCancel = (event) => {
    try { event.stopPropagation(); } catch (_) {}
    requestEmergencyStop('user-debug-x');
  };
  debugCancel.addEventListener('click', onDebugCancel);

  const onEmergencyF11 = (event) => {
    if (!event || !(event.key === 'F11' || event.code === 'F11')) return;
    try { event.preventDefault(); } catch (_) {}
    try { event.stopPropagation(); } catch (_) {}
    try { event.stopImmediatePropagation(); } catch (_) {}
    requestEmergencyStop('user-f11');
  };

  const onAuthorizeLogs = async (event) => {
    event.stopPropagation();
    if (!debugLogAuthorize || debugLogAuthorize.disabled) return;
    debugLogAuthorize.disabled = true;
    debugLogStatus.textContent = 'Logs: selecione a pasta Logs...';
    try {
      await diagnosticLogger.authorizeDirectory();
      diagnosticLogger.log('LOG', 'Pasta de logs autorizada.', { directory: diagnosticApi.EXPECTED_DIRECTORY });
    } catch (error) {
      const message = error && error.message ? String(error.message) : 'Falha ao autorizar pasta de logs.';
      debugLogStatus.textContent = 'Logs: ' + message;
    } finally {
      debugLogAuthorize.disabled = false;
      renderLoggerState(diagnosticLogger.getState());
    }
  };
  debugLogAuthorize.addEventListener('click', onAuthorizeLogs);

  const setRecorderButtonInactive = () => {
    if (debugRecorderButton) {
      debugRecorderButton.textContent = '● Gravar';
      debugRecorderButton.style.background = '#f7fbfd';
      debugRecorderButton.style.color = '#0079b8';
      debugRecorderButton.style.borderColor = '#0079b8';
    }
    if (menuRecorderButton) {
      menuRecorderButton.textContent = '● Gravador Geral';
      menuRecorderButton.style.color = '#00659a';
      menuRecorderButton.style.background = '#f3f9fc';
    }
    renderRecorderStatus();
  };

  const setRecorderButtonActive = () => {
    if (debugRecorderButton) {
      debugRecorderButton.textContent = '■ Parar e baixar';
      debugRecorderButton.style.background = '#fff1f0';
      debugRecorderButton.style.color = '#a12622';
      debugRecorderButton.style.borderColor = '#d87a72';
    }
    if (menuRecorderButton) {
      menuRecorderButton.textContent = '■ Gravando — abrir Debug';
      menuRecorderButton.style.color = '#a12622';
      menuRecorderButton.style.background = '#fff1f0';
    }
    renderRecorderStatus();
  };

  const onGeneralRecorderButton = async (event) => {
    event.stopPropagation();
    if (!debugRecorderButton || debugRecorderButton.disabled) return;
    debugRecorderButton.disabled = true;
    try {
      if (!generalRecorderActive) {
        showDebugPanel();
        setDebugStatus('Iniciando Gravador Geral...');
        await startGeneralRecorder();
        setRecorderButtonActive();
        setDebugStatus('GRAVAÇÃO ATIVA — execute o fluxo manualmente; ao terminar clique em “Parar e baixar”.');
        return;
      }

      setDebugStatus('Finalizando gravação e montando diagnóstico...');
      const payload = await stopGeneralRecorder();
      const filename = downloadGeneralRecording(payload);
      setRecorderButtonInactive();
      setDebugStatus('Gravação salva: ' + filename);
    } catch (error) {
      generalRecorderActive = false;
      stopGeneralRecorderObservers();
      setRecorderButtonInactive();
      diagnosticLogger.log('RECORDER_ERROR', 'Falha no Gravador Geral.', { message: String(error && error.message || error) });
      setDebugStatus('ERRO no gravador: ' + String(error && error.message || error));
    } finally {
      debugRecorderButton.disabled = false;
    }
  };
  debugRecorderButton.addEventListener('click', onGeneralRecorderButton);

  diagnosticLogger.init().catch(() => renderLoggerState(diagnosticLogger.getState()));

  const onUserClickDiagnostic = (event) => {
    if (!event || event.isTrusted !== true || !diagnosticLogger.isActive()) return;
    diagnosticLogger.log('BROWSER_CLICK', 'Clique observado no Protheus (pode ser manual ou enviado via CDP).', {
      target: diagnosticApi.describeEventTarget(event),
      state: runtimeState()
    });
  };

  const onUserKeyDiagnostic = (event) => {
    if (!event || event.isTrusted !== true || !diagnosticLogger.isActive()) return;
    diagnosticLogger.log('BROWSER_KEY', 'Tecla observada no Protheus (pode ser manual ou enviada via CDP).', Object.assign(
      { target: diagnosticApi.describeEventTarget(event), state: runtimeState() },
      diagnosticApi.sanitizeKeyboardEvent(event)
    ));
  };

  const onVisibilityDiagnostic = () => {
    // Apenas registra a mudança. Reaplicar CDP aqui criava realimentação:
    // visibilitychange -> CDP -> novo visibilitychange -> CDP...
    // O background já mantém a sessão ativa e faz uma reaplicação periódica
    // de baixa frequência, portanto não precisamos reagir a cada evento.
    if (diagnosticLogger.isActive()) diagnosticLogger.log('STATE', 'visibilitychange.', runtimeState());
  };
  const onWindowFocusDiagnostic = () => {
    if (diagnosticLogger.isActive()) diagnosticLogger.log('STATE', 'window focus.', runtimeState());
  };
  const onWindowBlurDiagnostic = () => {
    if (diagnosticLogger.isActive()) diagnosticLogger.log('STATE', 'window blur.', runtimeState());
  };
  const onWindowErrorDiagnostic = (event) => {
    if (!diagnosticLogger.isActive()) return;
    diagnosticLogger.log('JS_ERROR', 'Erro JavaScript capturado.', {
      message: String(event && event.message || 'Erro sem mensagem'),
      filename: String(event && event.filename || ''),
      line: Number(event && event.lineno || 0),
      column: Number(event && event.colno || 0),
      stack: event && event.error && event.error.stack ? String(event.error.stack).slice(0, 3000) : ''
    });
  };
  const onUnhandledRejectionDiagnostic = (event) => {
    if (!diagnosticLogger.isActive()) return;
    const reason = event && event.reason;
    diagnosticLogger.log('PROMISE_ERROR', 'Promise rejeitada sem tratamento.', {
      message: reason && reason.message ? String(reason.message) : String(reason || ''),
      stack: reason && reason.stack ? String(reason.stack).slice(0, 3000) : ''
    });
  };

  const onRecorderClick = (event) => recordGeneralRecorderEvent('click', event);
  const onRecorderDoubleClick = (event) => recordGeneralRecorderEvent('dblclick', event);
  const onRecorderInput = (event) => recordGeneralRecorderEvent('input', event);
  const onRecorderChange = (event) => recordGeneralRecorderEvent('change', event);
  const onRecorderKeyDown = (event) => recordGeneralRecorderEvent('keydown', event);
  const onRecorderKeyUp = (event) => recordGeneralRecorderEvent('keyup', event);
  const onRecorderFocusIn = (event) => recordGeneralRecorderEvent('focusin', event);
  const onRecorderFocusOut = (event) => recordGeneralRecorderEvent('focusout', event);

  document.addEventListener('click', onUserClickDiagnostic, true);
  document.addEventListener('click', onRecorderClick, true);
  document.addEventListener('dblclick', onRecorderDoubleClick, true);
  document.addEventListener('input', onRecorderInput, true);
  document.addEventListener('change', onRecorderChange, true);
  document.addEventListener('focusin', onRecorderFocusIn, true);
  document.addEventListener('focusout', onRecorderFocusOut, true);
  window.addEventListener('keydown', onEmergencyF11, true);
  document.addEventListener('keydown', onEmergencyF11, true);
  document.addEventListener('keydown', onUserKeyDiagnostic, true);
  document.addEventListener('keydown', onRecorderKeyDown, true);
  document.addEventListener('keyup', onRecorderKeyUp, true);
  document.addEventListener('visibilitychange', onVisibilityDiagnostic);
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('focus', onWindowFocusDiagnostic);
    window.addEventListener('blur', onWindowBlurDiagnostic);
    window.addEventListener('error', onWindowErrorDiagnostic);
    window.addEventListener('unhandledrejection', onUnhandledRejectionDiagnostic);
  }

  lastDriftTickAt = (window.performance && typeof window.performance.now === 'function') ? window.performance.now() : Date.now();
  driftTimer = typeof window.setInterval === 'function' ? window.setInterval(() => {
    const now = (window.performance && typeof window.performance.now === 'function') ? window.performance.now() : Date.now();
    const actualMs = now - lastDriftTickAt;
    lastDriftTickAt = now;
    const driftMs = actualMs - 1000;
    if (diagnosticLogger.isActive() && driftMs >= 300) {
      diagnosticLogger.log('TIMER', 'Atraso do event loop/timer detectado.', {
        expectedMs: 1000,
        actualMs: Math.round(actualMs),
        driftMs: Math.round(driftMs),
        state: runtimeState()
      });
    }
  }, 1000) : null;

  document.getElementById('positiva-protheus-start')?.remove();
  document.getElementById(menu.launcherId)?.remove();
  document.getElementById(menu.panelId)?.remove();

  const panel = document.createElement('div');
  panel.id = menu.panelId;
  panel.setAttribute('data-pos-ext-version', EXTENSION_VERSION);
  panel.classList.add('pos-ui-menu-panel');

  Object.assign(panel.style, {
    position: menu.position,
    left: '16px',
    bottom: '70px',
    zIndex: '2147483646',
    width: '240px',
    background: '#ffffff',
    border: '1px solid #d4dbe0',
    borderRadius: '10px',
    boxShadow: '0 8px 26px rgba(0,0,0,.24)',
    overflow: 'hidden',
    fontFamily: 'Arial, sans-serif'
  });

  const header = document.createElement('div');
  header.textContent = 'Rotinas';
  Object.assign(header.style, {
    padding: '11px 14px',
    background: '#0079b8',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '700'
  });
  panel.appendChild(header);

  const list = document.createElement('div');
  Object.assign(list.style, { padding: '7px' });

  function showCommissionRunOptions() {
    document.getElementById(RUN_OPTIONS_ID)?.remove();

    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.id = RUN_OPTIONS_ID;
      backdrop.className = 'pos-ui-run-options-backdrop';

      const card = document.createElement('div');
      card.className = 'pos-ui-run-options-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', 'Opções da Emissão de Comissões');
      card.addEventListener('click', (event) => event.stopPropagation());

      const title = document.createElement('div');
      title.textContent = 'Emissão de Comissões';
      Object.assign(title.style, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        fontWeight: '700',
        color: '#17313f',
        marginBottom: '5px'
      });

      const subtitle = document.createElement('div');
      subtitle.textContent = 'Escolha como a rotina deve iniciar.';
      Object.assign(subtitle.style, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '12px',
        color: '#667782',
        marginBottom: '15px'
      });

      const optionsWrap = document.createElement('div');
      Object.assign(optionsWrap.style, { display: 'grid', gap: '8px' });

      const makeOption = (text) => {
        const option = document.createElement('label');
        Object.assign(option.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px',
          border: '1px solid #d8e1e6',
          borderRadius: '10px',
          background: '#f8fbfd',
          cursor: 'pointer',
          fontFamily: 'Arial, sans-serif',
          fontSize: '13px',
          color: '#203844',
          userSelect: 'none'
        });
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.width = '17px';
        checkbox.style.height = '17px';
        checkbox.style.accentColor = '#0079b8';
        const optionText = document.createElement('span');
        optionText.textContent = text;
        option.appendChild(checkbox);
        option.appendChild(optionText);
        return { option, checkbox };
      };

      const skipGenerationOption = makeOption('Pular geração de lotes');
      const skipApprovalOption = makeOption('Pular aprovação dos lotes');
      const skipPaymentsOption = makeOption('Pular Gera Pagto + atualização do Excel');
      optionsWrap.appendChild(skipGenerationOption.option);
      optionsWrap.appendChild(skipApprovalOption.option);
      optionsWrap.appendChild(skipPaymentsOption.option);

      const actions = document.createElement('div');
      Object.assign(actions.style, {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
        marginTop: '16px'
      });

      const makeButton = (text, primary) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        Object.assign(button.style, {
          minWidth: '86px',
          height: '36px',
          padding: '0 14px',
          border: primary ? '1px solid #0079b8' : '1px solid #cbd6dc',
          borderRadius: '8px',
          background: primary ? '#0079b8' : '#ffffff',
          color: primary ? '#ffffff' : '#304650',
          fontFamily: 'Arial, sans-serif',
          fontSize: '12px',
          fontWeight: primary ? '700' : '600',
          cursor: 'pointer',
          transition: 'transform 120ms ease, background-color 150ms ease'
        });
        button.addEventListener('mousedown', () => { button.style.transform = 'scale(.97)'; });
        button.addEventListener('mouseup', () => { button.style.transform = 'scale(1)'; });
        button.addEventListener('mouseleave', () => { button.style.transform = 'scale(1)'; });
        return button;
      };

      const cancel = makeButton('Cancelar', false);
      const start = makeButton('Iniciar', true);
      actions.appendChild(cancel);
      actions.appendChild(start);

      card.appendChild(title);
      card.appendChild(subtitle);
      card.appendChild(optionsWrap);
      card.appendChild(actions);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      const finish = (value) => {
        if (!backdrop.isConnected) return;
        backdrop.classList.remove('pos-ui-run-options-visible');
        window.setTimeout(() => backdrop.remove(), 160);
        resolve(value);
      };

      cancel.addEventListener('click', () => finish(null));
      start.addEventListener('click', () => finish({
        skipLotGeneration: skipGenerationOption.checkbox.checked === true,
        skipLotApproval: skipApprovalOption.checkbox.checked === true,
        skipPayments: skipPaymentsOption.checkbox.checked === true
      }));
      backdrop.addEventListener('click', () => finish(null));
      window.requestAnimationFrame(() => {
        backdrop.classList.add('pos-ui-run-options-visible');
        try { start.focus(); } catch (_) {}
      });
    });
  }

  async function sendExcelSync(data) {
    return await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({
          type: 'pos-protheus-excel-sync',
          payload: {
            action: 'syncInternalCommissions',
            date: data && data.date || '',
            rows: data && Array.isArray(data.rows) ? data.rows : [],
            mapping: data && data.mapping || null
          }
        }, (response) => {
          const lastError = chrome.runtime && chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message || 'Falha ao comunicar com o helper do Excel.'));
            return;
          }
          if (!response || response.ok !== true) {
            const phase = response && response.phase ? ` [etapa Excel: ${response.phase}]` : '';
            reject(new Error(((response && response.error) || 'O helper do Excel não confirmou a atualização.') + phase));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function readSoomarWorkbook(period) {
    return await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({
          type: 'pos-protheus-soomar-read',
          payload: { action: 'readSoomarExpenses', period: String(period || '') }
        }, (response) => {
          const lastError = chrome.runtime && chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message || 'Falha ao comunicar com o helper do Soomar.'));
            return;
          }
          if (!response || response.ok !== true) {
            reject(new Error((response && response.error) || 'O helper não confirmou a leitura do arquivo Soomar.'));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function readJorgePdf(period) {
    return await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({
          type: 'pos-protheus-jorge-read',
          payload: { action: 'readJorgeReimbursementPdf', period: String(period || '') }
        }, (response) => {
          const lastError = chrome.runtime && chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message || 'Falha ao comunicar com o helper do Reembolso Plano Jorge.'));
            return;
          }
          if (!response || response.ok !== true) {
            reject(new Error((response && response.error) || 'O helper não confirmou a leitura do PDF do Reembolso Plano Jorge.'));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function readIssCorretoraPdf(period) {
    return await new Promise((resolve, reject) => {
      try {
        const payload = { action: 'readIssCorretoraPdf' };
        if (period) payload.period = String(period);
        chrome.runtime.sendMessage({
          type: 'pos-protheus-iss-corretora-read',
          payload
        }, (response) => {
          const lastError = chrome.runtime && chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message || 'Falha ao comunicar com o helper do ISS Corretora.'));
            return;
          }
          if (!response || response.ok !== true) {
            reject(new Error((response && response.error) || 'O helper não confirmou a leitura do PDF do ISS Corretora.'));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function readIssCorretoraCsvSources(period) {
    return await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({
          type: 'pos-protheus-iss-corretora-csv-read',
          payload: { action: 'readIssCorretoraCsvSources', period: String(period || '') }
        }, (response) => {
          const lastError = chrome.runtime && chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message || 'Falha ao comunicar com o helper dos CSVs do ISS Corretora.'));
            return;
          }
          if (!response || response.ok !== true) {
            reject(new Error((response && response.error) || 'O helper não confirmou a leitura dos CSVs do ISS Corretora.'));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  const SOOMAR_STEP_DELAY_STORAGE_KEY = 'soomarStepDelayMs';

  function loadSoomarStepDelayPreference() {
    return new Promise((resolve) => {
      const fallback = 200;
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) { resolve(fallback); return; }
        chrome.storage.local.get([SOOMAR_STEP_DELAY_STORAGE_KEY], (result) => {
          try {
            if (chrome.runtime && chrome.runtime.lastError) { resolve(fallback); return; }
          } catch (_) {}
          const stored = result && result[SOOMAR_STEP_DELAY_STORAGE_KEY];
          resolve(api.normalizeSoomarStepDelayMs(stored == null ? fallback : stored));
        });
      } catch (_) { resolve(fallback); }
    });
  }

  function saveSoomarStepDelayPreference(value) {
    const normalized = api.normalizeSoomarStepDelayMs(value);
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) { resolve(false); return; }
        chrome.storage.local.set({ [SOOMAR_STEP_DELAY_STORAGE_KEY]: normalized }, () => resolve(true));
      } catch (_) { resolve(false); }
    });
  }

  async function showSoomarRunOptions(titleText) {
    const initialDelayMs = await loadSoomarStepDelayPreference();
    return new Promise((resolve) => {
      const existing = document.getElementById('positiva-soomar-run-options');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'positiva-soomar-run-options';
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        background: 'rgba(15, 27, 34, .48)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', boxSizing: 'border-box'
      });

      const card = document.createElement('div');
      Object.assign(card.style, {
        width: 'min(430px, 92vw)', background: '#fff', borderRadius: '12px',
        boxShadow: '0 22px 70px rgba(0,0,0,.32)', padding: '18px', boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif'
      });

      const title = document.createElement('div');
      title.textContent = String(titleText || 'Soomar – Despesas');
      Object.assign(title.style, { fontSize: '17px', fontWeight: '700', color: '#173847', marginBottom: '6px' });

      const subtitle = document.createElement('div');
      subtitle.textContent = 'Escolha as opções desta execução.';
      Object.assign(subtitle.style, { fontSize: '12px', color: '#526b76', marginBottom: '14px' });

      const option = document.createElement('label');
      Object.assign(option.style, {
        display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
        border: '1px solid #d8e1e6', borderRadius: '10px', background: '#f8fbfd',
        cursor: 'pointer', fontSize: '13px', color: '#203844', userSelect: 'none'
      });
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      checkbox.style.width = '17px';
      checkbox.style.height = '17px';
      checkbox.style.accentColor = '#0079b8';
      const optionText = document.createElement('span');
      optionText.textContent = 'Mostrar validador de dados';
      option.appendChild(checkbox);
      option.appendChild(optionText);

      const approvalOption = document.createElement('label');
      Object.assign(approvalOption.style, {
        display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
        marginTop: '10px', border: '1px solid #d8e1e6', borderRadius: '10px', background: '#f8fbfd',
        cursor: 'pointer', fontSize: '13px', color: '#203844', userSelect: 'none'
      });
      const approvalCheckbox = document.createElement('input');
      approvalCheckbox.type = 'checkbox';
      approvalCheckbox.checked = false;
      approvalCheckbox.style.width = '17px';
      approvalCheckbox.style.height = '17px';
      approvalCheckbox.style.accentColor = '#0079b8';
      const approvalOptionText = document.createElement('span');
      approvalOptionText.textContent = 'Iniciar na etapa de aprovação';
      approvalOption.appendChild(approvalCheckbox);
      approvalOption.appendChild(approvalOptionText);

      const delayBox = document.createElement('div');
      Object.assign(delayBox.style, {
        marginTop: '12px', padding: '12px', border: '1px solid #d8e1e6', borderRadius: '10px',
        background: '#f8fbfd'
      });
      const delayHeader = document.createElement('div');
      Object.assign(delayHeader.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '9px' });
      const delayLabel = document.createElement('span');
      delayLabel.textContent = 'Delay entre ações';
      Object.assign(delayLabel.style, { fontSize: '13px', color: '#203844', fontWeight: '700' });
      const delayValue = document.createElement('span');
      delayValue.textContent = initialDelayMs >= 1000 ? '1 s' : (initialDelayMs + ' ms');
      Object.assign(delayValue.style, { fontSize: '12px', color: '#0079b8', fontWeight: '700', minWidth: '58px', textAlign: 'right' });
      delayHeader.appendChild(delayLabel);
      delayHeader.appendChild(delayValue);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '100';
      slider.max = '1000';
      slider.step = '100';
      slider.value = String(initialDelayMs);
      slider.style.width = '100%';
      slider.style.accentColor = '#0079b8';
      slider.setAttribute('aria-label', 'Delay entre ações');

      const delayScale = document.createElement('div');
      Object.assign(delayScale.style, { display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: '#71838c' });
      const fast = document.createElement('span');
      fast.textContent = '100 ms';
      const slow = document.createElement('span');
      slow.textContent = '1 s';
      delayScale.appendChild(fast);
      delayScale.appendChild(slow);
      delayBox.appendChild(delayHeader);
      delayBox.appendChild(slider);
      delayBox.appendChild(delayScale);
      slider.addEventListener('input', () => {
        const value = Math.max(100, Math.min(1000, Number(slider.value) || 200));
        delayValue.textContent = value >= 1000 ? '1 s' : (value + ' ms');
      });

      const actions = document.createElement('div');
      Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancelar';
      const start = document.createElement('button');
      start.type = 'button';
      start.textContent = 'Iniciar';
      for (const button of [cancel, start]) {
        Object.assign(button.style, {
          minWidth: '86px', height: '36px', padding: '0 14px', borderRadius: '8px',
          fontFamily: 'Arial, sans-serif', fontSize: '12px', fontWeight: '700', cursor: 'pointer'
        });
      }
      Object.assign(cancel.style, { border: '1px solid #cbd6dc', background: '#fff', color: '#304650' });
      Object.assign(start.style, { border: '1px solid #0079b8', background: '#0079b8', color: '#fff' });
      actions.appendChild(cancel);
      actions.appendChild(start);

      card.appendChild(title);
      card.appendChild(subtitle);
      card.appendChild(option);
      card.appendChild(approvalOption);
      card.appendChild(delayBox);
      card.appendChild(actions);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      const finish = (value) => {
        if (backdrop.isConnected) backdrop.remove();
        resolve(value);
      };
      cancel.addEventListener('click', () => finish(null));
      start.addEventListener('click', async () => { const selectedDelayMs = Math.max(100, Math.min(1000, Number(slider.value) || 200)); await saveSoomarStepDelayPreference(selectedDelayMs); finish({ showDataValidator: checkbox.checked === true, startAtApproval: approvalCheckbox.checked === true, stepDelayMs: selectedDelayMs }); });
      backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(null); });
      try { start.focus(); } catch (_) {}
    });
  }

  function formatSoomarMoney(cents) {
    const numeric = Number(cents || 0) / 100;
    try {
      return numeric.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch (_) {
      return 'R$ ' + numeric.toFixed(2).replace('.', ',');
    }
  }

  function buildSoomarPreviewText(preview, source, headingText) {
    const lines = [];
    lines.push(String(headingText || 'SOOMAR') + ' - CONFERÊNCIA DE DESPESAS');
    lines.push('Arquivo: ' + String(source && source.workbookName || ''));
    lines.push('Período: ' + String(preview && preview.period || ''));
    lines.push('Itens com valor: ' + String(preview && preview.rows ? preview.rows.length : 0));
    const unmapped = (preview && preview.rows ? preview.rows : []).filter((row) => !row.mappingFound).length;
    if (unmapped) lines.push('ATENÇÃO: ' + unmapped + ' item(ns) sem mapeamento de Tipo/Descrição.');
    lines.push('');

    (preview && preview.rows ? preview.rows : []).forEach((row, index) => {
      lines.push(String(index + 1).padStart(2, '0') + '. ' + row.observation);
      lines.push('Data Despesa : ' + row.dateText);
      lines.push('Tipo Despesa : ' + (row.typeCode || 'SEM MAPEAMENTO'));
      lines.push('Descrição    : ' + row.description);
      lines.push('Qtd. KM      : ' + row.quantityKm);
      lines.push('Valor KM     : ' + formatSoomarMoney(row.valueKmCents));
      lines.push('Vlr. Despesa : ' + formatSoomarMoney(row.valueCents));
      lines.push('Num. Recibo  : ' + row.receiptNumber);
      lines.push('Observação   : ' + row.observation);
      lines.push('');
    });
    return lines.join('\n');
  }

  function showSoomarPreview(preview, source, signal, titleText) {
    return new Promise((resolve) => {
      const existing = document.getElementById('positiva-soomar-preview-modal');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'positiva-soomar-preview-modal';
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        background: 'rgba(15, 27, 34, .48)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', boxSizing: 'border-box'
      });

      const card = document.createElement('div');
      Object.assign(card.style, {
        width: 'min(960px, 94vw)', maxHeight: '88vh', background: '#fff', borderRadius: '12px',
        boxShadow: '0 22px 70px rgba(0,0,0,.32)', padding: '18px', boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif', display: 'flex', flexDirection: 'column', gap: '12px'
      });

      const title = document.createElement('div');
      title.textContent = String(titleText || 'Soomar') + ' – Conferência de despesas';
      Object.assign(title.style, { fontSize: '17px', fontWeight: '700', color: '#173847' });

      const subtitle = document.createElement('div');
      const unmapped = (preview.rows || []).filter((row) => !row.mappingFound).length;
      subtitle.textContent = (preview.rows || []).length + ' item(ns) com valor encontrados' + (unmapped ? ' • ' + unmapped + ' sem mapeamento' : ' • todos mapeados');
      Object.assign(subtitle.style, { fontSize: '12px', color: unmapped ? '#a12622' : '#526b76' });

      const textarea = document.createElement('textarea');
      textarea.readOnly = true;
      textarea.value = buildSoomarPreviewText(preview, source, titleText);
      Object.assign(textarea.style, {
        width: '100%', minHeight: '470px', maxHeight: '65vh', resize: 'vertical', boxSizing: 'border-box',
        border: '1px solid #cfdbe1', borderRadius: '8px', padding: '12px', background: '#f8fbfd',
        color: '#16262d', fontFamily: 'Consolas, "Courier New", monospace', fontSize: '12px', lineHeight: '1.45'
      });

      const actions = document.createElement('div');
      Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end' });
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Continuar';
      Object.assign(close.style, {
        minWidth: '92px', height: '36px', border: '1px solid #0079b8', borderRadius: '8px',
        background: '#0079b8', color: '#fff', fontWeight: '700', cursor: 'pointer'
      });
      actions.appendChild(close);
      card.appendChild(title);
      card.appendChild(subtitle);
      card.appendChild(textarea);
      card.appendChild(actions);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      const finish = () => {
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', finish);
        if (backdrop.isConnected) backdrop.remove();
        resolve();
      };
      close.addEventListener('click', finish);
      backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(); });
      if (signal && typeof signal.addEventListener === 'function') {
        if (signal.aborted) finish();
        else signal.addEventListener('abort', finish, { once: true });
      }
      try { textarea.focus(); textarea.setSelectionRange(0, 0); } catch (_) {}
    });
  }

  async function runSoomarRoutine(item, routine, runOptions) {
    runOptions = runOptions || {};
    const stepDelayMs = api.normalizeSoomarStepDelayMs(runOptions.stepDelayMs);
    const original = routine.label;
    const periodInfo = api.getSoomarPeriodInfo(new Date());

    await diagnosticLogger.startRun({
      version: EXTENSION_VERSION,
      visibility: document.visibilityState,
      focus: (() => { try { return document.hasFocus(); } catch (_) { return false; } })(),
      userAgent: String((window.navigator && window.navigator.userAgent) || ''),
      extra: { href: String((window.location && window.location.href) || ''), trigger: 'menu', routine: 'soomar-despesas', period: periodInfo.period, showDataValidator: runOptions.showDataValidator === true, startAtApproval: runOptions.startAtApproval === true, stepDelayMs }
    });

    diagnosticLogger.log('SOOMAR_DELAY_CONFIG', 'Delay entre ações configurado para esta execução.', { stepDelayMs });

    runningAbortOrigin = 'none';
    runningController = new AbortController();
    let soomarOwnBackgroundProtection = false;
    showDebugPanel();
    setCancelEnabled(true);
    item.disabled = true;
    item.style.cursor = 'default';
    item.style.background = '#eef6fb';

    try {
      const status = 'SOOMAR — procurando PNB_Despesas_Soomar_' + periodInfo.period + '.xlsx...';
      item.textContent = status;
      setDebugStatus(status);
      diagnosticLogger.log('STATUS', status, runtimeState());

      const source = await readSoomarWorkbook(periodInfo.period);
      if (runningController.signal.aborted) throw api.makeAbortError();
      diagnosticLogger.log('SOOMAR_SOURCE_READY', 'Arquivo mensal do Soomar lido diretamente do XLSX.', {
        workbookName: source.workbookName || '', workbookPath: source.workbookPath || '', rows: Array.isArray(source.rows) ? source.rows.length : 0
      });

      const preview = api.buildSoomarExpensePreview(source.rows || [], new Date());
      const unknown = preview.rows.filter((row) => !row.mappingFound);
      diagnosticLogger.log('SOOMAR_PREVIEW_READY', 'Prévia de despesas montada.', {
        total: preview.rows.length,
        mapped: preview.rows.length - unknown.length,
        unmapped: unknown.map((row) => row.observation)
      });

      if (runOptions.showDataValidator) {
        const previewStatus = 'SOOMAR — ' + preview.rows.length + ' despesa(s) encontrada(s). Conferindo...';
        item.textContent = previewStatus;
        setDebugStatus(previewStatus);
        await showSoomarPreview(preview, source, runningController.signal);
        if (runningController.signal.aborted) throw api.makeAbortError();
      } else {
        diagnosticLogger.log('SOOMAR_PREVIEW_SKIPPED', 'Validador de dados desabilitado nesta execução; os dados estruturados permanecem disponíveis para o lançamento.', {
          total: preview.rows.length
        });
      }

      const onSoomarStatus = (message) => {
        const text = String(message || '');
        item.textContent = text;
        setDebugStatus(text);
        diagnosticLogger.log('STATUS', text, runtimeState());
      };
      const ensureSoomarBackgroundProtection = async () => {
        if (!backgroundProtectionActive) {
          await startBackgroundProtection();
          soomarOwnBackgroundProtection = true;
        } else {
          const protection = await sendBackgroundProtection('refresh');
          renderBackgroundProtection(protection);
          diagnosticLogger.log('BACKGROUND', 'Proteção Edge/CDP atualizada antes da navegação Soomar.', protection);
        }
      };

      if (!preview.rows.length) throw new Error('Soomar: não há despesa com valor para processar.');

      if (runOptions.startAtApproval === true) {
        diagnosticLogger.log('SOOMAR_APPROVAL_ONLY', 'Execução iniciada diretamente na etapa de aprovação.', { total: preview.rows.length });
        await ensureSoomarBackgroundProtection();
        await api.runSoomarApprovalSelection(document, preview.rows, {
          signal: runningController.signal,
          onStatus: onSoomarStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          onTrustedClick: sendTrustedClick,
          onTrustedDoubleClick: sendTrustedDoubleClick,
          stepDelayMs
        });
      } else {
        await api.runSoomarEntryPreparation(document, {
          signal: runningController.signal,
          onStatus: onSoomarStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          stepDelayMs
        });
        if (runningController.signal.aborted) throw api.makeAbortError();

        await ensureSoomarBackgroundProtection();

        await api.runSoomarPostParameterNavigation(document, {
          signal: runningController.signal,
          onStatus: onSoomarStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          onTrustedClick: sendTrustedClick,
          stepDelayMs
        });
        if (runningController.signal.aborted) throw api.makeAbortError();

        await api.runSoomarExpenseRows(document, preview.rows, {
          signal: runningController.signal,
          onStatus: onSoomarStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          onTrustedDoubleClick: sendTrustedDoubleClick,
          onTrustedKey: sendTrustedKey,
          onTrustedText: sendTrustedText,
          stepDelayMs
        });
        if (runningController.signal.aborted) throw api.makeAbortError();

        await api.runSoomarSubmissionAndApprovalSelection(document, preview.rows, {
          signal: runningController.signal,
          onStatus: onSoomarStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          onTrustedClick: sendTrustedClick,
          onTrustedDoubleClick: sendTrustedDoubleClick,
          stepDelayMs
        });
      }
      if (runningController.signal.aborted) throw api.makeAbortError();

      const detail = runOptions.startAtApproval === true
        ? ('Soomar: ' + preview.rows.length + ' despesa(s) localizada(s) e marcada(s) para aprovação; confirmação da aprovação ainda não executada.')
        : ('Soomar: ' + preview.rows.length + ' despesa(s) enviadas e marcada(s) para aprovação; confirmação da aprovação ainda não executada.');
      await diagnosticLogger.stopRun('concluída', { detail, period: periodInfo.period });
      item.textContent = detail;
      setDebugStatus(detail);
      window.setTimeout(() => {
        item.textContent = original;
        item.disabled = false;
        item.style.cursor = 'pointer';
        item.style.background = 'transparent';
        closeMenu();
      }, 1800);
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setDebugStatus('Rotina Soomar cancelada pelo usuário.');
        await diagnosticLogger.stopRun('cancelada pelo usuário', { origin: runningAbortOrigin });
      } else {
        const message = String(error && error.message || 'Falha na rotina Soomar');
        item.textContent = message;
        setDebugStatus('ERRO: ' + message);
        diagnosticLogger.log('ERROR', 'Falha na rotina Soomar.', { message, stack: error && error.stack ? String(error.stack).slice(0, 4000) : '' });
        await diagnosticLogger.stopRun('erro', { message });
        item.style.color = '#a12622';
      }
      window.setTimeout(() => {
        item.textContent = original;
        item.style.color = '#1a1a1a';
        item.disabled = false;
        item.style.cursor = 'pointer';
        item.style.background = 'transparent';
      }, 3000);
    } finally {
      if (soomarOwnBackgroundProtection) {
        try { await stopBackgroundProtection(); } catch (_) {}
      }
      runningController = null;
      runningAbortOrigin = 'none';
      setCancelEnabled(false);
      hideDebugPanel();
    }
  }

  async function runJorgeReimbursementRoutine(item, routine, runOptions) {
    runOptions = runOptions || {};
    const stepDelayMs = api.normalizeSoomarStepDelayMs(runOptions.stepDelayMs);
    const original = routine.label;
    const periodInfo = api.getSoomarPeriodInfo(new Date());

    await diagnosticLogger.startRun({
      version: EXTENSION_VERSION,
      visibility: document.visibilityState,
      focus: (() => { try { return document.hasFocus(); } catch (_) { return false; } })(),
      userAgent: String((window.navigator && window.navigator.userAgent) || ''),
      extra: { href: String((window.location && window.location.href) || ''), trigger: 'menu', routine: 'reembolso-plano-jorge', period: periodInfo.period, showDataValidator: runOptions.showDataValidator === true, startAtApproval: runOptions.startAtApproval === true, stepDelayMs }
    });

    diagnosticLogger.log('JORGE_DELAY_CONFIG', 'Delay entre ações configurado para esta execução.', { stepDelayMs });

    runningAbortOrigin = 'none';
    runningController = new AbortController();
    let ownBackgroundProtection = false;
    showDebugPanel();
    setCancelEnabled(true);
    item.disabled = true;
    item.style.cursor = 'default';
    item.style.background = '#eef6fb';

    try {
      const month = String(periodInfo.month).padStart(2, '0');
      const status = 'PLANO JORGE — procurando ' + month + '.pdf...';
      item.textContent = status;
      setDebugStatus(status);
      diagnosticLogger.log('STATUS', status, runtimeState());

      const rawSource = await readJorgePdf(periodInfo.period);
      if (runningController.signal.aborted) throw api.makeAbortError();
      diagnosticLogger.log('JORGE_SOURCE_READY', 'PDF mensal do Reembolso Plano Jorge lido diretamente do arquivo.', {
        pdfName: rawSource.pdfName || '', pdfPath: rawSource.pdfPath || '', bytesBase64: String(rawSource.pdfBase64 || '').length
      });

      const extracted = api.extractJorgeReimbursementFromPdfBase64(rawSource.pdfBase64 || '', periodInfo.period);
      const preview = api.buildJorgeReimbursementPreview(extracted, new Date());
      const source = {
        workbookName: rawSource.pdfName || (month + '.pdf'),
        workbookPath: rawSource.pdfPath || '',
        pdfName: rawSource.pdfName || (month + '.pdf'),
        pdfPath: rawSource.pdfPath || ''
      };
      diagnosticLogger.log('JORGE_PREVIEW_READY', 'Dados do pagamento extraídos do PDF e preparados para lançamento.', {
        paymentDate: extracted.paymentDate,
        valueCents: extracted.valueCents,
        typeCode: preview.rows[0] && preview.rows[0].typeCode,
        collaboratorCode: '000007',
        observation: preview.rows[0] && preview.rows[0].observation
      });

      if (runOptions.showDataValidator) {
        const previewStatus = 'PLANO JORGE — dados encontrados. Conferindo...';
        item.textContent = previewStatus;
        setDebugStatus(previewStatus);
        await showSoomarPreview(preview, source, runningController.signal, 'Reembolso Plano Jorge');
        if (runningController.signal.aborted) throw api.makeAbortError();
      } else {
        diagnosticLogger.log('JORGE_PREVIEW_SKIPPED', 'Validador de dados desabilitado; dados estruturados permanecem disponíveis para lançamento.', { total: preview.rows.length });
      }

      const onStatus = (message) => {
        const text = String(message || '').replace(/^SOOMAR\s*—/i, 'PLANO JORGE —');
        item.textContent = text;
        setDebugStatus(text);
        diagnosticLogger.log('STATUS', text, runtimeState());
      };
      const ensureBackgroundProtection = async () => {
        if (!backgroundProtectionActive) {
          await startBackgroundProtection();
          ownBackgroundProtection = true;
        } else {
          const protection = await sendBackgroundProtection('refresh');
          renderBackgroundProtection(protection);
          diagnosticLogger.log('BACKGROUND', 'Proteção Edge/CDP atualizada antes da navegação do Reembolso Plano Jorge.', protection);
        }
      };

      if (runOptions.startAtApproval === true) {
        diagnosticLogger.log('JORGE_APPROVAL_ONLY', 'Execução iniciada diretamente na etapa de aprovação.', { total: preview.rows.length });
        await ensureBackgroundProtection();
        await api.runSoomarApprovalSelection(document, preview.rows, {
          signal: runningController.signal,
          onStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          onTrustedClick: sendTrustedClick,
          onTrustedDoubleClick: sendTrustedDoubleClick,
          stepDelayMs
        });
      } else {
        await api.runSoomarEntryPreparation(document, {
          signal: runningController.signal,
          onStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          stepDelayMs
        });
        if (runningController.signal.aborted) throw api.makeAbortError();

        await ensureBackgroundProtection();
        await api.runSoomarPostParameterNavigation(document, {
          signal: runningController.signal,
          onStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          onTrustedClick: sendTrustedClick,
          collaboratorCode: '000007',
          stepDelayMs
        });
        if (runningController.signal.aborted) throw api.makeAbortError();

        await api.runSoomarExpenseRows(document, preview.rows, {
          signal: runningController.signal,
          onStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          onTrustedDoubleClick: sendTrustedDoubleClick,
          onTrustedKey: sendTrustedKey,
          onTrustedText: sendTrustedText,
          stepDelayMs
        });
        if (runningController.signal.aborted) throw api.makeAbortError();

        await api.runSoomarSubmissionAndApprovalSelection(document, preview.rows, {
          signal: runningController.signal,
          onStatus,
          onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
          onTrustedClick: sendTrustedClick,
          onTrustedDoubleClick: sendTrustedDoubleClick,
          stepDelayMs
        });
      }
      if (runningController.signal.aborted) throw api.makeAbortError();

      const detail = runOptions.startAtApproval === true
        ? 'Reembolso Plano Jorge localizado e marcado para aprovação; confirmação da aprovação ainda não executada.'
        : 'Reembolso Plano Jorge enviado e marcado para aprovação; confirmação da aprovação ainda não executada.';
      await diagnosticLogger.stopRun('concluída', { detail, period: periodInfo.period, paymentDate: extracted.paymentDate, valueCents: extracted.valueCents });
      item.textContent = detail;
      setDebugStatus(detail);
      window.setTimeout(() => {
        item.textContent = original;
        item.disabled = false;
        item.style.cursor = 'pointer';
        item.style.background = 'transparent';
        closeMenu();
      }, 1800);
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setDebugStatus('Rotina Reembolso Plano Jorge cancelada pelo usuário.');
        await diagnosticLogger.stopRun('cancelada pelo usuário', { origin: runningAbortOrigin });
      } else {
        const message = String(error && error.message || 'Falha na rotina Reembolso Plano Jorge');
        item.textContent = message;
        setDebugStatus('ERRO: ' + message);
        diagnosticLogger.log('ERROR', 'Falha na rotina Reembolso Plano Jorge.', { message, stack: error && error.stack ? String(error.stack).slice(0, 4000) : '' });
        await diagnosticLogger.stopRun('erro', { message });
        item.style.color = '#a12622';
      }
      window.setTimeout(() => {
        item.textContent = original;
        item.style.color = '#1a1a1a';
        item.disabled = false;
        item.style.cursor = 'pointer';
        item.style.background = 'transparent';
      }, 3000);
    } finally {
      if (ownBackgroundProtection) {
        try { await stopBackgroundProtection(); } catch (_) {}
      }
      runningController = null;
      runningAbortOrigin = 'none';
      setCancelEnabled(false);
      hideDebugPanel();
    }
  }

  function showIssCorretoraRunOptions() {
    return new Promise((resolve) => {
      const existing = document.getElementById('positiva-iss-corretora-options-modal');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'positiva-iss-corretora-options-modal';
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647', background: 'rgba(15, 27, 34, .48)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box'
      });

      const card = document.createElement('div');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', 'Opções do ISS Corretora');
      Object.assign(card.style, {
        width: 'min(500px, 94vw)', background: '#fff', borderRadius: '12px',
        boxShadow: '0 22px 70px rgba(0,0,0,.32)', padding: '18px', boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif'
      });

      const title = document.createElement('div');
      title.textContent = 'Opções do ISS Corretora';
      Object.assign(title.style, { fontSize: '17px', fontWeight: '700', color: '#173847' });
      const subtitle = document.createElement('div');
      subtitle.textContent = 'Escolha as tabelas e, se desejar, execute a baixa dos títulos pendentes.';
      Object.assign(subtitle.style, { marginTop: '5px', marginBottom: '14px', fontSize: '12px', color: '#617580' });

      const createOption = (text) => {
        const label = document.createElement('label');
        Object.assign(label.style, {
          display: 'flex', alignItems: 'center', gap: '9px', padding: '11px 12px', marginBottom: '8px',
          border: '1px solid #d8e1e6', borderRadius: '9px', background: '#f8fbfd',
          color: '#203844', fontSize: '13px', cursor: 'pointer', userSelect: 'none'
        });
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = false;
        checkbox.style.width = '17px';
        checkbox.style.height = '17px';
        checkbox.style.accentColor = '#0079b8';
        const optionText = document.createElement('span');
        optionText.textContent = text;
        label.appendChild(checkbox);
        label.appendChild(optionText);
        return { label, checkbox };
      };

      const guideOption = createOption('Mostrar conferência da guia ISS');
      const protheusOption = createOption('Mostrar registros encontrados no Protheus');
      const settlementOption = createOption('Baixar em sequência todos os títulos SIM ainda pendentes (banco 033, motivo DÉBITO CC)');
      const pauseDateOption = createOption('Pausar no Vencto Real para eu informar a data manualmente');
      const afterFilterOption = createOption('Começar após aplicação do filtro (filtro já aplicado no Protheus)');

      const syncPauseDateAvailability = () => {
        const disabled = afterFilterOption.checkbox.checked === true;
        pauseDateOption.checkbox.disabled = disabled;
        if (disabled) pauseDateOption.checkbox.checked = false;
        pauseDateOption.label.style.opacity = disabled ? '.55' : '1';
        pauseDateOption.label.style.cursor = disabled ? 'default' : 'pointer';
      };
      afterFilterOption.checkbox.addEventListener('change', syncPauseDateAvailability);
      syncPauseDateAvailability();

      const actions = document.createElement('div');
      Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancelar';
      const start = document.createElement('button');
      start.type = 'button';
      start.textContent = 'Iniciar';
      for (const button of [cancel, start]) {
        Object.assign(button.style, {
          minWidth: '86px', height: '36px', padding: '0 14px', borderRadius: '8px',
          fontFamily: 'Arial, sans-serif', fontSize: '12px', fontWeight: '700', cursor: 'pointer'
        });
      }
      Object.assign(cancel.style, { border: '1px solid #cbd6dc', background: '#fff', color: '#304650' });
      Object.assign(start.style, { border: '1px solid #0079b8', background: '#0079b8', color: '#fff' });
      actions.appendChild(cancel);
      actions.appendChild(start);

      card.appendChild(title);
      card.appendChild(subtitle);
      card.appendChild(guideOption.label);
      card.appendChild(protheusOption.label);
      card.appendChild(settlementOption.label);
      card.appendChild(pauseDateOption.label);
      card.appendChild(afterFilterOption.label);
      card.appendChild(actions);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        if (backdrop.isConnected) backdrop.remove();
        resolve(value);
      };
      cancel.addEventListener('click', () => finish(null));
      start.addEventListener('click', () => finish({
        showGuideConference: guideOption.checkbox.checked === true,
        showProtheusRecords: protheusOption.checkbox.checked === true,
        settleAllRecords: settlementOption.checkbox.checked === true,
        pauseAtDueDate: pauseDateOption.checkbox.checked === true,
        startAfterFilter: afterFilterOption.checkbox.checked === true
      }));
      backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(null); });
      try { start.focus(); } catch (_) {}
    });
  }

  function showIssCorretoraManualDatePause(data, signal) {
    return new Promise((resolve) => {
      const existing = document.getElementById('positiva-iss-corretora-date-pause');
      if (existing) existing.remove();

      const panel = document.createElement('div');
      panel.id = 'positiva-iss-corretora-date-pause';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'ISS Corretora – Pausa no Vencto Real');
      Object.assign(panel.style, {
        position: 'fixed', right: '24px', top: '86px', zIndex: '2147483647',
        width: 'min(350px, calc(100vw - 48px))', padding: '15px 16px', boxSizing: 'border-box',
        background: '#fff', border: '1px solid #cbd8df', borderRadius: '12px',
        boxShadow: '0 16px 48px rgba(0,0,0,.28)', fontFamily: 'Arial, sans-serif', color: '#203844'
      });

      const title = document.createElement('div');
      title.textContent = 'Rotina pausada no Vencto Real';
      Object.assign(title.style, { fontSize: '15px', fontWeight: '700', color: '#173847' });

      const text = document.createElement('div');
      text.textContent = 'Digite a data desejada diretamente no campo Vencto Real do Protheus e depois clique em Continuar.';
      Object.assign(text.style, { marginTop: '7px', fontSize: '12px', lineHeight: '1.45', color: '#536b77' });

      const suggested = document.createElement('div');
      suggested.textContent = 'Data automática seria: ' + String(data && data.suggestedValue || '');
      Object.assign(suggested.style, { marginTop: '8px', fontSize: '11px', color: '#7a8d96' });

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Continuar';
      Object.assign(button.style, {
        display: 'block', marginLeft: 'auto', marginTop: '13px', minWidth: '100px', height: '36px',
        padding: '0 16px', border: '1px solid #0079b8', borderRadius: '8px',
        background: '#0079b8', color: '#fff', fontWeight: '700', cursor: 'pointer'
      });

      panel.appendChild(title);
      panel.appendChild(text);
      panel.appendChild(suggested);
      panel.appendChild(button);
      document.body.appendChild(panel);

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', finish);
        if (panel.isConnected) panel.remove();
        resolve();
      };
      button.addEventListener('click', finish);
      if (signal && typeof signal.addEventListener === 'function') {
        if (signal.aborted) finish();
        else signal.addEventListener('abort', finish, { once: true });
      }
    });
  }

  function showIssCorretoraConference(data, signal) {
    return new Promise((resolve) => {
      const existing = document.getElementById('positiva-iss-corretora-conference-modal');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'positiva-iss-corretora-conference-modal';
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        background: 'rgba(15, 27, 34, .48)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', boxSizing: 'border-box'
      });

      const card = document.createElement('div');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', 'ISS Corretora – Conferência da guia');
      Object.assign(card.style, {
        width: 'min(1320px, 96vw)', maxHeight: '90vh', background: '#fff', borderRadius: '12px',
        boxShadow: '0 22px 70px rgba(0,0,0,.32)', padding: '18px', boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden'
      });

      const title = document.createElement('div');
      title.textContent = 'ISS Corretora – Conferência da guia';
      Object.assign(title.style, { fontSize: '17px', fontWeight: '700', color: '#173847' });

      const fieldsRow = document.createElement('div');
      Object.assign(fieldsRow.style, {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '8px', width: '100%', minWidth: '0'
      });

      const fields = api.getIssCorretoraConferenceFields(data);
      fields.forEach((field) => {
        const fieldBox = document.createElement('div');
        Object.assign(fieldBox.style, {
          minWidth: '0', display: 'flex', alignItems: 'baseline', gap: '6px',
          padding: '9px 10px', border: '1px solid #d8e1e6', borderRadius: '9px',
          background: '#f8fbfd', boxSizing: 'border-box', whiteSpace: 'normal', overflow: 'hidden'
        });

        const label = document.createElement('span');
        label.textContent = field.label + ':';
        Object.assign(label.style, {
          flex: '0 0 auto', fontSize: '11px', fontWeight: '700', color: '#617580', userSelect: 'text'
        });

        const value = document.createElement('span');
        value.textContent = field.value;
        value.title = field.value;
        Object.assign(value.style, {
          minWidth: '0', fontSize: '13px', fontWeight: '600', color: '#17313f', userSelect: 'text', cursor: 'text',
          overflowWrap: 'anywhere', lineHeight: '1.25'
        });

        fieldBox.appendChild(label);
        fieldBox.appendChild(value);
        fieldsRow.appendChild(fieldBox);
      });

      const records = data && data.csvAnalysis && Array.isArray(data.csvAnalysis.records) ? data.csvAnalysis.records : [];
      const details = document.createElement('details');
      details.open = true;
      Object.assign(details.style, {
        border: '1px solid #d8e1e6', borderRadius: '9px', background: '#fbfdfe', overflow: 'hidden'
      });

      const summary = document.createElement('summary');
      summary.textContent = 'Registros encontrados (' + String(records.length) + ')';
      Object.assign(summary.style, {
        padding: '10px 12px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', color: '#244654', userSelect: 'none'
      });
      details.appendChild(summary);

      if (records.length > 0) {
        const tableWrap = document.createElement('div');
        Object.assign(tableWrap.style, { maxHeight: '380px', overflow: 'auto', borderTop: '1px solid #e3eaee' });
        const table = document.createElement('table');
        Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', fontSize: '12px', color: '#17313f' });

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Origem', 'NFS-e', 'Nº da guia', 'Código serviço', 'ISS devido'].forEach((text) => {
          const th = document.createElement('th');
          th.textContent = text;
          Object.assign(th.style, {
            position: 'sticky', top: '0', zIndex: '1', background: '#edf4f7', padding: '8px 10px',
            borderBottom: '1px solid #d8e1e6', textAlign: text === 'ISS devido' ? 'right' : 'left',
            fontWeight: '700', whiteSpace: 'nowrap', userSelect: 'text'
          });
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const formatCents = (cents) => {
          const value = Math.max(0, Math.trunc(Number(cents) || 0));
          const integer = String(Math.floor(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
          return 'R$ ' + integer + ',' + String(value % 100).padStart(2, '0');
        };
        records.forEach((record, index) => {
          const tr = document.createElement('tr');
          if (index % 2 === 1) tr.style.background = '#f8fbfd';
          const values = [record.sourceType, record.nfseNumber, record.guideNumber, record.serviceCode, formatCents(record.issDueCents)];
          values.forEach((text, columnIndex) => {
            const td = document.createElement('td');
            td.textContent = String(text == null ? '' : text);
            Object.assign(td.style, {
              padding: '7px 10px', borderBottom: '1px solid #edf1f3', whiteSpace: 'nowrap',
              textAlign: columnIndex === 4 ? 'right' : 'left', userSelect: 'text', cursor: 'text'
            });
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        details.appendChild(tableWrap);
      }

      const actions = document.createElement('div');
      Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end' });
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Continuar';
      Object.assign(close.style, {
        minWidth: '92px', height: '36px', border: '1px solid #0079b8', borderRadius: '8px',
        background: '#0079b8', color: '#fff', fontWeight: '700', cursor: 'pointer'
      });

      actions.appendChild(close);
      card.appendChild(title);
      card.appendChild(fieldsRow);
      card.appendChild(details);
      card.appendChild(actions);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', finish);
        if (backdrop.isConnected) backdrop.remove();
        resolve();
      };
      close.addEventListener('click', finish);
      backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(); });
      if (signal && typeof signal.addEventListener === 'function') {
        if (signal.aborted) finish();
        else signal.addEventListener('abort', finish, { once: true });
      }
      try { close.focus(); } catch (_) {}
    });
  }

  function showIssProtheusResults(data, signal) {
    return new Promise((resolve) => {
      const existing = document.getElementById('positiva-iss-protheus-results-modal');
      if (existing) existing.remove();

      const records = data && Array.isArray(data.records) ? data.records : [];
      const summaryData = data && data.summary ? data.summary : api.buildIssProtheusRecordsSummary(records);
      const reconciliation = data && data.reconciliation && data.reconciliation.summary
        ? data.reconciliation.summary
        : {
            matchedCount: 0, matchedValueCents: 0, exactMatchedCount: 0, oneCentMatchedCount: 0,
            notFoundCount: 0, notFoundValueCents: 0, unmatchedMunicipalCount: 0, unmatchedMunicipalValueCents: 0,
            guideTotalCents: 0, directSettlementValueCents: 0, subsetTargetCents: 0,
            subsetSelectedCount: 0, subsetSelectedValueCents: 0, subsetResidualCents: 0
          };
      const money = (cents) => {
        const value = Math.trunc(Number(cents) || 0);
        const absolute = Math.abs(value);
        const integer = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (value < 0 ? '-R$ ' : 'R$ ') + integer + ',' + String(absolute % 100).padStart(2, '0');
      };

      const backdrop = document.createElement('div');
      backdrop.id = 'positiva-iss-protheus-results-modal';
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647', background: 'rgba(15, 27, 34, .48)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box'
      });

      const card = document.createElement('div');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', 'ISS Corretora – Registros encontrados no Protheus');
      Object.assign(card.style, {
        width: 'min(1500px, 97vw)', maxHeight: '92vh', background: '#fff', borderRadius: '12px',
        boxShadow: '0 22px 70px rgba(0,0,0,.32)', padding: '18px', boxSizing: 'border-box',
        fontFamily: 'Arial, sans-serif', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden'
      });

      const title = document.createElement('div');
      title.textContent = 'ISS Corretora – Registros encontrados no Protheus';
      Object.assign(title.style, { fontSize: '17px', fontWeight: '700', color: '#173847' });

      const subtitle = document.createElement('div');
      subtitle.textContent = 'Filtro aplicado e grade carregada. Confira o resumo e os títulos antes de continuar.';
      Object.assign(subtitle.style, { fontSize: '12px', color: '#617580', marginTop: '-5px' });

      const fieldsRow = document.createElement('div');
      Object.assign(fieldsRow.style, {
        display: 'flex', flexDirection: 'column', gap: '8px', width: '100%'
      });
      const summarySections = api.buildIssProtheusSummarySections(summaryData, reconciliation);
      const settlementTones = {
        blue: ['#eef7ff', '#1681c4'], green: ['#eef9f2', '#24854d'], amber: ['#fff8e8', '#c88612'],
        purple: ['#f5efff', '#7b4bc4'], slate: ['#f2f6f8', '#627985']
      };
      summarySections.forEach((sectionData) => {
        const section = document.createElement('section');
        section.setAttribute('data-summary-section', sectionData.id);
        Object.assign(section.style, {
          border: '1px solid #d8e1e6', borderRadius: '9px', background: '#f8fbfd', padding: '8px 10px', boxSizing: 'border-box'
        });
        const sectionTitle = document.createElement('div');
        sectionTitle.textContent = sectionData.title;
        Object.assign(sectionTitle.style, {
          color: '#506975', fontSize: '10px', fontWeight: '700', letterSpacing: '.35px',
          textTransform: 'uppercase', marginBottom: '6px'
        });
        const sectionGrid = document.createElement('div');
        const minimumWidth = sectionData.id === 'settlement' ? '170px' : (sectionData.id === 'conference' ? '190px' : '130px');
        Object.assign(sectionGrid.style, {
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(' + minimumWidth + ', 1fr))', gap: '6px'
        });
        sectionData.items.forEach((item) => {
          const box = document.createElement('div');
          const tone = settlementTones[item.tone] || ['transparent', '#c7d4da'];
          Object.assign(box.style, {
            minWidth: '0', padding: sectionData.id === 'settlement' ? '7px 10px' : '5px 9px',
            borderLeft: (sectionData.id === 'settlement' ? '4px' : '1px') + ' solid ' + tone[1],
            borderRadius: '6px', background: sectionData.id === 'settlement' ? tone[0] : 'transparent', boxSizing: 'border-box'
          });
          const label = document.createElement('div');
          label.textContent = String(item.label);
          Object.assign(label.style, { fontSize: '10.5px', fontWeight: '700', color: '#617580', marginBottom: '3px' });
          const value = document.createElement('div');
          const hasCents = Object.prototype.hasOwnProperty.call(item, 'valueCents');
          value.textContent = hasCents ? money(item.valueCents) : String(item.value == null ? '—' : item.value);
          Object.assign(value.style, {
            fontSize: sectionData.id === 'settlement' ? '16px' : '14px', fontWeight: '700', color: '#17313f',
            whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: '1.2'
          });
          box.appendChild(label);
          box.appendChild(value);
          if (item.detail || Object.prototype.hasOwnProperty.call(item, 'detailCents')) {
            const detail = document.createElement('div');
            detail.textContent = item.detail || money(item.detailCents);
            Object.assign(detail.style, { fontSize: '11px', color: '#617580', marginTop: '3px', whiteSpace: 'normal' });
            box.appendChild(detail);
          }
          sectionGrid.appendChild(box);
        });
        section.appendChild(sectionTitle);
        section.appendChild(sectionGrid);
        fieldsRow.appendChild(section);
      });

      const tableWrap = document.createElement('div');
      Object.assign(tableWrap.style, {
        minHeight: '180px', maxHeight: '520px', overflow: 'auto', border: '1px solid #d8e1e6', borderRadius: '9px'
      });
      const table = document.createElement('table');
      Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', fontSize: '12px', color: '#17313f' });
      const columns = [
        ['Prefixo', 'prefix'], ['No. Título', 'title'], ['Parcela', 'installment'], ['Tipo', 'type'],
        ['Fornecedor', 'supplier'], ['Loja', 'store'], ['Nome fornecedor', 'supplierName'], ['Natureza', 'nature'],
        ['DT Emissão', 'issueDate'], ['Vencto real', 'actualDueDate'], ['Vlr. título', 'titleValueCents'],
        ['Valor Prefeitura', 'municipalIssDueCents'], ['Diferença', 'municipalDifferenceCents'],
        ['NFS-e Prefeitura', 'municipalNfseNumber'],
        ['Situação Prefeitura', 'municipalMatchStatus'], ['Dar baixa', 'shouldSettle']
      ];
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      columns.forEach(([labelText], index) => {
        const th = document.createElement('th');
        th.textContent = labelText;
        Object.assign(th.style, {
          position: 'sticky', top: '0', zIndex: '1', background: '#edf4f7', padding: '8px 10px',
          borderBottom: '1px solid #d8e1e6', textAlign: index === columns.length - 1 ? 'right' : 'left',
          fontWeight: '700', whiteSpace: 'nowrap', userSelect: 'text'
        });
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      const matchStatusText = (record) => {
        if (record.settlementSource === 'subset') return 'Selecionado por subconjunto';
        if (record.municipalMatchKind === 'one-cent') return 'Encontrado (diferença de 1 centavo)';
        if (record.municipalMatchKind === 'exact') return 'Encontrado (exato)';
        if (record.municipalMatchStatus === 'not-found') return 'Não encontrado';
        return 'Não se aplica';
      };
      records.forEach((record, rowIndex) => {
        const tr = document.createElement('tr');
        if (record.settlementSource === 'subset') tr.style.background = '#f3e8ff';
        else if (record.municipalMatchKind === 'one-cent') tr.style.background = '#eaf4ff';
        else if (record.municipalMatchStatus === 'matched') tr.style.background = '#eaf7ee';
        else if (record.municipalMatchStatus === 'not-found') tr.style.background = '#fff5e8';
        else if (rowIndex % 2 === 1) tr.style.background = '#f8fbfd';
        columns.forEach(([, key], columnIndex) => {
          const td = document.createElement('td');
          if (key === 'titleValueCents') td.textContent = money(record[key]);
          else if (key === 'municipalIssDueCents') td.textContent = record.municipalMatchStatus === 'matched' ? money(record[key]) : '—';
          else if (key === 'municipalDifferenceCents') td.textContent = record.municipalMatchStatus === 'matched' ? money(record[key]) : '—';
          else if (key === 'municipalMatchStatus') td.textContent = matchStatusText(record);
          else if (key === 'shouldSettle') td.textContent = record.municipalMatchStatus === 'not-applicable' ? '—' :
            (record[key] === true ? (/^\d{2}\/\d{2}\/\d{4}$/.test(String(record.settlementDate || '').trim()) ? 'JÁ BAIXADO' : 'SIM') : 'NÃO');
          else td.textContent = String(record[key] == null || record[key] === '' ? '—' : record[key]);
          Object.assign(td.style, {
            padding: '7px 10px', borderBottom: '1px solid #edf1f3', whiteSpace: 'nowrap',
            textAlign: key === 'titleValueCents' || key === 'municipalIssDueCents' || key === 'municipalDifferenceCents' ? 'right' : 'left',
            userSelect: 'text', cursor: 'text'
          });
          if (key === 'shouldSettle') {
            td.style.fontWeight = '700';
            td.style.color = record.municipalMatchStatus === 'not-applicable' ? '#617580' : (record[key] === true ? '#19743b' : '#7a4d17');
          }
          if (key === 'municipalDifferenceCents' && record.municipalMatchKind === 'one-cent') {
            td.style.fontWeight = '700';
            td.style.color = '#005f9e';
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);

      const actions = document.createElement('div');
      Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end' });
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Continuar';
      Object.assign(close.style, {
        minWidth: '92px', height: '36px', border: '1px solid #0079b8', borderRadius: '8px',
        background: '#0079b8', color: '#fff', fontWeight: '700', cursor: 'pointer'
      });
      actions.appendChild(close);
      card.appendChild(title);
      card.appendChild(subtitle);
      card.appendChild(fieldsRow);
      card.appendChild(tableWrap);
      card.appendChild(actions);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', finish);
        if (backdrop.isConnected) backdrop.remove();
        resolve();
      };
      close.addEventListener('click', finish);
      backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(); });
      if (signal && typeof signal.addEventListener === 'function') {
        if (signal.aborted) finish();
        else signal.addEventListener('abort', finish, { once: true });
      }
      try { close.focus(); } catch (_) {}
    });
  }

  async function runIssCorretoraRoutine(item, routine, runOptions) {
    const displayOptions = api.getIssRunDisplayOptions(runOptions);
    const original = routine.label;
    let keepDebugOpenForRecorder = false;
    item.disabled = true;
    item.style.cursor = 'default';
    item.style.background = '#eef6fb';
    showDebugPanel();
    runningAbortOrigin = 'none';
    runningController = new AbortController();
    setCancelEnabled(true);

    await diagnosticLogger.startRun({
      version: EXTENSION_VERSION,
      visibility: document.visibilityState,
      focus: (() => { try { return document.hasFocus(); } catch (_) { return false; } })(),
      userAgent: String((window.navigator && window.navigator.userAgent) || ''),
      extra: {
        href: String((window.location && window.location.href) || ''), trigger: 'menu', routine: 'iss-corretora',
        stage: 'pdf-identification', showGuideConference: displayOptions.showGuideConference,
        showProtheusRecords: displayOptions.showProtheusRecords,
        startAfterFilter: displayOptions.startAfterFilter,
        settleAllRecords: displayOptions.settleAllRecords,
        pauseAtDueDate: displayOptions.pauseAtDueDate
      }
    });

    try {
      const searching = 'ISS CORRETORA — procurando guia DAMSP...';
      item.textContent = searching;
      setDebugStatus(searching);
      diagnosticLogger.log('STATUS', searching, runtimeState());

      const rawSource = await readIssCorretoraPdf('');
      if (runningController.signal.aborted) throw api.makeAbortError();
      const competence = api.getIssCorretoraCompetenceFromFileName(rawSource.pdfName || '');
      if (rawSource.period && String(rawSource.period) !== competence.period) {
        throw new Error('ISS Corretora: a competência retornada pelo helper diverge do nome do PDF.');
      }

      const extracted = await api.extractIssGuideFromPdfBase64(rawSource.pdfBase64 || '');
      if (runningController.signal.aborted) throw api.makeAbortError();
      diagnosticLogger.log('ISS_CORRETORA_PDF_READY', 'PDF do ISS Corretora identificado; número e total pago da guia extraídos.', {
        pdfName: rawSource.pdfName || '',
        pdfPath: rawSource.pdfPath || '',
        period: competence.period,
        competence: competence.competenceText,
        guideNumber: extracted.guideNumber,
        guideTotalCents: extracted.guideTotalCents,
        extractionMethod: extracted.method || '',
        barcodeDigits: extracted.barcodeDigits || ''
      });

      const csvSourceResponse = await readIssCorretoraCsvSources(competence.period);
      if (runningController.signal.aborted) throw api.makeAbortError();
      if (csvSourceResponse.period && String(csvSourceResponse.period) !== competence.period) {
        throw new Error('ISS Corretora: a competência retornada para os CSVs diverge do PDF.');
      }
      const csvSources = Array.isArray(csvSourceResponse.csvSources) ? csvSourceResponse.csvSources : [];
      if (csvSources.length !== 2) throw new Error('ISS Corretora: o helper deve retornar exatamente os dois CSVs da competência.');
      csvSources.forEach((source) => {
        const fileName = String(source && source.fileName || '');
        if (api.getIssCorretoraCsvFilePeriod(fileName) !== competence.period) {
          throw new Error('ISS Corretora: o CSV ' + fileName + ' não pertence à competência ' + competence.period + '.');
        }
      });
      const csvAnalysis = api.analyzeIssCorretoraCsvSources(csvSources, extracted.guideNumber);
      const detail = 'ISS Corretora — Competência: ' + competence.competenceText + ' — Nº da guia: ' + extracted.guideNumber +
        ' — Total pago: R$ ' + (extracted.guideTotalCents / 100).toFixed(2).replace('.', ',') + ' — Registros CSV: ' + csvAnalysis.records.length;
      diagnosticLogger.log('ISS_CORRETORA_CSV_READY', 'CSVs do ISS Corretora analisados e filtrados pela guia.', {
        period: competence.period,
        guideNumber: extracted.guideNumber,
        recordCount: csvAnalysis.records.length,
        totalIssDueCents: csvAnalysis.totalIssDueCents,
        sources: csvAnalysis.sources
      });

      if (displayOptions.showGuideConference) {
        item.textContent = 'ISS CORRETORA — conferência da guia pronta';
        setDebugStatus(detail);
        await showIssCorretoraConference({
          competenceText: competence.competenceText,
          guideNumber: extracted.guideNumber,
          guideTotalCents: extracted.guideTotalCents,
          pdfName: rawSource.pdfName || '',
          csvAnalysis
        }, runningController.signal);
        if (runningController.signal.aborted) throw api.makeAbortError();
      } else {
        diagnosticLogger.log('ISS_CORRETORA_GUIDE_CONFERENCE_SKIPPED', 'Tabela de conferência da guia não exibida por opção do usuário.', {});
      }

      let ownBackgroundProtection = false;
      let protheusResult = null;
      try {
        if (displayOptions.startAfterFilter) api.assertIssGridUnblocked(document);
        if (!backgroundProtectionActive) {
          await startBackgroundProtection();
          ownBackgroundProtection = true;
        }

        const currentMonthDayTen = api.formatIssDayTenOfCurrentMonth(new Date());
        const filterRules = [
          { field: 'Natureza', operator: 'Igual a', value: '20505' },
          { field: 'Vencto Real', operator: 'Igual a', value: currentMonthDayTen, valueType: 'date' }
        ];
        if (displayOptions.startAfterFilter) {
          if (!api.getIssCorretoraAccountsPayableReadiness(document).ready ||
              !api.findIssFilterBanner(document) || !api.isIssGridFilteredByRules(document, filterRules)) {
            throw new Error('ISS Corretora: abra Contas a Pagar e aplique antes o filtro Natureza 20505 e Vencto Real ' + currentMonthDayTen + '.');
          }
          diagnosticLogger.log('ISS_CORRETORA_PREAPPLIED_FILTER_READY', 'Filtro já aplicado: banner e linhas visíveis conferidos; Prefeitura já foi analisada.', {
            rules: filterRules
          });
        } else {
          const navigation = await api.runIssCorretoraAccountsPayableNavigation(document, {
            signal: runningController.signal,
            stepDelayMs: 200,
            onTrustedClick: (target) => sendTrustedClick(target, { issGuard: true }),
            onStatus: (status) => {
              item.textContent = status;
              setDebugStatus(status);
              diagnosticLogger.log('STATUS', status, runtimeState());
            },
            onLog: (category, message, data) => diagnosticLogger.log(category, message, data)
          });
          diagnosticLogger.log('ISS_CORRETORA_NAV_CLICKED', 'Clique de navegação em Funcoes Ctas a Pag concluído; a prontidão da tela será validada em seguida.', navigation);

          const dynamicFilter = await api.runIssCorretoraDynamicFilter(document, {
            signal: runningController.signal,
            filterName: 'AUTO ISS ' + competence.period + ' ' + String(Date.now()).slice(-6),
            rules: filterRules,
            onTrustedClick: (target) => sendTrustedClick(target, { issGuard: true }),
            onTrustedText: sendTrustedText,
            onTrustedKey: sendTrustedKey,
            onManualDatePause: displayOptions.pauseAtDueDate
              ? (data) => showIssCorretoraManualDatePause(data, runningController.signal)
              : null,
            onStatus: (status) => {
              item.textContent = status;
              setDebugStatus(status);
              diagnosticLogger.log('STATUS', status, runtimeState());
            },
            onLog: (category, message, data) => diagnosticLogger.log(category, message, data)
          });
          diagnosticLogger.log('ISS_CORRETORA_DYNAMIC_FILTER_READY', 'Filtro do ISS Corretora foi criado do zero pelo código e aplicado.', dynamicFilter);
        }

        const collecting = 'ISS CORRETORA — coletando registros encontrados no Protheus...';
        item.textContent = collecting;
        setDebugStatus(collecting);
        diagnosticLogger.log('STATUS', collecting, runtimeState());
        const protheusRecords = await api.collectIssProtheusGridRecords(document, {
          signal: runningController.signal,
          onTrustedClick: (target) => sendTrustedClick(target, { issGuard: true })
        });
        if (displayOptions.startAfterFilter) api.assertIssPreappliedFilter(protheusRecords, filterRules);
        const protheusSummary = api.buildIssProtheusRecordsSummary(protheusRecords);
        const directReconciliation = api.reconcileIssMunicipalWithProtheus(csvAnalysis.records, protheusRecords);
        const subsetStatus = 'ISS CORRETORA — calculando a melhor combinação dos títulos restantes...';
        item.textContent = subsetStatus;
        setDebugStatus(subsetStatus);
        diagnosticLogger.log('STATUS', subsetStatus, runtimeState());
        const reconciliation = await api.applyIssSubsetSelection(
          directReconciliation,
          extracted.guideTotalCents,
          { signal: runningController.signal }
        );
        protheusResult = { records: reconciliation.records, summary: protheusSummary, reconciliation };
        diagnosticLogger.log('ISS_CORRETORA_PROTHEUS_RECORDS_READY', 'Registros filtrados do Protheus foram coletados e resumidos.', {
          recordCount: protheusSummary.recordCount,
          totalTitleValueCents: protheusSummary.totalTitleValueCents,
          issCount: protheusSummary.issCount,
          txCount: protheusSummary.txCount,
          actualDueDate: protheusSummary.actualDueDate,
          nature: protheusSummary.nature
        });
        diagnosticLogger.log('ISS_CORRETORA_RECONCILIATION_READY', 'ISS da Prefeitura e títulos do Protheus comparados primeiro pelo valor exato e depois com tolerância máxima de um centavo.', {
          matchRule: 'exact-first-then-one-cent-one-to-one',
          matchedCount: reconciliation.summary.matchedCount,
          matchedValueCents: reconciliation.summary.matchedValueCents,
          exactMatchedCount: reconciliation.summary.exactMatchedCount,
          oneCentMatchedCount: reconciliation.summary.oneCentMatchedCount,
          notFoundCount: reconciliation.summary.notFoundCount,
          notFoundValueCents: reconciliation.summary.notFoundValueCents,
          notApplicableCount: reconciliation.summary.notApplicableCount,
          unmatchedMunicipalCount: reconciliation.summary.unmatchedMunicipalCount,
          unmatchedMunicipalValueCents: reconciliation.summary.unmatchedMunicipalValueCents
        });
        diagnosticLogger.log('ISS_CORRETORA_SUBSET_READY', 'Melhor combinação dos títulos restantes calculada sem ultrapassar o valor faltante da guia.', {
          guideTotalCents: reconciliation.summary.guideTotalCents,
          directSettlementValueCents: reconciliation.summary.directSettlementValueCents,
          alreadyPaidUnmatchedValueCents: reconciliation.summary.alreadyPaidUnmatchedValueCents,
          subsetTargetCents: reconciliation.summary.subsetTargetCents,
          subsetCandidateCount: reconciliation.summary.subsetCandidateCount,
          subsetSelectedCount: reconciliation.summary.subsetSelectedCount,
          subsetSelectedValueCents: reconciliation.summary.subsetSelectedValueCents,
          subsetResidualCents: reconciliation.summary.subsetResidualCents,
          totalSettlementValueCents: reconciliation.summary.totalSettlementValueCents
        });
        keepDebugOpenForRecorder = true;
        setDebugStatus('Filtro aplicado: ' + reconciliation.summary.matchedCount + ' correspondência(s) direta(s) e ' + reconciliation.summary.subsetSelectedCount + ' título(s) por subconjunto para baixa.');
      } finally {
        if (ownBackgroundProtection) {
          try { await stopBackgroundProtection(); } catch (_) {}
        }
      }

      if (!protheusResult) throw new Error('ISS Corretora: a conferência dos registros do Protheus não foi concluída.');
      if (displayOptions.showProtheusRecords) {
        item.textContent = 'ISS CORRETORA — registros do Protheus prontos';
        await showIssProtheusResults(protheusResult, runningController.signal);
      } else {
        diagnosticLogger.log('ISS_CORRETORA_PROTHEUS_RESULTS_SKIPPED', 'Tabela de registros do Protheus não exibida por opção do usuário.', {
          recordCount: protheusResult.summary.recordCount,
          totalTitleValueCents: protheusResult.summary.totalTitleValueCents
        });
      }
      api.throwIfAborted(runningController.signal);

      let batchResult = null;
      if (displayOptions.settleAllRecords) {
        const grid = api.findIssProtheusGrid(document);
        const headers = grid && grid.shadowRoot && Array.from(grid.shadowRoot.querySelectorAll('thead th'));
        if (!headers || !headers.some((th) => String(th.innerText || th.textContent || '').trim().toLowerCase() === 'dt baixa'))
          throw new Error('ISS Corretora: coluna DT Baixa não disponível para identificar títulos já baixados; lote bloqueado.');
        const plan = api.planIssSettlementBatch(protheusResult.records);
        diagnosticLogger.log('ISS_SETTLEMENT_BATCH_PLAN', 'Títulos SIM planejados; os já baixados foram separados antes de Salvar.', {
          pendingCount: plan.pending.length, alreadyPaidCount: plan.alreadyPaid.length, totalCents: plan.totalCents
        });
        item.textContent = 'ISS CORRETORA — conferindo e baixando títulos pendentes...';
        await startBackgroundProtection();
        try {
          batchResult = await api.runIssSettlementBatch(protheusResult.records, {
            signal: runningController.signal,
            confirm: (selection) => window.confirm(
              'CONFIRMAR BAIXA EM SEQUÊNCIA NO PROTHEUS?\n\n' +
              'Pendentes: ' + selection.pending.length + ' título(s) SIM\n' +
              'Já baixados (serão pulados): ' + selection.alreadyPaid.length + '\n' +
              'Total pendente: R$ ' + (selection.totalCents / 100).toFixed(2).replace('.', ',') + '\n' +
              'Banco: 033 | Motivo: DÉBITO CC\n\n' +
              'Cada título será conferido e salvo uma vez. A rotina parará se alguma baixa não for confirmada.'
            ),
            onProgress: (record, done, total) => {
              const status = 'ISS CORRETORA — baixando título ' + (done + 1) + '/' + total + ': ' + record.title + '...';
              item.textContent = status;
              setDebugStatus(status);
              diagnosticLogger.log('ISS_SETTLEMENT_ITEM_START', status, { identity: record.identity, done, total });
            },
            settle: async (record) => {
              const settled = await api.settleIssRecordInProtheus(document, record, {
                signal: runningController.signal,
                onTrustedClick: (target) => sendTrustedClick(target, { issGuard: true }),
                onTrustedHover: sendTrustedHover,
                onTrustedText: sendTrustedText,
                onTrustedKey: sendTrustedKey,
                onLog: (category, message, data) => diagnosticLogger.log(category, message, data),
                onStatus: (message) => setDebugStatus(message),
                onApprove: () => true
              });
              if (settled) diagnosticLogger.log('ISS_SETTLEMENT_ITEM_CONFIRMED', 'Baixa confirmada pela data do título na grade.', {
                identity: record.identity
              });
              return settled;
            }
          });
        } finally {
          await stopBackgroundProtection();
        }
        diagnosticLogger.log('ISS_SETTLEMENT_BATCH_RESULT', batchResult.cancelled ? 'Lote cancelado antes de Salvar.' : 'Baixas do lote confirmadas na grade.', {
          settledCount: batchResult.settled.length, alreadyPaidCount: batchResult.alreadyPaid.length, cancelled: batchResult.cancelled
        });
      }

      await diagnosticLogger.stopRun('concluída', {
        detail,
        period: competence.period,
        guideNumber: extracted.guideNumber,
        extractionMethod: extracted.method || '',
        recordCount: csvAnalysis.records.length,
        totalIssDueCents: csvAnalysis.totalIssDueCents,
        guideTotalCents: extracted.guideTotalCents,
        protheusRecordCount: protheusResult.summary.recordCount,
        protheusTotalTitleValueCents: protheusResult.summary.totalTitleValueCents,
        protheusIssCount: protheusResult.summary.issCount,
        protheusTxCount: protheusResult.summary.txCount,
        protheusMatchedIssCount: protheusResult.reconciliation.summary.matchedCount,
        protheusMatchedIssValueCents: protheusResult.reconciliation.summary.matchedValueCents,
        protheusExactMatchedIssCount: protheusResult.reconciliation.summary.exactMatchedCount,
        protheusOneCentMatchedIssCount: protheusResult.reconciliation.summary.oneCentMatchedCount,
        protheusSubsetTargetCents: protheusResult.reconciliation.summary.subsetTargetCents,
        protheusAlreadyPaidUnmatchedValueCents: protheusResult.reconciliation.summary.alreadyPaidUnmatchedValueCents,
        protheusSubsetSelectedCount: protheusResult.reconciliation.summary.subsetSelectedCount,
        protheusSubsetSelectedValueCents: protheusResult.reconciliation.summary.subsetSelectedValueCents,
        protheusSubsetResidualCents: protheusResult.reconciliation.summary.subsetResidualCents,
        protheusTotalSettlementValueCents: protheusResult.reconciliation.summary.totalSettlementValueCents,
        protheusUnmatchedIssCount: protheusResult.reconciliation.summary.notFoundCount,
        municipalUnmatchedCount: protheusResult.reconciliation.summary.unmatchedMunicipalCount,
        settlementConfirmedCount: batchResult ? batchResult.settled.length : 0,
        settlementAlreadyPaidCount: batchResult ? batchResult.alreadyPaid.length : 0,
        settlementBatchCancelled: !!(batchResult && batchResult.cancelled)
      });
      item.textContent = original;
      item.disabled = false;
      item.style.cursor = 'pointer';
      item.style.background = 'transparent';
      closeMenu();
    } catch (error) {
      if (error && error.name === 'AbortError') {
        item.textContent = original;
        item.style.color = '#1a1a1a';
        item.disabled = false;
        item.style.cursor = 'pointer';
        item.style.background = 'transparent';
        const userCancelled = runningAbortOrigin === 'user-debug-x' || runningAbortOrigin === 'user-f11';
        if (userCancelled) {
          setDebugStatus('Rotina ISS Corretora cancelada pelo usuário.');
          await diagnosticLogger.stopRun('cancelada pelo usuário', { origin: runningAbortOrigin });
        } else {
          const internalReason = runningAbortOrigin === 'none' ? 'origem desconhecida' : runningAbortOrigin;
          setDebugStatus('Rotina ISS Corretora interrompida internamente: ' + internalReason + '.');
          diagnosticLogger.log('RUN_ABORT', 'ISS Corretora interrompida internamente.', { origin: internalReason });
          await diagnosticLogger.stopRun('interrompida internamente', { origin: internalReason });
        }
      } else {
        const message = String(error && error.message || 'Falha na rotina ISS Corretora');
        item.textContent = message;
        item.style.color = '#a12622';
        setDebugStatus('ERRO: ' + message);
        diagnosticLogger.log('ERROR', 'Falha na rotina ISS Corretora.', {
          message,
          stack: error && error.stack ? String(error.stack).slice(0, 4000) : ''
        });
        await diagnosticLogger.stopRun('erro', { message });
        window.setTimeout(() => {
          item.textContent = original;
          item.style.color = '#1a1a1a';
          item.disabled = false;
          item.style.cursor = 'pointer';
          item.style.background = 'transparent';
        }, 4500);
      }
    } finally {
      runningController = null;
      runningAbortOrigin = 'none';
      setCancelEnabled(false);
      if (!keepDebugOpenForRecorder) hideDebugPanel();
    }
  }

  menuRecorderButton = document.createElement('button');
  menuRecorderButton.type = 'button';
  menuRecorderButton.setAttribute('data-recorder-action', 'general-recorder');
  menuRecorderButton.textContent = '● Gravador Geral';
  menuRecorderButton.title = 'Grava um fluxo manual do Protheus para ajudar a criar automações futuras.';
  menuRecorderButton.classList.add('pos-ui-routine');
  Object.assign(menuRecorderButton.style, {
    display: 'block', width: '100%', padding: '10px 11px', marginBottom: '5px', border: '1px solid #c7dce8',
    borderRadius: '7px', background: '#f3f9fc', color: '#00659a', textAlign: 'left',
    fontFamily: 'Arial, sans-serif', fontSize: '13px', fontWeight: '700', cursor: 'pointer'
  });
  menuRecorderButton.addEventListener('click', (event) => {
    event.stopPropagation();
    showDebugPanel();
    if (!generalRecorderActive) debugRecorderButton.click();
    else setDebugStatus('GRAVAÇÃO ATIVA — use “Parar e baixar” no painel Debug quando terminar.');
  });
  list.appendChild(menuRecorderButton);

  for (const routine of routines) {
    const item = document.createElement('button');
    item.type = 'button';
    item.dataset.routineId = routine.id;
    item.textContent = routine.label;
    item.classList.add('pos-ui-routine');

    Object.assign(item.style, {
      display: 'block',
      width: '100%',
      padding: '10px 11px',
      border: '0',
      borderRadius: '7px',
      background: 'transparent',
      color: '#1a1a1a',
      textAlign: 'left',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      cursor: 'pointer'
    });

    item.addEventListener('click', async () => {
      if (item.disabled) return;
      if (routine.id === 'soomar-despesas') {
        const runOptions = await showSoomarRunOptions('Soomar – Despesas');
        if (!runOptions) return;
        await runSoomarRoutine(item, routine, runOptions);
        return;
      }
      if (routine.id === 'reembolso-plano-jorge') {
        const runOptions = await showSoomarRunOptions('Reembolso Plano Jorge');
        if (!runOptions) return;
        await runJorgeReimbursementRoutine(item, routine, runOptions);
        return;
      }
      if (routine.id === 'iss-corretora') {
        const runOptions = await showIssCorretoraRunOptions();
        if (!runOptions) return;
        await runIssCorretoraRoutine(item, routine, runOptions);
        return;
      }
      if (routine.id !== 'emissao-comissoes') return;

      const runOptions = await showCommissionRunOptions();
      if (!runOptions) return;
      const skipLotGeneration = runOptions.skipLotGeneration === true;
      const skipLotApproval = runOptions.skipLotApproval === true;
      const skipPayments = runOptions.skipPayments === true;

      await diagnosticLogger.startRun({
        version: EXTENSION_VERSION,
        visibility: document.visibilityState,
        focus: (() => { try { return document.hasFocus(); } catch (_) { return false; } })(),
        userAgent: String((window.navigator && window.navigator.userAgent) || (typeof navigator !== 'undefined' && navigator.userAgent) || ''),
        extra: { href: String((window.location && window.location.href) || (typeof location !== 'undefined' && location.href) || ''), trigger: 'menu', skipLotGeneration, skipLotApproval, skipPayments }
      });
      diagnosticLogger.log('STATE', 'Estado inicial da página.', runtimeState());

      runningAbortOrigin = 'none';
      runningController = new AbortController();
      showDebugPanel();
      setCancelEnabled(true);
      item.disabled = true;
      item.style.cursor = 'default';
      item.style.background = '#eef6fb';
      const original = routine.label;

      try {
        const ensureBackgroundProtection = async () => {
          if (backgroundProtectionActive) {
            const current = await sendBackgroundProtection('refresh');
            renderBackgroundProtection(current);
            return current;
          }

          const protection = await startBackgroundProtection();
          diagnosticLogger.log('BACKGROUND', 'Proteção Edge/CDP confirmada após abertura inicial do Painel.', {
            rendererState: protection.rendererState || null,
            lifecycleState: protection.lifecycleState || '',
            focusEmulation: protection.focusEmulation === true
          });
          return protection;
        };

        const result = await api.runEmissaoComissoes(document, {
          signal: runningController.signal,
          skipLotGeneration,
          skipLotApproval,
          skipPayments,
          onExcelSync: sendExcelSync,
          onTrustedClick: sendTrustedClick,
          onTrustedKey: sendTrustedKey,
          ensureBackgroundProtection,
          onStatus: (message) => {
            item.textContent = message;
            setDebugStatus(message);
            diagnosticLogger.log('STATUS', String(message || ''), runtimeState());
          },
          onLog: (category, message, data) => {
            diagnosticLogger.log(category, message, data);
          },
          onContinuePoint: (message) => {
            setDebugStatus('Rotina pronta para continuar.');
            diagnosticLogger.log('CONTINUE', 'Ponto de continuação alcançado.', { message: String(message || '') });
            showContinuationToast(message);
          }
        });

        await stopBackgroundProtection();
        await diagnosticLogger.stopRun('concluída', { detail: String(result && result.detail || '') });
        item.textContent = result.detail;
        setDebugStatus(result.detail || 'Rotina concluída.');
        window.setTimeout(() => {
          item.textContent = original;
          item.disabled = false;
          item.style.cursor = 'pointer';
          item.style.background = 'transparent';
          closeMenu();
        }, 1800);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          item.textContent = original;
          item.style.color = '#1a1a1a';
          item.disabled = false;
          item.style.cursor = 'pointer';
          item.style.background = 'transparent';
          const userCancelled = runningAbortOrigin === 'user-debug-x' || runningAbortOrigin === 'user-f11';
          if (userCancelled) {
            setDebugStatus('Rotina cancelada pelo usuário.');
            await stopBackgroundProtection();
            await diagnosticLogger.stopRun('cancelada pelo usuário', { origin: runningAbortOrigin });
          } else {
            const internalReason = runningAbortOrigin === 'none' ? 'origem desconhecida' : runningAbortOrigin;
            setDebugStatus('Rotina interrompida internamente: ' + internalReason + '.');
            diagnosticLogger.log('RUN_ABORT', 'Rotina interrompida internamente.', { origin: internalReason });
            await stopBackgroundProtection();
            await diagnosticLogger.stopRun('interrompida internamente', { origin: internalReason });
          }
        } else {
          item.textContent = error && error.message ? error.message : 'Falha na rotina';
          setDebugStatus('ERRO: ' + item.textContent);
          diagnosticLogger.log('ERROR', 'Falha na rotina.', {
            message: String(error && error.message || 'Falha na rotina'),
            stack: error && error.stack ? String(error.stack).slice(0, 4000) : ''
          });
          await stopBackgroundProtection();
          await diagnosticLogger.stopRun('erro', { message: String(error && error.message || 'Falha na rotina') });
          item.style.color = '#a12622';
          window.setTimeout(() => {
            item.textContent = original;
            item.style.color = '#1a1a1a';
            item.disabled = false;
            item.style.cursor = 'pointer';
            item.style.background = 'transparent';
          }, 3000);
        }
      } finally {
        if (backgroundProtectionActive) {
          try { await stopBackgroundProtection(); } catch (_) {}
        }
        runningController = null;
        runningAbortOrigin = 'none';
        setCancelEnabled(false);
        hideDebugPanel();
      }
    });

    list.appendChild(item);
  }

  panel.appendChild(list);

  const launcher = document.createElement('button');
  launcher.id = menu.launcherId;
  launcher.type = 'button';
  launcher.title = 'Rotinas automatizadas';
  launcher.setAttribute('aria-label', 'Abrir menu de rotinas');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.classList.add('pos-ui-launcher');

  Object.assign(launcher.style, {
    position: menu.position,
    left: '0',
    bottom: LAUNCHER_BOTTOM_PX + 'px',
    zIndex: '2147483647',
    width: LAUNCHER_SIZE_PX + 'px',
    height: LAUNCHER_SIZE_PX + 'px',
    padding: '9px',
    border: '1px solid #b9c3ca',
    borderRadius: '7px',
    background: '#ffffff',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(0,0,0,.20)'
  });

  for (let i = 0; i < 3; i++) {
    const line = document.createElement('span');
    Object.assign(line.style, {
      display: 'block',
      width: '100%',
      height: '4px',
      margin: i === 1 ? '5px 0' : '0',
      borderRadius: '2px',
      background: '#263238',
      pointerEvents: 'none'
    });
    launcher.appendChild(line);
  }

  const isMenuOpen = () => panel.classList.contains('pos-ui-panel-open');
  let launcherPointerNearby = false;

  function syncLauncherExpandedState() {
    launcher.classList.toggle('pos-ui-launcher-expanded', isMenuOpen() || launcherPointerNearby);
  }

  function onLauncherPointerMove(event) {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const nextNearby = isPointerWithinLauncherRange(event.clientX, event.clientY, viewportHeight);
    if (nextNearby === launcherPointerNearby) return;
    launcherPointerNearby = nextNearby;
    syncLauncherExpandedState();
  }

  function onLauncherPointerLeaveViewport() {
    if (!launcherPointerNearby) return;
    launcherPointerNearby = false;
    syncLauncherExpandedState();
  }

  function openMenu() {
    panel.classList.add('pos-ui-panel-open');
    launcher.setAttribute('aria-expanded', 'true');
    syncLauncherExpandedState();
  }

  function closeMenu() {
    panel.classList.remove('pos-ui-panel-open');
    launcher.setAttribute('aria-expanded', 'false');
    syncLauncherExpandedState();
  }

  const onLauncherClick = (event) => {
    event.stopPropagation();
    if (isMenuOpen()) closeMenu();
    else openMenu();
  };
  const onPanelClick = (event) => event.stopPropagation();
  const onDocumentClick = () => closeMenu();

  launcher.addEventListener('click', onLauncherClick);
  panel.addEventListener('click', onPanelClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('pointermove', onLauncherPointerMove, { passive: true });
  document.documentElement.addEventListener('mouseleave', onLauncherPointerLeaveViewport);

  document.body.appendChild(panel);
  document.body.appendChild(launcher);

  window.__PosProtheusUiCleanup = (origin) => {
    try { if (generalRecorderActive) chrome.runtime.sendMessage({ type: 'pos-protheus-recorder-stop', keepProtection: backgroundProtectionActive === true }); } catch (_) {}
    generalRecorderActive = false;
    try { stopGeneralRecorderObservers(); } catch (_) {}
    try { if (recorderScreenshotTimer) window.clearTimeout(recorderScreenshotTimer); } catch (_) {}
    recorderScreenshotTimer = null;
    recorderPendingScreenshot = null;
    try { if (backgroundProtectionActive) sendBackgroundProtection('stop'); } catch (_) {}
    backgroundProtectionActive = false;
    try {
      if (runningController && !runningController.signal.aborted) {
        runningAbortOrigin = origin === 'user-debug-x' ? 'user-debug-x' : 'runtime-replaced';
        diagnosticLogger.log('RUN_ABORT', 'Abort solicitado pelo cleanup da extensão.', { origin: runningAbortOrigin });
        runningController.abort();
      }
    } catch (_) {}
    try { if (debugTimer) window.clearInterval(debugTimer); } catch (_) {}
    try { if (driftTimer) window.clearInterval(driftTimer); } catch (_) {}
    try { diagnosticLogger.flush(); } catch (_) {}
    try { document.removeEventListener('click', onDocumentClick); } catch (_) {}
    try { document.removeEventListener('pointermove', onLauncherPointerMove); } catch (_) {}
    try { document.documentElement.removeEventListener('mouseleave', onLauncherPointerLeaveViewport); } catch (_) {}
    try { document.removeEventListener('click', onUserClickDiagnostic, true); } catch (_) {}
    try { document.removeEventListener('click', onRecorderClick, true); } catch (_) {}
    try { document.removeEventListener('dblclick', onRecorderDoubleClick, true); } catch (_) {}
    try { document.removeEventListener('input', onRecorderInput, true); } catch (_) {}
    try { document.removeEventListener('change', onRecorderChange, true); } catch (_) {}
    try { document.removeEventListener('focusin', onRecorderFocusIn, true); } catch (_) {}
    try { document.removeEventListener('focusout', onRecorderFocusOut, true); } catch (_) {}
    try { document.removeEventListener('keydown', onRecorderKeyDown, true); } catch (_) {}
    try { document.removeEventListener('keyup', onRecorderKeyUp, true); } catch (_) {}
    try { window.removeEventListener('keydown', onEmergencyF11, true); } catch (_) {}
    try { document.removeEventListener('keydown', onEmergencyF11, true); } catch (_) {}
    try { document.removeEventListener('keydown', onUserKeyDiagnostic, true); } catch (_) {}
    try { document.removeEventListener('visibilitychange', onVisibilityDiagnostic); } catch (_) {}
    try { if (typeof window.removeEventListener === 'function') window.removeEventListener('focus', onWindowFocusDiagnostic); } catch (_) {}
    try { if (typeof window.removeEventListener === 'function') window.removeEventListener('blur', onWindowBlurDiagnostic); } catch (_) {}
    try { if (typeof window.removeEventListener === 'function') window.removeEventListener('error', onWindowErrorDiagnostic); } catch (_) {}
    try { if (typeof window.removeEventListener === 'function') window.removeEventListener('unhandledrejection', onUnhandledRejectionDiagnostic); } catch (_) {}
    try { launcher.removeEventListener('click', onLauncherClick); } catch (_) {}
    try { panel.removeEventListener('click', onPanelClick); } catch (_) {}
    try { debugCancel.removeEventListener('click', onDebugCancel); } catch (_) {}
    try { debugLogAuthorize.removeEventListener('click', onAuthorizeLogs); } catch (_) {}
    try { debugRecorderButton.removeEventListener('click', onGeneralRecorderButton); } catch (_) {}
    try { stopGeneralRecorderObservers(); } catch (_) {}
    try { document.getElementById(RUN_OPTIONS_ID)?.remove(); } catch (_) {}
    try { panel.remove(); } catch (_) {}
    try { launcher.remove(); } catch (_) {}
    try { debugPanel.remove(); } catch (_) {}
    try { motionStyle.remove(); } catch (_) {}
    runtimeHandle.initialized = false;
    if (window.__PosProtheusContentRuntime === runtimeHandle) window.__PosProtheusContentRuntime = null;
  };
  runtimeHandle.cleanup = window.__PosProtheusUiCleanup;
})();
