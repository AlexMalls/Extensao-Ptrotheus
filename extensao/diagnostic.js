(function (rootFactory) {
  const api = rootFactory();
  if (typeof window !== 'undefined') window.PosProtheusDiagnostic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(function () {
  const DB_NAME = 'positiva-protheus-diagnostic';
  const DB_VERSION = 1;
  const STORE_NAME = 'handles';
  const HANDLE_KEY = 'logs-directory';
  const SENTINEL_FILE = '.positiva-protheus-logs';
  const EXPECTED_DIRECTORY = 'C:\\Users\\Alexandre Mallorca\\Documents\\Projetos TI\\ProtheusAutomations\\Logs';
  const FLUSH_DELAY_MS = 1000;
  const FLUSH_LINE_THRESHOLD = 40;
  const MAX_PENDING_LINES = 20000;

  function pad(value, size) {
    return String(value).padStart(size || 2, '0');
  }

  function createRunId() {
    try {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const bytes = new Uint8Array(2);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      }
    } catch (_) {}
    return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0').toUpperCase();
  }

  function createLogFileName(date, runId) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return 'Protheus_' +
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' +
      pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds()) + '_' +
      String(runId || '----').replace(/[^a-z0-9_-]/gi, '').toUpperCase() + '.log';
  }

  function formatTimestamp(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
  }

  function safeJson(value) {
    if (value == null) return '';
    try {
      const text = JSON.stringify(value, function (_key, item) {
        if (typeof item === 'string' && item.length > 500) return item.slice(0, 500) + '…';
        return item;
      });
      return text && text !== '{}' ? text : '';
    } catch (_) {
      return '{"serialization":"failed"}';
    }
  }

  function formatLogLine(date, runId, category, message, data) {
    const suffix = safeJson(data);
    return formatTimestamp(date) + ' [RUN ' + String(runId || '----') + '] [' + String(category || 'INFO') + '] ' +
      String(message || '') + (suffix ? ' | ' + suffix : '');
  }

  function attr(el, name) {
    try { return el && el.getAttribute ? String(el.getAttribute(name) || '') : ''; } catch (_) { return ''; }
  }

  function describeElement(el) {
    if (!el) return { tag: 'unknown' };
    let tag = '';
    try { tag = String(el.tagName || el.nodeName || 'unknown').toLowerCase(); } catch (_) { tag = 'unknown'; }
    const result = { tag: tag || 'unknown' };
    try { if (el.id) result.id = String(el.id); } catch (_) {}
    const advpl = attr(el, 'data-advpl');
    const caption = attr(el, 'caption');
    const title = attr(el, 'title');
    const name = attr(el, 'name');
    const type = attr(el, 'type');
    if (advpl) result.advpl = advpl;
    if (caption) result.caption = caption.trim();
    if (title) result.title = title.trim();
    if (name) result.name = name;
    if (type && type.toLowerCase() !== 'password') result.type = type;
    return result;
  }

  function isEditableNode(node) {
    if (!node) return false;
    let tag = '';
    let type = '';
    try { tag = String(node.tagName || '').toLowerCase(); } catch (_) {}
    try { type = String(node.type || attr(node, 'type') || '').toLowerCase(); } catch (_) {}
    try { if (node.isContentEditable) return true; } catch (_) {}
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') return type !== 'button' && type !== 'submit' && type !== 'reset' && type !== 'checkbox' && type !== 'radio';
    return false;
  }

  function eventPath(event) {
    try {
      if (event && typeof event.composedPath === 'function') return event.composedPath();
    } catch (_) {}
    return event && event.target ? [event.target] : [];
  }

  function sanitizeKeyboardEvent(event) {
    const path = eventPath(event);
    const editable = path.some(isEditableNode) || isEditableNode(event && event.target);
    const rawKey = String(event && event.key || '');
    const printable = rawKey.length === 1;
    return {
      key: printable ? '[printable]' : (rawKey || '[unknown]'),
      editable,
      ctrl: !!(event && event.ctrlKey),
      alt: !!(event && event.altKey),
      shift: !!(event && event.shiftKey),
      meta: !!(event && event.metaKey)
    };
  }

  function describeEventTarget(event) {
    const path = eventPath(event);
    for (const node of path) {
      if (!node || !node.tagName) continue;
      const desc = describeElement(node);
      if (desc.advpl || desc.caption || desc.name || desc.title) return desc;
    }
    return describeElement((event && event.target) || null);
  }

  function openDatabase(indexedDBRef) {
    return new Promise((resolve, reject) => {
      if (!indexedDBRef) return reject(new Error('IndexedDB indisponível'));
      const request = indexedDBRef.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Falha ao abrir IndexedDB'));
    });
  }

  async function idbGet(indexedDBRef, key) {
    const db = await openDatabase(indexedDBRef);
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Falha ao ler IndexedDB'));
      });
    } finally {
      try { db.close(); } catch (_) {}
    }
  }

  async function idbPut(indexedDBRef, key, value) {
    const db = await openDatabase(indexedDBRef);
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Falha ao gravar IndexedDB'));
        tx.onabort = () => reject(tx.error || new Error('Gravação IndexedDB cancelada'));
      });
    } finally {
      try { db.close(); } catch (_) {}
    }
  }

  async function queryWritePermission(handle) {
    if (!handle) return 'denied';
    try {
      if (typeof handle.queryPermission === 'function') return await handle.queryPermission({ mode: 'readwrite' });
    } catch (_) {}
    return 'prompt';
  }

  async function verifyLogsDirectory(handle) {
    if (!handle || typeof handle.getFileHandle !== 'function') return false;
    try {
      await handle.getFileHandle(SENTINEL_FILE, { create: false });
      return true;
    } catch (_) {
      return false;
    }
  }

  function createDiagnosticLogger(options) {
    const opts = options || {};
    const win = opts.window || (typeof window !== 'undefined' ? window : null);
    const indexedDBRef = opts.indexedDB || (win && win.indexedDB) || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    const onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : function () {};

    let directoryHandle = null;
    let permission = 'unknown';
    let directoryVerified = false;
    let runId = null;
    let fileName = null;
    let active = false;
    let pendingLines = [];
    let deferredFiles = [];
    let flushTimer = null;
    let flushChain = Promise.resolve();
    let lastError = '';

    function emitState() {
      try { onStateChange(getState()); } catch (_) {}
    }

    function getState() {
      return {
        active,
        runId,
        fileName,
        permission,
        directoryVerified,
        directoryName: directoryHandle && directoryHandle.name ? directoryHandle.name : '',
        expectedDirectory: EXPECTED_DIRECTORY,
        pendingLines: pendingLines.length + deferredFiles.reduce((sum, item) => sum + item.lines.length, 0),
        deferredFiles: deferredFiles.length,
        lastError,
        supported: !!(win && typeof win.showDirectoryPicker === 'function')
      };
    }

    function clearFlushTimer() {
      if (flushTimer && win && typeof win.clearTimeout === 'function') {
        try { win.clearTimeout(flushTimer); } catch (_) {}
      }
      flushTimer = null;
    }

    function scheduleFlush() {
      if (permission !== 'granted' || !directoryVerified || !fileName || !pendingLines.length) return;
      if (pendingLines.length >= FLUSH_LINE_THRESHOLD) {
        clearFlushTimer();
        flush();
        return;
      }
      if (!flushTimer && win && typeof win.setTimeout === 'function') {
        flushTimer = win.setTimeout(() => {
          flushTimer = null;
          flush();
        }, FLUSH_DELAY_MS);
      }
    }

    function log(category, message, data) {
      if (!runId) return;
      pendingLines.push(formatLogLine(new Date(), runId, category, message, data));
      if (pendingLines.length > MAX_PENDING_LINES) {
        const excess = pendingLines.length - MAX_PENDING_LINES;
        pendingLines.splice(0, excess);
        pendingLines.unshift(formatLogLine(new Date(), runId, 'WARN', 'Buffer de log atingiu o limite; linhas antigas foram descartadas.', { discarded: excess }));
      }
      scheduleFlush();
      emitState();
    }

    async function writeLinesToFile(targetFileName, lines) {
      if (!targetFileName || !lines || !lines.length) return true;
      const handle = await directoryHandle.getFileHandle(targetFileName, { create: true });
      const current = await handle.getFile();
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.seek(current.size);
      await writable.write(lines.join('\r\n') + '\r\n');
      await writable.close();
      return true;
    }

    async function flushNow() {
      clearFlushTimer();
      if (permission !== 'granted' || !directoryVerified || !directoryHandle) return false;
      try {
        while (deferredFiles.length) {
          const deferred = deferredFiles[0];
          await writeLinesToFile(deferred.fileName, deferred.lines);
          deferredFiles.shift();
        }

        if (fileName && pendingLines.length) {
          const lines = pendingLines.slice();
          await writeLinesToFile(fileName, lines);
          pendingLines.splice(0, lines.length);
        }

        lastError = '';
        emitState();
        return true;
      } catch (error) {
        lastError = error && error.message ? String(error.message) : 'Falha ao gravar o arquivo de log.';
        emitState();
        return false;
      }
    }

    function flush() {
      flushChain = flushChain.then(flushNow, flushNow);
      return flushChain;
    }

    async function init() {
      try {
        directoryHandle = await idbGet(indexedDBRef, HANDLE_KEY);
        if (directoryHandle) {
          permission = await queryWritePermission(directoryHandle);
          directoryVerified = permission === 'granted' ? await verifyLogsDirectory(directoryHandle) : false;
          if (permission === 'granted' && !directoryVerified) lastError = 'A pasta autorizada não é a pasta de Logs esperada.';
        } else {
          permission = 'prompt';
        }
      } catch (error) {
        permission = 'prompt';
        lastError = error && error.message ? String(error.message) : 'Não foi possível restaurar a autorização da pasta.';
      }
      emitState();
      return getState();
    }

    async function authorizeDirectory() {
      if (!win || typeof win.showDirectoryPicker !== 'function') {
        lastError = 'O navegador não disponibilizou o seletor de pasta para esta página.';
        emitState();
        throw new Error(lastError);
      }
      const handle = await win.showDirectoryPicker({ id: 'positiva-protheus-logs', mode: 'readwrite', startIn: 'documents' });
      let granted = 'granted';
      try {
        if (typeof handle.requestPermission === 'function') granted = await handle.requestPermission({ mode: 'readwrite' });
      } catch (_) {}
      if (granted !== 'granted') throw new Error('Permissão de gravação não concedida.');
      if (!await verifyLogsDirectory(handle)) {
        throw new Error('Selecione exatamente a pasta: ' + EXPECTED_DIRECTORY);
      }
      directoryHandle = handle;
      permission = 'granted';
      directoryVerified = true;
      lastError = '';
      await idbPut(indexedDBRef, HANDLE_KEY, handle);
      emitState();
      await flush();
      return getState();
    }

    async function startRun(meta) {
      if (active && runId) await stopRun('reiniciado');
      if (!active && runId && pendingLines.length) {
        await flush();
        if (pendingLines.length) {
          deferredFiles.push({ fileName, lines: pendingLines.slice() });
          pendingLines = [];
          if (deferredFiles.length > 10) deferredFiles.shift();
        }
      }
      runId = createRunId();
      fileName = createLogFileName(new Date(), runId);
      active = true;
      pendingLines = [];
      lastError = '';
      const state = getState();
      log('RUN', 'Rotina iniciada.', Object.assign({
        version: String(meta && meta.version || ''),
        visibility: meta && meta.visibility,
        focus: meta && meta.focus,
        userAgent: meta && meta.userAgent
      }, meta && meta.extra || {}));
      if (state.permission !== 'granted' || !state.directoryVerified) {
        log('LOG', 'Pasta de logs ainda não autorizada; mantendo registros em memória.', { expectedDirectory: EXPECTED_DIRECTORY });
      }
      return { runId, fileName };
    }

    async function stopRun(outcome, data) {
      if (!runId) return;
      log('RUN', 'Rotina finalizada.', Object.assign({ outcome: String(outcome || 'concluída') }, data || {}));
      await flush();
      active = false;
      emitState();
    }

    function isActive() { return active && !!runId; }

    return {
      init,
      authorizeDirectory,
      startRun,
      stopRun,
      log,
      flush,
      getState,
      isActive
    };
  }

  return {
    EXPECTED_DIRECTORY,
    SENTINEL_FILE,
    FLUSH_DELAY_MS,
    FLUSH_LINE_THRESHOLD,
    createRunId,
    createLogFileName,
    formatTimestamp,
    formatLogLine,
    describeElement,
    describeEventTarget,
    sanitizeKeyboardEvent,
    createDiagnosticLogger
  };
});
