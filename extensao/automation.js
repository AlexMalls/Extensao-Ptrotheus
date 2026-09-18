(function (rootFactory) {
  const api = rootFactory();
  if (typeof window !== 'undefined') {
    window.PosProtheusAutomation = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {
  const POLL_INTERVAL_MS = 1000;
  const TARGET_PANEL = 'Painel Comissões a Pagar';
  const TARGET_LOTE_MANUAL = 'Lote Manual';
  const TARGET_AVANCAR = 'Avançar';
  const TARGET_GRP_COMISSAO = 'Grp Comissao';
  const TARGET_FINALIZAR = 'Finalizar';
  const TARGET_CALCULAR_AGORA = 'Calcular as comissões a pagar agora';
  const PROCESSING_WINDOW_TEXT = 'Gerando composição de comissão';
  const LOG_WINDOW_TEXT = 'Log Calculo Comissões a Pagar';
  const UPDATING_WINDOW_TEXT = 'Atualizando Listagem';
  const INTENSIVE_POLL_INTERVAL_MS = 250;
  const STATE_WATCH_FALLBACK_MS = 500;
  const MARKER_MISSING_RESCAN_MS = 1000;
  const MARKER_INACTIVE_RESCAN_MS = 5000;
  const POST_UPDATE_DELAY_MS = 1000;
  const POST_PROCESSING_SAFETY_TIMEOUT_MS = 10000;
  const ACTION_EFFECT_TIMEOUT_MS = 5000;
  const ACTION_EFFECT_POLL_MS = 250;
  const ACTION_RETRY_DELAY_MS = 700;
  const ACTION_MAX_ATTEMPTS = 4;
  const VERIFIED_ACTION_RETRY_POLICIES = Object.freeze({
    SAFE: 'safe',
    VERIFY_BEFORE_RETRY: 'verify-before-retry',
    NEVER_BLIND_RETRY: 'never-blind-retry'
  });
  const POST_GENERATION_VERIFY_TIMEOUT_MS = 10000;
  const APPROVAL_UPDATE_TIMEOUT_MS = 30000;
  const VENDOR_PAYMENT_UPDATE_TIMEOUT_MS = 90000;
  const PAYMENT_EMAIL_SEND_TIMEOUT_MS = 120000;
  const PAYMENT_EMAIL_UPDATE_TIMEOUT_MS = 60000;
  const PAYMENT_EMAIL_POST_REFRESH_DELAY_MS = 1000;
  const STATE_WATCHDOG_STALL_MS = 2000;
  const STATE_WATCHDOG_RECHECK_MS = 1000;
  const STATE_WATCHDOG_MAX_RECOVERIES = 1;
  const ACTION_SUCCESS_STABILITY_MS = 180;
  const SOOMAR_STEP_DELAY_DEFAULT_MS = 200;
  const SOOMAR_STEP_DELAY_MIN_MS = 100;
  const SOOMAR_STEP_DELAY_MAX_MS = 1000;
  const TARGET_VENDOR_PAYMENT_GROUPS = Object.freeze([
    'COMISSAO (EXTERNOS) - ADMINISTRADORA',
    'AGENCIADOR - ADMINISTRADORA',
    'ENTIDADE DE CLASSE - ADMINISTRADORA',
    'COMISSAO (SUBPLATAFORMA) - ADMINISTRADORA',
    'GERENTE - ADMINISTRADORA'
  ]);
  const TARGET_EXTERNAL_VENDOR_COMMISSION = TARGET_VENDOR_PAYMENT_GROUPS[0];
  const INTERNAL_COMMISSION_EXPORT_GROUPS = Object.freeze({
    primary: Object.freeze(['COMISSAO (INTERNOS) - ADMINISTRADORA']),
    sdr: Object.freeze(['SDR - ADMINISTRADORA']),
    additional: Object.freeze(['CONSULTOR - CORRETORA', 'CONSULTOR - ADMINISTRADORA', 'INDICADOR - CORRETORA']),
    additional2: Object.freeze(['SUPERVISOR - ADMINISTRADORA'])
  });
  const INTERNAL_COMMISSION_EXCEL_REPLICATIONS = Object.freeze([
    Object.freeze({
      sourceName: 'ROBERTO MIGUEL SANCHES PEREIRA',
      targetName: 'TIAGO CARNEIRO DE CARVALHO',
      field: 'additional2Cents'
    })
  ]);
  const SOOMAR_EXPENSE_TYPE_MAP = Object.freeze([
    Object.freeze({ history: 'ALUGUEL MENSAL DO MES CORRENTE (RENEGOCIADO COM DESCONTO)', typeCode: '014', description: 'ALUGUEL DE VEICULO' }),
    Object.freeze({ history: 'CONDOMINIO E COTA DE IPTU', typeCode: '031', description: 'FA - CONDOMINIO' }),
    Object.freeze({ history: 'EMISSAO CONCESSIONARIA LIGHT', typeCode: '039', description: 'FA - DIVERSOS' }),
    Object.freeze({ history: 'INTERNET (PRINCIPAL - RDIO E REDUNDANCIA - FIBRA)', typeCode: '032', description: 'INTERNET' }),
    Object.freeze({ history: 'SUPORTE VENDA INTERNA E EQUIPAMENTOS', typeCode: '039', description: 'FA - DIVERSOS' }),
    Object.freeze({ history: 'USO DOS RECURSOS DEDICADOS', typeCode: '039', description: 'FA - DIVERSOS' })
  ]);
  const CONTINUATION_MESSAGE = 'Lotes, aprovações, pagamentos, Excel e envio dos extratos por e-mail concluídos.';
  const COMMISSION_GROUP_VALUES = Object.freeze(['02', '03', '06', '07', '10', '11', '14', '01', '15', '50', '52', '55', '56', '57']);
  const GRP_COMISSAO_NAME = 'M->PKA_GRPCMS';
  const GRP_COMISSAO_TITLE = 'Grupo de Comissao';
  const GRP_COMISSAO_MAXLENGTH = '2';
  const COMMISSION_DATE_FIELDS = Object.freeze({
    baixaDe: 'M->PKA_DTBXIN',
    baixaAte: 'M->PKA_DTBXFI',
    dataPagto: 'M->PKA_VENPAG'
  });
  const FORBIDDEN_DATE_FIELDS = Object.freeze([
    'M->PKA_DATINI',
    'M->PKA_DATFIM'
  ]);

  function emitDiagnostic(onLog, category, message, data) {
    if (typeof onLog !== 'function') return;
    try { onLog(category, message, data || null); } catch (_) {}
  }

  function describeActionTarget(el) {
    if (!el) return null;
    const data = {};
    try { data.tag = String(el.tagName || '').toLowerCase(); } catch (_) {}
    try { if (el.id) data.id = String(el.id); } catch (_) {}
    try { if (el.getAttribute) {
      const advpl = el.getAttribute('data-advpl');
      const caption = el.getAttribute('caption');
      const title = el.getAttribute('title');
      const name = el.getAttribute('name');
      if (advpl) data.advpl = String(advpl);
      if (caption) data.caption = String(caption).trim();
      if (title) data.title = String(title).trim();
      if (name) data.name = String(name);
    } } catch (_) {}
    const native = getNativeActionTarget(el);
    if (native && native !== el) {
      try { data.nativeTag = String(native.tagName || '').toLowerCase(); } catch (_) {}
    }
    return data;
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeSoomarStepDelayMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return SOOMAR_STEP_DELAY_DEFAULT_MS;
    return Math.min(SOOMAR_STEP_DELAY_MAX_MS, Math.max(SOOMAR_STEP_DELAY_MIN_MS, Math.round(numeric)));
  }

  async function applySoomarStepDelay(value, signal) {
    const delayMs = normalizeSoomarStepDelayMs(value);
    await abortableSleep(delayMs, signal);
    return delayMs;
  }

  function matchesAnyText(attrs, needles) {
    const haystacks = [
      attrs && attrs.title,
      attrs && attrs.caption,
      attrs && attrs.text,
      attrs && attrs.value,
      attrs && attrs.ariaLabel
    ].map(normalizeText).filter(Boolean);

    return (needles || []).some((needle) => {
      const wanted = normalizeText(needle);
      return wanted && haystacks.some((haystack) => haystack.includes(wanted));
    });
  }

  function getMenuDefinition() {
    return {
      launcherId: 'positiva-protheus-menu-launcher',
      panelId: 'positiva-protheus-menu-panel',
      position: 'fixed',
      corner: 'bottom-left'
    };
  }

  function resolveProtheusEnvironment(hostname, visibleText) {
    const host = String(hostname == null ? '' : hostname).trim().toLowerCase();
    let hostEnvironment = 'unknown';
    if (host === 'erp.positiva.com.br') hostEnvironment = 'administradora';
    if (host === 'erp-corretora.positiva.com.br') hostEnvironment = 'corretora';
    if (hostEnvironment === 'unknown') return 'unknown';

    const pageText = normalizeText(visibleText).replace(/\s*\/\s*/g, ' / ');
    const saysAdministradora = pageText.includes('positiva / administradora');
    const saysCorretora = pageText.includes('positiva / corretora');

    if (saysAdministradora && saysCorretora) return 'unknown';
    if (saysAdministradora && hostEnvironment !== 'administradora') return 'unknown';
    if (saysCorretora && hostEnvironment !== 'corretora') return 'unknown';
    return hostEnvironment;
  }

  function getRoutineDefinitions(environment) {
    const all = [
      { id: 'emissao-comissoes', label: 'Emissão de comissões', environment: 'administradora' },
      { id: 'soomar-despesas', label: 'Soomar – Despesas', environment: 'corretora' },
      { id: 'reembolso-plano-jorge', label: 'Reembolso Plano Jorge', environment: 'corretora' },
      { id: 'iss-corretora', label: 'ISS Corretora', environment: 'corretora' }
    ];
    if (environment == null || environment === '') return all;
    return all.filter((routine) => routine.environment === environment);
  }

  function normalizeSoomarHistory(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function getSoomarPeriodInfo(date) {
    const source = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = source.getFullYear();
    const month = source.getMonth() + 1;
    const mm = String(month).padStart(2, '0');
    return {
      year,
      month,
      period: String(year) + mm,
      dateText: '01/' + mm + '/' + String(year),
      receiptNumber: String(year) + mm + '01'
    };
  }

  function decodeJorgePdfBase64(base64) {
    const text = String(base64 || '').replace(/\s+/g, '');
    if (!text) throw new Error('Reembolso Plano Jorge: PDF vazio ou inválido.');
    if (typeof atob === 'function') return atob(text);
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'base64').toString('latin1');
    throw new Error('Reembolso Plano Jorge: ambiente sem suporte para decodificar o PDF.');
  }

  function getJorgePdfObject(pdfText, objectNumber) {
    const pattern = new RegExp('(?:^|[\\r\\n])' + String(objectNumber) + '\\s+0\\s+obj\\b([\\s\\S]*?)endobj');
    const match = pattern.exec(pdfText);
    return match ? match[1] : '';
  }

  function getJorgePdfStream(objectText) {
    const match = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(String(objectText || ''));
    return match ? match[1] : '';
  }

  function decodeJorgePdfUnicodeHex(hex) {
    const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
    if (!clean || clean.length % 4 !== 0) return '';
    let output = '';
    for (let index = 0; index < clean.length; index += 4) {
      output += String.fromCharCode(parseInt(clean.slice(index, index + 4), 16));
    }
    return output;
  }

  function parseJorgePdfCMap(cmapText) {
    const mapping = new Map();
    const regex = /<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,})>/g;
    let match;
    while ((match = regex.exec(String(cmapText || '')))) {
      mapping.set(match[1].toLowerCase(), decodeJorgePdfUnicodeHex(match[2]));
    }
    return mapping;
  }

  function decodeJorgePdfTextHex(hex, mapping) {
    const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
    if (!clean || clean.length % 4 !== 0) return '';
    let output = '';
    for (let index = 0; index < clean.length; index += 4) {
      const code = clean.slice(index, index + 4).toLowerCase();
      output += mapping && mapping.has(code) ? mapping.get(code) : '';
    }
    return output;
  }

  function extractJorgePdfText(base64) {
    const pdfText = decodeJorgePdfBase64(base64);
    const fontObjectRefs = {};
    const fontRefRegex = /\/(F\d+)\s+(\d+)\s+0\s+R/g;
    let match;
    while ((match = fontRefRegex.exec(pdfText))) {
      if (!fontObjectRefs[match[1]]) fontObjectRefs[match[1]] = Number(match[2]);
    }

    const fontMaps = {};
    for (const alias of Object.keys(fontObjectRefs)) {
      const fontObject = getJorgePdfObject(pdfText, fontObjectRefs[alias]);
      const toUnicode = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontObject);
      if (!toUnicode) continue;
      const cmapObject = getJorgePdfObject(pdfText, Number(toUnicode[1]));
      fontMaps[alias] = parseJorgePdfCMap(getJorgePdfStream(cmapObject));
    }

    const contentRefs = [];
    const seen = new Set();
    const contentsRegex = /\/Contents\s+(\d+)\s+0\s+R/g;
    while ((match = contentsRegex.exec(pdfText))) {
      const ref = Number(match[1]);
      if (!seen.has(ref)) {
        seen.add(ref);
        contentRefs.push(ref);
      }
    }
    if (!contentRefs.length) throw new Error('Reembolso Plano Jorge: não foi possível localizar o conteúdo textual do PDF.');

    const lines = [];
    for (const ref of contentRefs) {
      const contentObject = getJorgePdfObject(pdfText, ref);
      if (/\/FlateDecode\b/.test(contentObject)) {
        throw new Error('Reembolso Plano Jorge: o PDF usa compressão textual não suportada por esta versão.');
      }
      const stream = getJorgePdfStream(contentObject);
      let currentFont = '';
      const tokenRegex = /\/(F\d+)\s+[-\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj/g;
      let token;
      while ((token = tokenRegex.exec(stream))) {
        if (token[1]) {
          currentFont = token[1];
          continue;
        }
        if (!token[2]) continue;
        const decoded = decodeJorgePdfTextHex(token[2], fontMaps[currentFont]);
        if (decoded) lines.push(decoded);
      }
    }
    return lines.join('\n');
  }

  function extractJorgeReimbursementFromPdfBase64(base64, expectedPeriod) {
    const period = String(expectedPeriod || '').trim();
    if (!/^\d{6}$/.test(period)) throw new Error('Reembolso Plano Jorge: período inválido.');
    const text = extractJorgePdfText(base64).replace(/\u00a0/g, ' ');
    const normalized = text.replace(/[ \t]+/g, ' ').replace(/\r/g, '');
    const dateMatch = /data do pagamento\s+(\d{2}\/\d{2}\/\d{4})/i.exec(normalized);
    const valueMatch = /valor do pagamento\s+R\$\s*([\d.]+,\d{2})/i.exec(normalized);
    if (!dateMatch) throw new Error('Reembolso Plano Jorge: campo "data do pagamento" não encontrado no PDF.');
    if (!valueMatch) throw new Error('Reembolso Plano Jorge: campo "valor do pagamento" não encontrado no PDF.');

    const paymentDate = dateMatch[1];
    const dateParts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(paymentDate);
    const actualPeriod = dateParts[3] + dateParts[2];
    if (actualPeriod !== period) {
      throw new Error('Reembolso Plano Jorge: a data do pagamento (' + paymentDate + ') diverge do período esperado ' + period + '.');
    }

    const numeric = valueMatch[1].replace(/\./g, '').replace(',', '.');
    const valueCents = Math.round(Number(numeric) * 100);
    if (!Number.isFinite(valueCents) || valueCents <= 0) {
      throw new Error('Reembolso Plano Jorge: valor do pagamento inválido no PDF.');
    }
    return { paymentDate, valueCents, period, extractedText: text };
  }

  function extractIssGuideNumberFromText(rawText) {
    const text = String(rawText == null ? '' : rawText).replace(/\u00a0/g, ' ');
    const documentMatch = /Documento\s+No\.?[ \t]*([0-9. \t]+)/i.exec(text);
    let documentGuideNumber = '';
    if (documentMatch) {
      const digits = String(documentMatch[1] || '').replace(/\D/g, '');
      if (digits.length >= 8) documentGuideNumber = digits.slice(-8);
    }

    let lowerSequenceGuideNumber = '';
    const sequenceRegex = /(?:^|\D)(\d{12})(?=\D|$)/g;
    let sequenceMatch;
    while ((sequenceMatch = sequenceRegex.exec(text))) {
      const candidate = String(sequenceMatch[1] || '');
      if (/^0{4}\d{8}$/.test(candidate)) {
        lowerSequenceGuideNumber = candidate.slice(-8);
        break;
      }
    }

    if (documentGuideNumber && lowerSequenceGuideNumber && documentGuideNumber !== lowerSequenceGuideNumber) {
      throw new Error('ISS Corretora: o número da guia em "Documento No." e a sequência inferior divergem.');
    }
    const guideNumber = documentGuideNumber || lowerSequenceGuideNumber;
    if (!/^\d{8}$/.test(guideNumber)) {
      throw new Error('ISS Corretora: número da guia não encontrado no conteúdo textual do PDF.');
    }
    return { guideNumber, documentGuideNumber, lowerSequenceGuideNumber };
  }

  function getIssCorretoraCompetenceFromFileName(fileName) {
    const name = String(fileName == null ? '' : fileName).trim();
    const match = /^CORRETORA_GUIA_ISS_DAMSP_58345965_(\d{6})\.PDF$/i.exec(name);
    if (!match) throw new Error('ISS Corretora: nome do PDF fora do padrão esperado.');
    const period = match[1];
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(4, 6));
    if (!Number.isInteger(year) || year < 2000 || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error('ISS Corretora: competência inválida no nome do PDF: ' + period + '.');
    }
    return {
      period,
      year,
      month,
      competenceText: String(month).padStart(2, '0') + '/' + String(year)
    };
  }

  function getIssCorretoraCsvFileNames(periodValue) {
    const period = String(periodValue == null ? '' : periodValue).trim();
    const match = /^(\d{4})(\d{2})$/.exec(period);
    if (!match) throw new Error('ISS Corretora: competência inválida para localizar os CSVs: ' + period + '.');
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || year < 2000 || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error('ISS Corretora: competência inválida para localizar os CSVs: ' + period + '.');
    }
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const monthDays = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const endDay = String(monthDays[month - 1]).padStart(2, '0');
    const range = period + '01_' + period + endDay;
    return [
      'NFSe_E_58345965_' + range + '.csv',
      'NFSe_58345965_' + range + '.csv'
    ];
  }

  function getIssCorretoraConferenceFields(data) {
    data = data || {};
    const fields = [
      { key: 'competence', label: 'Competência', value: String(data.competenceText || '') },
      { key: 'guideNumber', label: 'Nº da guia', value: String(data.guideNumber || '') },
      { key: 'pdfName', label: 'Arquivo', value: String(data.pdfName || '') }
    ];

    const analysis = data.csvAnalysis;
    if (analysis && Array.isArray(analysis.sources)) {
      const sourceE = analysis.sources.find((item) => item && item.sourceType === 'NFSe_E') || { recordCount: 0, issDueCents: 0 };
      const sourceN = analysis.sources.find((item) => item && item.sourceType === 'NFSe') || { recordCount: 0, issDueCents: 0 };
      const totalCount = Array.isArray(analysis.records) ? analysis.records.length : Number(analysis.recordCount || 0);
      const totalCents = Number(analysis.totalIssDueCents || 0);
      const noteLabel = (count) => Number(count) === 1 ? 'nota' : 'notas';
      fields.push(
        { key: 'nfseE', label: 'NFSe_E', value: String(sourceE.recordCount || 0) + ' ' + noteLabel(sourceE.recordCount) + ' • R$ ' + formatCentsBR(sourceE.issDueCents || 0) },
        { key: 'nfse', label: 'NFSe', value: String(sourceN.recordCount || 0) + ' ' + noteLabel(sourceN.recordCount) + ' • R$ ' + formatCentsBR(sourceN.issDueCents || 0) },
        { key: 'csvTotal', label: 'Total CSVs', value: String(totalCount || 0) + ' ' + noteLabel(totalCount) + ' • R$ ' + formatCentsBR(totalCents) }
      );
    }
    return fields;
  }

  function parseIssCorretoraSemicolonCsv(rawText) {
    const text = String(rawText == null ? '' : rawText).replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        quoted = true;
      } else if (char === ';') {
        row.push(field);
        field = '';
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(field);
        field = '';
        if (row.some((value) => String(value || '').trim() !== '')) rows.push(row);
        row = [];
      } else {
        field += char;
      }
    }

    if (quoted) throw new Error('ISS Corretora: CSV inválido, campo entre aspas não foi encerrado.');
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      if (row.some((value) => String(value || '').trim() !== '')) rows.push(row);
    }
    return rows;
  }

  function getIssCorretoraCsvSourceType(sourceName) {
    const name = String(sourceName == null ? '' : sourceName).trim();
    if (/^NFSe_E_/i.test(name)) return 'NFSe_E';
    if (/^NFSe_/i.test(name)) return 'NFSe';
    return name || 'CSV';
  }

  function parseIssCorretoraCsvRecords(rawText, options) {
    options = options || {};
    const sourceName = String(options.sourceName || '').trim();
    const expectedGuide = String(options.guideNumber || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(expectedGuide)) throw new Error('ISS Corretora: número da guia inválido para filtrar os CSVs.');

    const matrix = parseIssCorretoraSemicolonCsv(rawText);
    if (matrix.length < 2) throw new Error('ISS Corretora: CSV vazio ou sem registros: ' + (sourceName || 'arquivo sem nome') + '.');

    const header = matrix[0].map((value) => normalizeText(String(value || '').replace(/^\uFEFF/, '')));
    const required = {
      recordType: 'tipo de registro',
      nfseNumber: 'nº nfs-e',
      guideNumber: 'nº da guia',
      serviceCode: 'código do serviço prestado na nota fiscal',
      issDue: 'iss devido'
    };
    const indexes = {};
    Object.keys(required).forEach((key) => {
      indexes[key] = header.indexOf(required[key]);
      if (indexes[key] < 0) {
        throw new Error('ISS Corretora: coluna obrigatória "' + required[key] + '" não encontrada em ' + (sourceName || 'CSV') + '.');
      }
    });

    const sourceType = getIssCorretoraCsvSourceType(sourceName);
    const records = [];
    for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
      const row = matrix[rowIndex];
      const recordType = String(row[indexes.recordType] == null ? '' : row[indexes.recordType]).trim();
      if (recordType !== '2') continue;

      const rowGuide = String(row[indexes.guideNumber] == null ? '' : row[indexes.guideNumber]).replace(/\D/g, '');
      if (rowGuide !== expectedGuide) continue;

      const rawIss = String(row[indexes.issDue] == null ? '' : row[indexes.issDue]).trim();
      if (!/^-?(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?$/.test(rawIss)) {
        throw new Error('ISS Corretora: valor de ISS devido inválido na linha ' + String(rowIndex + 1) + ' de ' + (sourceName || 'CSV') + ': ' + rawIss + '.');
      }
      const issDueCents = parseProtheusMoneyToCents(rawIss);
      if (!Number.isSafeInteger(issDueCents) || issDueCents < 0) {
        throw new Error('ISS Corretora: valor de ISS devido inválido na linha ' + String(rowIndex + 1) + ' de ' + (sourceName || 'CSV') + '.');
      }

      records.push({
        sourceName,
        sourceType,
        nfseNumber: String(row[indexes.nfseNumber] == null ? '' : row[indexes.nfseNumber]).trim(),
        guideNumber: rowGuide,
        serviceCode: String(row[indexes.serviceCode] == null ? '' : row[indexes.serviceCode]).trim(),
        issDueCents
      });
    }
    return records;
  }

  function analyzeIssCorretoraCsvSources(sources, guideNumber) {
    if (!Array.isArray(sources) || sources.length !== 2) {
      throw new Error('ISS Corretora: são esperados exatamente dois arquivos CSV da Prefeitura.');
    }
    const normalizedGuide = String(guideNumber || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(normalizedGuide)) throw new Error('ISS Corretora: número da guia inválido para analisar os CSVs.');

    const records = [];
    const summaries = [];
    const seenTypes = new Set();
    sources.forEach((source) => {
      const fileName = String(source && (source.fileName || source.csvName) || '').trim();
      const csvText = String(source && (source.csvText || source.text) || '');
      const sourceType = getIssCorretoraCsvSourceType(fileName);
      if (sourceType !== 'NFSe_E' && sourceType !== 'NFSe') {
        throw new Error('ISS Corretora: arquivo CSV inesperado: ' + (fileName || 'sem nome') + '.');
      }
      if (seenTypes.has(sourceType)) throw new Error('ISS Corretora: arquivo CSV duplicado para a origem ' + sourceType + '.');
      seenTypes.add(sourceType);

      const sourceRecords = parseIssCorretoraCsvRecords(csvText, { sourceName: fileName, guideNumber: normalizedGuide });
      const issDueCents = sourceRecords.reduce((sum, record) => sum + record.issDueCents, 0);
      records.push.apply(records, sourceRecords);
      summaries.push({ sourceType, fileName, recordCount: sourceRecords.length, issDueCents });
    });

    if (!seenTypes.has('NFSe_E') || !seenTypes.has('NFSe')) {
      throw new Error('ISS Corretora: os dois CSVs esperados (NFSe_E e NFSe) não foram identificados.');
    }
    summaries.sort((left, right) => left.sourceType === right.sourceType ? 0 : (left.sourceType === 'NFSe_E' ? -1 : 1));
    const totalIssDueCents = records.reduce((sum, record) => sum + record.issDueCents, 0);
    if (records.length === 0) throw new Error('ISS Corretora: nenhum registro dos CSVs pertence à guia ' + normalizedGuide + '.');
    return { guideNumber: normalizedGuide, records, sources: summaries, totalIssDueCents };
  }

  function extractIssGuideNumberFromDamspBarcode(value) {
    const digits = String(value == null ? '' : value).replace(/\D/g, '');
    if (!/^8\d{43}$/.test(digits)) {
      throw new Error('ISS Corretora: código de barras DAMSP inválido ou não reconhecido.');
    }
    const guideNumber = digits.slice(29, 37);
    if (!/^\d{8}$/.test(guideNumber)) {
      throw new Error('ISS Corretora: não foi possível derivar o número da guia do código de barras DAMSP.');
    }
    return guideNumber;
  }

  function decodePdfBase64Bytes(base64) {
    const text = String(base64 || '').replace(/\s+/g, '');
    if (!text) throw new Error('ISS Corretora: PDF vazio ou inválido.');
    if (typeof atob === 'function') {
      const binary = atob(text);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index) & 0xff;
      return bytes;
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
    throw new Error('ISS Corretora: ambiente sem suporte para decodificar o PDF.');
  }

  function bytesToLatin1(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    let output = '';
    const chunkSize = 8192;
    for (let index = 0; index < source.length; index += chunkSize) {
      output += String.fromCharCode.apply(null, source.subarray(index, Math.min(index + chunkSize, source.length)));
    }
    return output;
  }

  function getPdfStreamStart(pdfText, streamTokenIndex) {
    let index = streamTokenIndex + 6;
    if (pdfText[index] === '\r' && pdfText[index + 1] === '\n') return index + 2;
    if (pdfText[index] === '\r' || pdfText[index] === '\n') return index + 1;
    return index;
  }

  function getPdfObjectStreamBytes(pdfBytes, pdfText, objectNumber) {
    const marker = new RegExp('(?:^|[\\r\\n])' + String(objectNumber) + '\\s+0\\s+obj\\b', 'g');
    const match = marker.exec(pdfText);
    if (!match) return null;
    const objectStart = match.index + (match[0][0] === '\r' || match[0][0] === '\n' ? 1 : 0);
    const streamTokenIndex = pdfText.indexOf('stream', objectStart);
    if (streamTokenIndex < 0) return null;
    const endObjectIndex = pdfText.indexOf('endobj', objectStart);
    if (endObjectIndex >= 0 && streamTokenIndex > endObjectIndex) return null;
    const dictionary = pdfText.slice(objectStart, streamTokenIndex);
    const lengthMatch = /\/Length\s+(\d+)/.exec(dictionary);
    if (!lengthMatch) return null;
    const length = Number(lengthMatch[1]);
    const start = getPdfStreamStart(pdfText, streamTokenIndex);
    if (!Number.isInteger(length) || length <= 0 || start + length > pdfBytes.length) return null;
    return { dictionary, bytes: pdfBytes.slice(start, start + length) };
  }

  function findIssPdfIndexedImage(pdfBytes, pdfText) {
    let searchIndex = 0;
    while (searchIndex < pdfText.length) {
      const subtypeIndex = pdfText.indexOf('/Subtype/Image', searchIndex);
      if (subtypeIndex < 0) break;
      const objectTokenIndex = pdfText.lastIndexOf('obj', subtypeIndex);
      const lineStart = Math.max(0, pdfText.lastIndexOf('\n', objectTokenIndex) + 1);
      const header = pdfText.slice(lineStart, subtypeIndex);
      const objectMatch = /(\d+)\s+0\s+obj/.exec(header);
      if (!objectMatch) {
        searchIndex = subtypeIndex + 13;
        continue;
      }
      const objectNumber = Number(objectMatch[1]);
      const streamInfo = getPdfObjectStreamBytes(pdfBytes, pdfText, objectNumber);
      if (!streamInfo) {
        searchIndex = subtypeIndex + 13;
        continue;
      }
      const dictionary = streamInfo.dictionary;
      const widthMatch = /\/Width\s+(\d+)/.exec(dictionary);
      const heightMatch = /\/Height\s+(\d+)/.exec(dictionary);
      const bitsMatch = /\/BitsPerComponent\s+(\d+)/.exec(dictionary);
      const paletteMatch = /\/ColorSpace\s*\[\s*\/Indexed\s*\/DeviceRGB\s+(\d+)\s+(\d+)\s+0\s+R\s*\]/.exec(dictionary);
      const flate = /\/Filter\s*(?:\[\s*)?\/FlateDecode\b/.test(dictionary);
      if (widthMatch && heightMatch && bitsMatch && Number(bitsMatch[1]) === 8 && paletteMatch && flate) {
        return {
          width: Number(widthMatch[1]),
          height: Number(heightMatch[1]),
          maxPaletteIndex: Number(paletteMatch[1]),
          paletteObjectNumber: Number(paletteMatch[2]),
          compressedBytes: streamInfo.bytes
        };
      }
      searchIndex = subtypeIndex + 13;
    }
    throw new Error('ISS Corretora: imagem raster da guia DAMSP não encontrada no PDF.');
  }

  async function inflateDeflateBytes(bytes) {
    if (typeof DecompressionStream !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function') {
      throw new Error('ISS Corretora: o Edge atual não oferece suporte à descompressão necessária para ler a guia.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  function buildPaletteDarkMap(paletteBytes, maxPaletteIndex) {
    const count = Number(maxPaletteIndex) + 1;
    if (!(paletteBytes instanceof Uint8Array) || paletteBytes.length < count * 3) {
      throw new Error('ISS Corretora: paleta de cores inválida no PDF.');
    }
    const dark = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      const base = index * 3;
      const r = paletteBytes[base];
      const g = paletteBytes[base + 1];
      const b = paletteBytes[base + 2];
      const luminance = (r * 299 + g * 587 + b * 114) / 1000;
      dark[index] = luminance < 128 ? 1 : 0;
    }
    return dark;
  }

  const I25_DIGIT_PATTERNS = Object.freeze({
    nnwwn: '0', wnnnw: '1', nwnnw: '2', wwnnn: '3', nnwnw: '4',
    wnwnn: '5', nwwnn: '6', nnnww: '7', wnnwn: '8', nwnwn: '9'
  });

  function clusterI25Widths(lengths) {
    if (!Array.isArray(lengths) || lengths.length === 0) return null;
    let low = Math.min.apply(null, lengths);
    let high = Math.max.apply(null, lengths);
    if (!(low > 0) || high <= low) return null;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      let lowSum = 0;
      let lowCount = 0;
      let highSum = 0;
      let highCount = 0;
      const boundary = (low + high) / 2;
      for (const value of lengths) {
        if (value <= boundary) {
          lowSum += value;
          lowCount += 1;
        } else {
          highSum += value;
          highCount += 1;
        }
      }
      if (!lowCount || !highCount) return null;
      low = lowSum / lowCount;
      high = highSum / highCount;
    }
    if (high < low) [low, high] = [high, low];
    const ratio = high / low;
    if (ratio < 1.45 || ratio > 3.6) return null;
    return { low, high, threshold: (low + high) / 2 };
  }

  function decodeI25Runs(runs, startIndex) {
    const requiredRuns = 227;
    if (!Array.isArray(runs) || startIndex < 0 || startIndex + requiredRuns > runs.length) return '';
    const segment = runs.slice(startIndex, startIndex + requiredRuns);
    if (!segment[0].dark || !segment[requiredRuns - 1].dark) return '';
    const cluster = clusterI25Widths(segment.map((run) => run.length));
    if (!cluster) return '';
    const shape = segment.map((run) => run.length > cluster.threshold ? 'w' : 'n');
    if (shape.slice(0, 4).join('') !== 'nnnn') return '';
    if (shape.slice(-3).join('') !== 'wnn') return '';

    let digits = '';
    const dataShape = shape.slice(4, -3);
    if (dataShape.length !== 220) return '';
    for (let offset = 0; offset < dataShape.length; offset += 10) {
      let barPattern = '';
      let spacePattern = '';
      for (let pairIndex = 0; pairIndex < 5; pairIndex += 1) {
        barPattern += dataShape[offset + pairIndex * 2];
        spacePattern += dataShape[offset + pairIndex * 2 + 1];
      }
      const first = I25_DIGIT_PATTERNS[barPattern];
      const second = I25_DIGIT_PATTERNS[spacePattern];
      if (first == null || second == null) return '';
      digits += first + second;
    }
    return digits;
  }

  function makeBinaryRuns(indexedPixels, width, row, darkMap) {
    const runs = [];
    const rowStart = row * width;
    let start = 0;
    let current = !!darkMap[indexedPixels[rowStart]];
    for (let x = 1; x < width; x += 1) {
      const dark = !!darkMap[indexedPixels[rowStart + x]];
      if (dark === current) continue;
      runs.push({ dark: current, start, length: x - start });
      start = x;
      current = dark;
    }
    runs.push({ dark: current, start, length: width - start });
    return runs;
  }

  function decodeDamspI25FromIndexedImage(indexedPixels, width, height, darkMap) {
    if (!(indexedPixels instanceof Uint8Array) || indexedPixels.length < width * height) {
      throw new Error('ISS Corretora: pixels da guia inválidos.');
    }
    const startRow = Math.max(0, Math.floor(height * 0.78));
    const endRow = Math.min(height - 1, Math.ceil(height * 0.985));
    for (let row = startRow; row <= endRow; row += 1) {
      const runs = makeBinaryRuns(indexedPixels, width, row, darkMap);
      if (runs.length < 229) continue;
      for (let index = 1; index + 227 < runs.length; index += 1) {
        if (!runs[index].dark) continue;
        const before = runs[index - 1];
        const after = runs[index + 227];
        if (!before || before.dark || !after || after.dark) continue;
        if (before.length < 5 || after.length < 5) continue;
        const digits = decodeI25Runs(runs, index);
        if (!/^8\d{43}$/.test(digits)) continue;
        return digits;
      }
    }
    throw new Error('ISS Corretora: código de barras DAMSP não pôde ser lido da imagem do PDF.');
  }

  async function extractIssGuideFromPdfBase64(base64) {
    const pdfBytes = decodePdfBase64Bytes(base64);
    const pdfText = bytesToLatin1(pdfBytes);

    // Se uma futura versão da Prefeitura voltar a trazer camada textual, usa a regra original aprovada.
    try {
      const text = extractJorgePdfText(base64);
      const parsed = extractIssGuideNumberFromText(text);
      if (parsed && parsed.guideNumber) {
        return Object.assign({ method: 'pdf-text', barcodeDigits: '' }, parsed);
      }
    } catch (_) {
      // A guia DAMSP atual é rasterizada; segue para leitura determinística do código I25.
    }

    const image = findIssPdfIndexedImage(pdfBytes, pdfText);
    const paletteInfo = getPdfObjectStreamBytes(pdfBytes, pdfText, image.paletteObjectNumber);
    if (!paletteInfo) throw new Error('ISS Corretora: paleta da imagem DAMSP não encontrada no PDF.');
    const indexedPixels = await inflateDeflateBytes(image.compressedBytes);
    if (indexedPixels.length !== image.width * image.height) {
      throw new Error('ISS Corretora: tamanho inesperado da imagem raster da guia.');
    }
    const darkMap = buildPaletteDarkMap(paletteInfo.bytes, image.maxPaletteIndex);
    const barcodeDigits = decodeDamspI25FromIndexedImage(indexedPixels, image.width, image.height, darkMap);
    const guideNumber = extractIssGuideNumberFromDamspBarcode(barcodeDigits);
    return { guideNumber, barcodeDigits, method: 'damsp-i25-barcode' };
  }

  function buildJorgeReimbursementPreview(sourceData, date) {
    const source = sourceData || {};
    const paymentDateText = String(source.paymentDate || '').trim();
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(paymentDateText);
    if (!match) throw new Error('Reembolso Plano Jorge: data do pagamento inválida no PDF.');

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const paymentDate = new Date(year, month - 1, day);
    if (paymentDate.getFullYear() !== year || paymentDate.getMonth() !== month - 1 || paymentDate.getDate() !== day) {
      throw new Error('Reembolso Plano Jorge: data do pagamento inválida no PDF.');
    }

    const reference = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    if (reference.getFullYear() !== year || reference.getMonth() + 1 !== month) {
      throw new Error('Reembolso Plano Jorge: a data do pagamento do PDF não pertence ao mês/período atual.');
    }

    const valueCents = Math.round(Number(source.valueCents || 0));
    if (!Number.isFinite(valueCents) || valueCents <= 0) {
      throw new Error('Reembolso Plano Jorge: valor do pagamento inválido no PDF.');
    }

    const monthNames = Object.freeze([
      'JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO',
      'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'
    ]);
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const period = String(year) + mm;
    const receiptNumber = period + dd;
    const row = {
      dateText: paymentDateText,
      typeCode: '053',
      description: 'PLANO DE SAUDE',
      quantityKm: 0,
      valueKmCents: 0,
      valueCents,
      receiptNumber,
      observation: 'PLANO DE SAUDE ' + monthNames[month - 1] + '.',
      mappingFound: true
    };
    return { year, month, period, dateText: paymentDateText, receiptNumber, rows: [row] };
  }

  function findSoomarExpenseMapping(history) {
    const normalized = normalizeSoomarHistory(history);
    if (normalized.startsWith('INTERNET')) {
      return { history: normalized, typeCode: '032', description: 'INTERNET' };
    }
    return SOOMAR_EXPENSE_TYPE_MAP.find((item) => normalizeSoomarHistory(item.history) === normalized) || null;
  }

  function buildSoomarExpensePreview(rawRows, date) {
    const periodInfo = getSoomarPeriodInfo(date);
    const rows = [];
    for (const sourceRow of Array.isArray(rawRows) ? rawRows : []) {
      const valueCents = Number(sourceRow && sourceRow.valueCents || 0);
      if (!Number.isFinite(valueCents) || valueCents === 0) continue;
      const observation = String(sourceRow && sourceRow.history || '').replace(/\s+/g, ' ').trim();
      if (!observation) continue;
      const mapping = findSoomarExpenseMapping(observation);
      rows.push({
        dateText: periodInfo.dateText,
        typeCode: mapping ? mapping.typeCode : '',
        description: mapping ? mapping.description : 'SEM MAPEAMENTO',
        quantityKm: 0,
        valueKmCents: 0,
        valueCents: Math.round(valueCents),
        receiptNumber: periodInfo.receiptNumber,
        observation,
        mappingFound: !!mapping
      });
    }
    return Object.assign({}, periodInfo, { rows });
  }


  function findSoomarEntryOpenButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP3077', '');
  }

  function findSoomarParametersDialog(doc) {
    return findActiveElementByExactId(doc || document, 'COMP4500', '');
  }

  function findSoomarParameterCodeControl(doc) {
    return findActiveElementByExactId(doc || document, 'COMP4515', '');
  }

  function findSoomarParameterConfirmButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP4522', '');
  }

  function getSoomarParameterEditable(control) {
    if (!control) return null;
    let tag = '';
    try { tag = String(control.tagName || '').toUpperCase(); } catch (_) {}
    if (tag === 'INPUT' || tag === 'TEXTAREA') return control;
    try {
      if (control.getAttribute && String(control.getAttribute('contenteditable') || '').toLowerCase() === 'true') return control;
    } catch (_) {}
    return getInnerEditable(control);
  }

  function readSoomarParameterCode(control) {
    if (!control || String(control.id || '') !== 'COMP4515') return '';
    const inner = getSoomarParameterEditable(control);
    if (!inner) return '';
    try { return String(inner.value == null ? '' : inner.value).trim(); } catch (_) { return ''; }
  }

  function setSoomarParameterCode(control, value) {
    if (!control || String(control.id || '') !== 'COMP4515' || isControlLocked(control)) return false;
    const inner = getSoomarParameterEditable(control);
    if (!inner || isControlLocked(inner)) return false;
    const text = String(value == null ? '' : value).trim();
    if (!text) return false;

    try { if (typeof inner.focus === 'function') inner.focus(); } catch (_) {}
    try { if (typeof inner.select === 'function') inner.select(); } catch (_) {}
    if (!setNativeEditableValue(inner, '')) return false;
    dispatchSyntheticEvent(inner, 'input', { data: '', inputType: 'deleteContentBackward' });

    let current = '';
    for (const char of text) {
      dispatchSyntheticEvent(inner, 'keydown', { key: char, code: 'Digit' + char, data: char });
      dispatchSyntheticEvent(inner, 'beforeinput', { data: char, inputType: 'insertText' });
      current += char;
      if (!setNativeEditableValue(inner, current)) return false;
      dispatchSyntheticEvent(inner, 'input', { data: char, inputType: 'insertText' });
      dispatchSyntheticEvent(inner, 'keyup', { key: char, code: 'Digit' + char, data: char });
    }
    dispatchSyntheticEvent(inner, 'change');
    try { if (typeof inner.blur === 'function') inner.blur(); } catch (_) {}
    return readSoomarParameterCode(control) === text;
  }

  async function fillSoomarParameterCodeReliably(doc, value, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const stepDelayMs = normalizeSoomarStepDelayMs(opts.stepDelayMs);
    const text = String(value == null ? '' : value).trim();

    for (let attempt = 1; attempt <= 6; attempt++) {
      throwIfAborted(signal);
      const control = findSoomarParameterCodeControl(source);
      if (control && setSoomarParameterCode(control, text)) {
        await applySoomarStepDelay(stepDelayMs, signal);
        const verified = findSoomarParameterCodeControl(source);
        if (verified && readSoomarParameterCode(verified) === text) {
          emitDiagnostic(onLog, 'SOOMAR_PARAMETER_SET', 'Parâmetro do lançamento Soomar preenchido e validado.', { value: text, attempt });
          return true;
        }
      }
      await applySoomarStepDelay(stepDelayMs, signal);
    }
    return false;
  }

  async function runSoomarEntryPreparation(doc, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const stepDelayMs = normalizeSoomarStepDelayMs(opts.stepDelayMs);
    const parameterValue = '96';

    throwIfAborted(signal);
    onStatus('SOOMAR — abrindo parâmetros do lançamento...');
    const opened = await performConfirmedClick(source, {
      label: 'Soomar — abrir parâmetros',
      findTarget: findSoomarEntryOpenButton,
      isSuccess: (currentDoc) => !!findSoomarParametersDialog(currentDoc),
      triggerTarget: dispatchWaButtonGesture,
      onStatus,
      onLog,
      signal,
      stepDelayMs,
      maxAttempts: 3,
      effectTimeoutMs: 7000,
      effectPollMs: 150
    });
    if (!opened) throw new Error('Soomar: o botão COMP3077 foi acionado, mas a janela de parâmetros COMP4500 não abriu.');

    const codeControl = await waitForElement(source, findSoomarParameterCodeControl, stepDelayMs, signal);
    if (!codeControl) throw new Error('Soomar: o campo de parâmetro COMP4515 não foi encontrado.');

    onStatus('SOOMAR — preenchendo parâmetro 96...');
    if (!await fillSoomarParameterCodeReliably(source, parameterValue, { signal, onLog, stepDelayMs })) {
      throw new Error('Soomar: não foi possível preencher e validar o valor 96 em COMP4515.');
    }

    onStatus('SOOMAR — parâmetro 96 preenchido. Confirmando...');
    const confirmed = await performConfirmedClick(source, {
      label: 'Soomar — confirmar parâmetro 96',
      findTarget: findSoomarParameterConfirmButton,
      isSuccess: (currentDoc) => !findSoomarParametersDialog(currentDoc),
      triggerTarget: dispatchWaButtonGesture,
      onStatus,
      onLog,
      signal,
      stepDelayMs,
      maxAttempts: 3,
      effectTimeoutMs: 7000,
      effectPollMs: 150
    });
    if (!confirmed) throw new Error('Soomar: o botão Confirmar COMP4522 foi acionado, mas a janela de parâmetros não fechou.');

    emitDiagnostic(onLog, 'SOOMAR_ENTRY_PREPARED', 'Parâmetro 96 confirmado no Protheus.', { value: parameterValue });
    return { ok: true, parameterValue };
  }

  function normalizeSoomarSemanticLabel(value) {
    return normalizeText(String(value == null ? '' : value)
      .replace(/<[^>]*>/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/^[\s•·-]+/, '')
      .replace(/\s*\(\d+\)\s*$/, ''));
  }

  function getSoomarSemanticLabels(el) {
    if (!el) return [];
    const values = [];
    const pushData = function (node) {
      if (!node) return;
      const data = getElementTextData(node);
      values.push(data.title, data.caption, data.text, data.value, data.ariaLabel);
    };
    pushData(el);
    try {
      const native = getNativeActionTarget(el);
      if (native && native !== el) pushData(native);
    } catch (_) {}
    return Array.from(new Set(values.map(normalizeSoomarSemanticLabel).filter(Boolean)));
  }

  function findUniqueSoomarSemanticElement(doc, selector, expectedLabel) {
    const source = doc || document;
    const roots = collectRoots(source);
    const wanted = normalizeSoomarSemanticLabel(expectedLabel);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (!isElementActive(node) || isControlLocked(node)) continue;
        if (!getSoomarSemanticLabels(node).includes(wanted)) continue;
        matches.push(node);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function listSoomarNavigationCandidates(doc, selector) {
    const source = doc || document;
    const roots = collectRoots(source);
    const output = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (!isElementActive(node) || isControlLocked(node)) continue;
        output.push(Object.assign({}, describeActionTarget(node) || {}, { semanticLabels: getSoomarSemanticLabels(node) }));
      }
    }
    return output;
  }

  function normalizeIssNavigationLabel(value, stripCounter) {
    let text = String(value == null ? '' : value)
      .replace(/<[^>]*>/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/^[\s•·-]+/, '')
      .trim();
    if (stripCounter !== false) text = text.replace(/\s*\(\d+\)\s*$/, '').trim();
    return normalizeText(text);
  }

  function collectIssNavigationCandidates(doc, selector, expectedAdvpl) {
    const source = doc || document;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (!isElementActive(node) || isControlLocked(node)) continue;
        if (expectedAdvpl) {
          let advpl = '';
          try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
          if (advpl !== String(expectedAdvpl).toLowerCase()) continue;
        }
        matches.push(node);
      }
    }
    return matches;
  }

  function findUniqueIssNavigationByPriority(candidates, priorities, acceptedLabels, stripCounter) {
    const accepted = new Set((acceptedLabels || []).map((value) => normalizeIssNavigationLabel(value, stripCounter)).filter(Boolean));
    if (!accepted.size) return null;
    const readValue = function (node, field) {
      try {
        if (field === 'text') return getRenderedText(node) || node.innerText || node.textContent || '';
        return node.getAttribute ? node.getAttribute(field) || '' : '';
      } catch (_) { return ''; }
    };
    for (const field of priorities || []) {
      const fieldMatches = candidates.filter((node) => accepted.has(normalizeIssNavigationLabel(readValue(node, field), stripCounter)));
      if (fieldMatches.length === 1) return fieldMatches[0];
      if (fieldMatches.length > 1) return null;
    }
    return null;
  }

  function findIssCorretoraAccountsPayableOption(doc) {
    const candidates = collectIssNavigationCandidates(doc || document, 'wa-text-view', 'tsay');
    return findUniqueIssNavigationByPriority(
      candidates,
      ['title', 'caption', 'text'],
      ['Funcöes Ctas a Pag', 'Funcoes Ctas a Pag', 'Funções Ctas a Pag'],
      false
    );
  }

  function findIssCorretoraUpdatesButton(doc) {
    const candidates = collectIssNavigationCandidates(doc || document, 'wa-menu-item', 'tmenuitem');
    return findUniqueIssNavigationByPriority(
      candidates,
      ['caption', 'title', 'text'],
      ['Atualizações'],
      true
    );
  }

  async function runIssCorretoraAccountsPayableNavigation(doc, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const onTrustedClick = typeof opts.onTrustedClick === 'function' ? opts.onTrustedClick : null;
    const stepDelayMs = Math.max(1, Number(opts.stepDelayMs) || 200);
    const maxRevealAttempts = Math.max(1, Math.trunc(Number(opts.maxRevealAttempts) || 25));
    if (!onTrustedClick) throw new Error('ISS Corretora: clique confiável não foi disponibilizado para a navegação.');

    const trustedClick = async (target) => !!(await Promise.resolve(onTrustedClick(target)));
    const revealTimeoutMs = Math.max(5000, maxRevealAttempts * stepDelayMs);
    let option = findIssCorretoraAccountsPayableOption(source);
    let usedUpdatesMenu = false;

    if (!option) {
      onStatus('ISS CORRETORA — abrindo Atualizações...');
      const updatesOpened = await performVerifiedAction(source, {
        label: 'ISS Corretora — Atualizações',
        findTarget: findIssCorretoraUpdatesButton,
        execute: trustedClick,
        isSuccess: (currentDoc) => !!findIssCorretoraAccountsPayableOption(currentDoc),
        inspectRetryState: (currentDoc) => {
          if (findIssCorretoraAccountsPayableOption(currentDoc)) return { state: 'success', reason: 'opção revelada' };
          if (findIssCorretoraUpdatesButton(currentDoc)) return { state: 'previous', reason: 'menu Atualizações ainda está disponível' };
          return { state: 'processing', reason: 'menu em transição' };
        },
        retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.NEVER_BLIND_RETRY,
        maxAttempts: 2,
        effectTimeoutMs: revealTimeoutMs,
        processingTimeoutMs: revealTimeoutMs,
        effectPollMs: Math.min(stepDelayMs, 200),
        onStatus,
        onLog,
        signal
      });
      if (!updatesOpened) {
        throw new Error('ISS Corretora: Atualizações foi acionado, mas Funcoes Ctas a Pag não apareceu sem uma repetição cega do menu.');
      }
      usedUpdatesMenu = true;
      option = findIssCorretoraAccountsPayableOption(source);
    }

    if (!option) throw new Error('ISS Corretora: Funcoes Ctas a Pag não foi localizada semanticamente.');
    const optionTargetId = String(option.id || '');
    const optionSemanticLabels = getSoomarSemanticLabels(option);

    onStatus('ISS CORRETORA — abrindo Funcoes Ctas a Pag...');
    const opened = await performVerifiedAction(source, {
      label: 'ISS Corretora — Funcoes Ctas a Pag',
      findTarget: findIssCorretoraAccountsPayableOption,
      execute: trustedClick,
      isSuccess: (currentDoc) => {
        const readiness = getIssCorretoraAccountsPayableReadiness(currentDoc);
        return readiness.screenReady || readiness.gridReady || readiness.filterReady;
      },
      inspectRetryState: (currentDoc) => {
        const readiness = getIssCorretoraAccountsPayableReadiness(currentDoc);
        if (readiness.screenReady || readiness.gridReady || readiness.filterReady) {
          return { state: 'success', reason: 'Contas a Pagar começou a carregar' };
        }
        if (findIssCorretoraAccountsPayableOption(currentDoc)) {
          return { state: 'previous', reason: 'opção Funcoes Ctas a Pag continua disponível e a tela de destino não apareceu' };
        }
        return { state: 'processing', reason: 'opção deixou o menu e a tela de destino ainda está carregando' };
      },
      retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
      maxAttempts: 2,
      effectTimeoutMs: 20000,
      processingTimeoutMs: 20000,
      effectPollMs: 120,
      retryDelayMs: 300,
      onStatus,
      onLog,
      signal
    });
    if (!opened) throw new Error('ISS Corretora: Funcoes Ctas a Pag foi acionado, mas o Protheus não confirmou a abertura de Contas a Pagar.');

    emitDiagnostic(onLog, 'ISS_CORRETORA_ACCOUNTS_PAYABLE_CLICKED', 'Funcoes Ctas a Pag foi confirmada pela infraestrutura de ação verificada.', {
      usedUpdatesMenu,
      targetId: optionTargetId,
      semanticLabels: optionSemanticLabels
    });
    return { ok: true, usedUpdatesMenu, targetId: optionTargetId };
  }

  function listIssActiveNodes(doc, predicate) {
    const source = doc || document;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('*')); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (!isElementActive(node) || isControlLocked(node)) continue;
        try {
          if (!predicate || predicate(node)) matches.push(node);
        } catch (_) {}
      }
    }
    return matches;
  }

  function findIssCorretoraAccountsPayableMarker(doc) {
    const candidates = listIssActiveNodes(doc || document, (node) => {
      if (String(node.tagName || '').toUpperCase() !== 'WA-TEXT-VIEW') return false;
      let advpl = '';
      try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
      return !advpl || advpl === 'tsay';
    });
    return findUniqueIssNavigationByPriority(candidates, ['caption', 'title', 'text'], ['Contas a Pagar'], false);
  }

  function findIssCorretoraAccountsPayableGrid(doc) {
    const candidates = listIssActiveNodes(doc || document, (node) => {
      if (String(node.tagName || '').toUpperCase() !== 'WA-TGRID') return false;
      let advpl = '';
      try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
      return !advpl || advpl === 'tgrid';
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function findIssCorretoraFilterButton(doc) {
    const candidates = listIssActiveNodes(doc || document, (node) => {
      if (String(node.tagName || '').toUpperCase() !== 'WA-BUTTON') return false;
      let advpl = '';
      try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
      return !advpl || advpl === 'thbutton' || advpl === 'tbutton';
    });
    return findUniqueIssNavigationByPriority(candidates, ['title', 'caption', 'text'], ['Filtrar'], false);
  }

  function getIssCorretoraAccountsPayableReadiness(doc) {
    const source = doc || document;
    const marker = findIssCorretoraAccountsPayableMarker(source);
    const grid = findIssCorretoraAccountsPayableGrid(source);
    const filterButton = findIssCorretoraFilterButton(source);
    const state = {
      screenReady: !!marker,
      gridReady: !!grid,
      filterReady: !!filterButton
    };
    state.ready = state.screenReady && state.gridReady && state.filterReady;
    return state;
  }

  async function waitForIssCorretoraAccountsPayableReady(doc, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || 60000);
    const pollMs = Math.max(50, Number(opts.pollMs) || 100);
    let state = getIssCorretoraAccountsPayableReadiness(source);
    if (state.ready) return state;
    await waitForCondition(() => {
      state = getIssCorretoraAccountsPayableReadiness(source);
      return state.ready;
    }, timeoutMs, pollMs, signal);
    return getIssCorretoraAccountsPayableReadiness(source);
  }

  function findUniqueIssNamedControl(doc, tagName, name, advpl) {
    const wantedTag = String(tagName || '').toUpperCase();
    const wantedName = String(name || '');
    const wantedAdvpl = String(advpl || '').toLowerCase();
    const matches = listIssActiveNodes(doc || document, (node) => {
      let nodeName = '';
      let nodeAdvpl = '';
      try { nodeName = String(node.getAttribute && node.getAttribute('name') || ''); } catch (_) {}
      try { nodeAdvpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
      return String(node.tagName || '').toUpperCase() === wantedTag &&
        nodeName === wantedName &&
        (!wantedAdvpl || nodeAdvpl === wantedAdvpl);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function findIssFilterNameControl(doc) {
    return findUniqueIssNamedControl(doc || document, 'wa-text-input', 'Self:cName', 'tget');
  }

  function findIssFilterFieldControl(doc) {
    return findUniqueIssNamedControl(doc || document, 'wa-combobox', 'Self:cField', 'tcombobox');
  }

  function findIssFilterOperatorControl(doc) {
    return findUniqueIssNamedControl(doc || document, 'wa-combobox', 'Self:cOper', 'tcombobox');
  }

  function getIssFilterNativeSelect(control) {
    if (!control) return null;
    try {
      if (String(control.tagName || '').toUpperCase() === 'SELECT') return control;
      if (control.shadowRoot) return control.shadowRoot.querySelector('select');
    } catch (_) {}
    return null;
  }

  function getIssOptionText(option) {
    if (!option) return '';
    try { return String(option.textContent || option.innerText || option.label || '').trim(); } catch (_) { return ''; }
  }

  function readIssFilterComboboxText(control) {
    const select = getIssFilterNativeSelect(control);
    if (!select) return '';
    let options = [];
    try { options = Array.from(select.options || select.querySelectorAll('option') || []); } catch (_) {}
    if (!options.length) return '';
    let selectedIndex = Number(select.selectedIndex);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) {
      const value = String(select.value == null ? '' : select.value);
      selectedIndex = options.findIndex((option) => String(option && option.value == null ? '' : option.value) === value);
    }
    return selectedIndex >= 0 && selectedIndex < options.length ? getIssOptionText(options[selectedIndex]) : '';
  }

  function setIssFilterComboboxByText(control, label) {
    const select = getIssFilterNativeSelect(control);
    if (!select || isControlLocked(control) || isControlLocked(select)) return false;
    let options = [];
    try { options = Array.from(select.options || select.querySelectorAll('option') || []); } catch (_) {}
    const wanted = normalizeText(label);
    const matches = options.map((option, index) => ({ option, index }))
      .filter((item) => normalizeText(getIssOptionText(item.option)) === wanted);
    if (matches.length !== 1) return false;

    const selected = matches[0];
    const value = String(selected.option && selected.option.value == null ? '' : selected.option.value);
    try { select.selectedIndex = selected.index; } catch (_) {}
    try { select.value = value; } catch (_) {}
    dispatchSyntheticEvent(select, 'input');
    dispatchSyntheticEvent(select, 'change');
    return normalizeText(readIssFilterComboboxText(control)) === wanted;
  }

  function findIssFilterManagerMarker(doc) {
    const candidates = listIssActiveNodes(doc || document, (node) => String(node.tagName || '').toUpperCase() === 'WA-TEXT-VIEW');
    return findUniqueIssNavigationByPriority(candidates, ['caption', 'title', 'text'], ['Gerenciador de Filtros'], false);
  }

  function findIssCorretoraRemoveAppliedFiltersButton(doc) {
    const candidates = listIssActiveNodes(doc || document, (node) => String(node.tagName || '').toUpperCase() === 'WA-BUTTON');
    return findUniqueIssNavigationByPriority(candidates, ['caption', 'title', 'text'], ['Remover'], false);
  }

  function findIssFilterManagerCreateButton(doc) {
    const candidates = listIssActiveNodes(doc || document, (node) => {
      if (String(node.tagName || '').toUpperCase() !== 'WA-BUTTON') return false;
      let advpl = '';
      try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
      return !advpl || advpl === 'tbutton';
    });
    return findUniqueIssNavigationByPriority(candidates, ['caption', 'title', 'text'], ['Criar Filtro'], false);
  }

  function activateIssFilterManagerCreateButton(control) {
    if (!control || isControlLocked(control)) return false;
    const target = getNativeActionTarget(control);
    if (!target || target === control || isControlLocked(target)) return false;
    let tag = '';
    try { tag = String(target.tagName || '').toUpperCase(); } catch (_) {}
    if (tag !== 'BUTTON' && tag !== 'INPUT') return false;
    try {
      if (typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
      }
      if (typeof target.click === 'function') {
        target.click();
        return true;
      }
    } catch (_) {}
    return false;
  }

  function findIssFilterCreateDialogMarker(doc) {
    const candidates = listIssActiveNodes(doc || document, (node) => {
      if (String(node.tagName || '').toUpperCase() !== 'WA-TEXT-VIEW') return false;
      let advpl = '';
      try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
      return !advpl || advpl === 'tsay';
    });
    return findUniqueIssNavigationByPriority(candidates, ['caption', 'title', 'text'], ['Criar Filtro'], false);
  }

  function findIssFilterCreateDialog(doc) {
    const marker = findIssFilterCreateDialogMarker(doc || document);
    if (!marker) return null;
    try {
      const closest = marker.closest && marker.closest('wa-dialog');
      if (closest && isElementActive(closest)) return closest;
    } catch (_) {}
    const dialogs = listIssActiveNodes(doc || document, (node) => String(node.tagName || '').toUpperCase() === 'WA-DIALOG');
    const contained = dialogs.filter((dialog) => {
      try { return typeof dialog.contains === 'function' && dialog.contains(marker); } catch (_) { return false; }
    });
    if (contained.length === 1) return contained[0];

    let markerRect = null;
    try { markerRect = marker.getBoundingClientRect && marker.getBoundingClientRect(); } catch (_) {}
    if (!markerRect) return null;
    const centerX = Number(markerRect.left) + Number(markerRect.width) / 2;
    const centerY = Number(markerRect.top) + Number(markerRect.height) / 2;
    const geometric = dialogs.filter((dialog) => {
      try {
        const rect = dialog.getBoundingClientRect();
        return centerX >= rect.left && centerX <= rect.right && centerY >= rect.top && centerY <= rect.bottom;
      } catch (_) { return false; }
    });
    return geometric.length === 1 ? geometric[0] : null;
  }

  function findIssFilterExpressionControl(doc) {
    const dialog = findIssFilterCreateDialog(doc || document);
    if (!dialog) return null;
    const roots = collectRoots(dialog);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('wa-text-input')); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node) || !isElementActive(node) || isControlLocked(node)) continue;
        seen.add(node);
        let name = '';
        let advpl = '';
        try { name = String(node.getAttribute && node.getAttribute('name') || ''); } catch (_) {}
        try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
        if (name === 'Self:cName') continue;
        if (advpl && advpl !== 'tget') continue;
        matches.push(node);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function findUniqueIssButtonByCaption(doc, caption, expectedAdvpl, scope) {
    const source = scope || doc || document;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('*')); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node) || !isElementActive(node) || isControlLocked(node)) continue;
        seen.add(node);
        if (String(node.tagName || '').toUpperCase() !== 'WA-BUTTON') continue;
        let advpl = '';
        try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
        if (expectedAdvpl && advpl !== String(expectedAdvpl).toLowerCase()) continue;
        let nodeCaption = '';
        try { nodeCaption = node.getAttribute && node.getAttribute('caption') || ''; } catch (_) {}
        if (normalizeIssNavigationLabel(nodeCaption, false) === normalizeIssNavigationLabel(caption, false)) matches.push(node);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function findIssFilterAddButton(doc) {
    const dialog = findIssFilterCreateDialog(doc || document);
    return dialog ? findUniqueIssButtonByCaption(doc || document, 'Adicionar', 'tbutton', dialog) : null;
  }

  function findIssFilterSaveButton(doc) {
    const dialog = findIssFilterCreateDialog(doc || document);
    return dialog ? findUniqueIssButtonByCaption(doc || document, 'Salvar', 'tbrowsebutton', dialog) : null;
  }

  function findIssFilterConditionButton(doc, caption) {
    const dialog = findIssFilterCreateDialog(doc || document);
    return dialog ? findUniqueIssButtonByCaption(doc || document, caption, 'tbutton', dialog) : null;
  }

  function findIssFilterLogicalConnectorButton(doc, caption) {
    const dialog = findIssFilterCreateDialog(doc || document);
    if (!dialog) return null;
    const clearButton = findUniqueIssButtonByCaption(doc || document, 'Limpar Filtro', 'tbutton', dialog);
    if (!clearButton) return null;
    let toolbar = null;
    try { toolbar = clearButton.parentElement; } catch (_) {}
    if (!toolbar) return null;
    return findUniqueIssButtonByCaption(doc || document, caption, 'tbutton', toolbar);
  }

  function countIssFilterButtonsByCaption(doc, caption) {
    const dialog = findIssFilterCreateDialog(doc || document);
    if (!dialog) return 0;
    const wanted = normalizeIssNavigationLabel(caption, false);
    const roots = collectRoots(dialog);
    const seen = new Set();
    let count = 0;
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('wa-button')); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node) || !isElementActive(node)) continue;
        seen.add(node);
        let advpl = '';
        let nodeCaption = '';
        try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
        try { nodeCaption = node.getAttribute && node.getAttribute('caption') || ''; } catch (_) {}
        if (advpl === 'tbutton' && normalizeIssNavigationLabel(nodeCaption, false) === wanted) count += 1;
      }
    }
    return count;
  }

  function findIssFilterApplyButton(doc) {
    return findUniqueIssButtonByCaption(doc || document, 'Aplicar filtros selecionados', 'tbrowsebutton');
  }

  function findIssSavedFilterCheckbox(doc, caption) {
    const wanted = normalizeIssNavigationLabel(caption, false);
    const matches = listIssActiveNodes(doc || document, (node) => {
      if (String(node.tagName || '').toUpperCase() !== 'WA-CHECKBOX') return false;
      let nodeCaption = '';
      try { nodeCaption = node.getAttribute && node.getAttribute('caption') || ''; } catch (_) {}
      return normalizeIssNavigationLabel(nodeCaption, false) === wanted;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function isIssCheckboxChecked(control) {
    if (!control) return false;
    const candidates = [control];
    try {
      if (control.shadowRoot) {
        let internals = [];
        try {
          internals = Array.from(control.shadowRoot.querySelectorAll('input,[role="checkbox"]'));
        } catch (_) {}
        if (!internals.length) {
          try {
            const fallback = control.shadowRoot.querySelector('input,[role="checkbox"]');
            if (fallback) internals = [fallback];
          } catch (_) {}
        }
        for (const node of internals) if (node && !candidates.includes(node)) candidates.push(node);
      }
    } catch (_) {}

    for (const candidate of candidates) {
      if (!candidate) continue;
      try { if (candidate.checked === true) return true; } catch (_) {}
      try {
        if (candidate.getAttribute && String(candidate.getAttribute('aria-checked') || '').toLowerCase() === 'true') return true;
      } catch (_) {}
      try { if (candidate.matches && candidate.matches(':checked')) return true; } catch (_) {}
    }
    return false;
  }

  function shouldProceedAfterIssFilterSelectionClick(state) {
    const info = state && typeof state === 'object' ? state : {};
    return info.executed === true && info.observedChecked === true;
  }

  async function activateIssSavedFilterCheckbox(control, options) {
    const opts = options || {};
    const strategy = String(opts.strategy || 'native').toLowerCase();
    const onTrustedClick = typeof opts.onTrustedClick === 'function' ? opts.onTrustedClick : null;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    if (!control || isControlLocked(control)) return false;
    if (isIssCheckboxChecked(control)) return true;

    const native = getNativeActionTarget(control);
    if (!native || isControlLocked(native)) return false;
    try {
      if (typeof native.focus === 'function') {
        try { native.focus({ preventScroll: true }); } catch (_) { try { native.focus(); } catch (_) {} }
      }
    } catch (_) {}

    if (strategy === 'native') {
      let executed = false;
      try {
        if (typeof native.click === 'function') {
          native.click();
          executed = true;
        }
      } catch (_) { executed = false; }
      emitDiagnostic(onLog, 'ISS_CORRETORA_FILTER_SELECTION_NATIVE', 'Clique nativo no input do checkbox enviado; o estado marcado será validado antes de qualquer Apply.', {
        executed,
        checked: isIssCheckboxChecked(control),
        target: describeActionTarget(control)
      });
      return executed;
    }

    if (strategy === 'trusted') {
      if (!onTrustedClick) return false;
      const executed = !!(await Promise.resolve(onTrustedClick(control)));
      emitDiagnostic(onLog, 'ISS_CORRETORA_FILTER_SELECTION_TRUSTED', 'Fallback de clique confiável no checkbox enviado após confirmação de que ele continuava desmarcado.', {
        executed,
        checked: isIssCheckboxChecked(control),
        target: describeActionTarget(control)
      });
      return executed;
    }

    return false;
  }

  function findIssFilterBanner(doc) {
    const candidates = listIssActiveNodes(doc || document, (node) => String(node.tagName || '').toUpperCase() === 'WA-BUTTON');
    return findUniqueIssNavigationByPriority(candidates, ['caption', 'title', 'text'], ['Há filtros aplicados ao browse'], false);
  }

  function normalizeIssFilterTextValue(value) {
    return String(value == null ? '' : value).trim();
  }

  function readIssFilterTextControl(control) {
    const inner = getInnerEditable(control);
    if (!inner) return '';
    try { return normalizeIssFilterTextValue(inner.value); } catch (_) { return ''; }
  }

  function focusIssFilterTextControl(control, options) {
    const inner = getInnerEditable(control);
    if (!inner || isControlLocked(inner)) return false;
    const opts = options || {};
    const selectAll = opts.selectAll !== false;
    try {
      if (typeof inner.focus === 'function') {
        try { inner.focus({ preventScroll: true }); } catch (_) { try { inner.focus(); } catch (_) {} }
      }
      if (selectAll && typeof inner.select === 'function') {
        try { inner.select(); } catch (_) {}
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function dispatchIssFilterTextControl(control, value, options) {
    const opts = options || {};
    const target = String(value == null ? '' : value);
    const writeValue = String(opts.writeValue == null ? target : opts.writeValue);
    const signal = opts.signal;
    const onTrustedClick = typeof opts.onTrustedClick === 'function' ? opts.onTrustedClick : null;
    const onTrustedText = typeof opts.onTrustedText === 'function' ? opts.onTrustedText : null;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : null;
    const current = readIssFilterTextControl(control);
    if (current === target) return true;
    if (!onTrustedText) return false;

    emitDiagnostic(onLog, 'ISS_CORRETORA_TEXT_BEFORE', 'Valor atual do campo antes da escrita confiável.', {
      target: describeActionTarget(control),
      currentValue: current,
      targetValue: target
    });

    const focusedBefore = focusIssFilterTextControl(control);
    if (onTrustedClick) {
      const clicked = await Promise.resolve(onTrustedClick(control));
      if (!clicked && !focusedBefore) return false;
      await abortableSleep(60, signal);
    }
    if (!focusIssFilterTextControl(control) && !focusedBefore) return false;
    emitDiagnostic(onLog, 'ISS_CORRETORA_TEXT_WRITE', 'Enviando texto confiável para o input interno selecionado.', {
      target: describeActionTarget(control),
      targetValue: target,
      writeValue
    });
    const written = !!(await Promise.resolve(onTrustedText(writeValue)));
    emitDiagnostic(onLog, 'ISS_CORRETORA_TEXT_AFTER', 'Valor do campo imediatamente após a escrita confiável.', {
      target: describeActionTarget(control),
      writeAccepted: written,
      currentValue: readIssFilterTextControl(control),
      targetValue: target
    });
    return written;
  }


  async function dispatchIssFilterDateControl(control, value, options) {
    const opts = options || {};
    const target = String(value == null ? '' : value);
    const digits = target.replace(/\D/g, '');
    const signal = opts.signal;
    const onTrustedClick = typeof opts.onTrustedClick === 'function' ? opts.onTrustedClick : null;
    const onTrustedKey = typeof opts.onTrustedKey === 'function' ? opts.onTrustedKey : null;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : null;
    if (readIssFilterTextControl(control) === target) return true;
    if (!onTrustedKey || digits.length !== 8) return false;

    emitDiagnostic(onLog, 'ISS_CORRETORA_DATE_BEFORE', 'Valor atual do campo de data antes da digitação por teclas confiáveis.', {
      target: describeActionTarget(control),
      currentValue: readIssFilterTextControl(control),
      targetValue: target
    });

    if (onTrustedClick) {
      const clicked = await Promise.resolve(onTrustedClick(control));
      if (!clicked && !focusIssFilterTextControl(control)) return false;
      await abortableSleep(60, signal);
    }
    if (!focusIssFilterTextControl(control)) return false;

    for (const digit of digits) {
      throwIfAborted(signal);
      if (!focusIssFilterTextControl(control, { selectAll: false })) return false;
      const sent = !!(await Promise.resolve(onTrustedKey(digit)));
      if (!sent) return false;
      await abortableSleep(20, signal);
    }

    throwIfAborted(signal);
    if (!focusIssFilterTextControl(control, { selectAll: false })) return false;
    const committed = !!(await Promise.resolve(onTrustedKey('Tab')));
    if (!committed) return false;

    emitDiagnostic(onLog, 'ISS_CORRETORA_DATE_AFTER', 'Sequência de teclas da data enviada ao Protheus e campo confirmado por Tab.', {
      target: describeActionTarget(control),
      currentValue: readIssFilterTextControl(control),
      targetValue: target,
      keyCount: digits.length,
      commitKey: 'Tab'
    });
    return true;
  }

  async function fillIssFilterTextControl(control, value, options) {
    const opts = options || {};
    const target = String(value == null ? '' : value);
    if (readIssFilterTextControl(control) === target) return true;
    if (!await dispatchIssFilterTextControl(control, target, opts)) return false;
    return waitForCondition(() => readIssFilterTextControl(control) === target, 2500, 60, opts.signal);
  }

  function formatIssDayTenOfCurrentMonth(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return '10/' + month + '/' + year;
  }

  function formatIssFilterConditionCaption(rule) {
    const item = rule || {};
    const field = String(item.field == null ? '' : item.field).trim();
    const operator = String(item.operator == null ? '' : item.operator).trim();
    const rawValue = String(item.value == null ? '' : item.value);
    const value = rawValue.replace(/'/g, "''");
    if (!field || !operator) return '';
    if (String(item.valueType || '').toLowerCase() === 'date') return field + ' ' + operator + ' ' + rawValue;
    return field + ' ' + operator + " '" + value + "'";
  }

  function getIssGridColumnValues(doc, headerLabel) {
    const wanted = normalizeText(headerLabel);
    const grids = listIssActiveNodes(doc || document, (node) => {
      if (String(node.tagName || '').toUpperCase() !== 'WA-TGRID') return false;
      let advpl = '';
      try { advpl = String(node.getAttribute && node.getAttribute('data-advpl') || '').toLowerCase(); } catch (_) {}
      return !advpl || advpl === 'tgrid';
    });
    const matching = [];
    for (const grid of grids) {
      let root = null;
      try { root = grid.shadowRoot; } catch (_) {}
      if (!root) continue;
      let headers = [];
      try { headers = Array.from(root.querySelectorAll('thead th')); } catch (_) {}
      const index = headers.findIndex((th) => {
        let text = '';
        try { text = th.innerText || th.textContent || ''; } catch (_) {}
        return normalizeText(text) === wanted;
      });
      if (index < 0) continue;
      matching.push({ grid, root, index });
    }
    if (matching.length !== 1) return [];
    let rows = [];
    try { rows = Array.from(matching[0].root.querySelectorAll('tbody tr')); } catch (_) {}
    return rows.map((row) => {
      let cells = [];
      try { cells = Array.from(row.querySelectorAll('td')); } catch (_) {}
      const cell = cells[matching[0].index];
      try { return String(cell && (cell.innerText || cell.textContent) || '').trim(); } catch (_) { return ''; }
    });
  }

  function isIssGridFilteredByNatureza(doc, expectedValue) {
    const values = getIssGridColumnValues(doc || document, 'Natureza');
    const wanted = normalizeText(expectedValue);
    return values.length > 0 && values.every((value) => normalizeText(value) === wanted);
  }

  function isIssGridFilteredByRules(doc, rules) {
    const sourceRules = Array.isArray(rules) ? rules : [];
    if (!sourceRules.length) return false;
    return sourceRules.every((rule) => {
      const field = String(rule && rule.field || '').trim();
      const expected = String(rule && rule.value == null ? '' : rule.value).trim();
      if (!field) return false;
      const values = getIssGridColumnValues(doc || document, field);
      const wanted = normalizeText(expected);
      return values.length > 0 && values.every((value) => normalizeText(value) === wanted);
    });
  }

  async function runIssCorretoraDynamicFilter(doc, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const onTrustedClick = typeof opts.onTrustedClick === 'function' ? opts.onTrustedClick : null;
    const onTrustedText = typeof opts.onTrustedText === 'function' ? opts.onTrustedText : null;
    const onTrustedKey = typeof opts.onTrustedKey === 'function' ? opts.onTrustedKey : null;
    const rules = Array.isArray(opts.rules) ? opts.rules : [];
    if (!rules.length) throw new Error('ISS Corretora: ao menos uma regra é necessária para criação dinâmica do filtro.');
    if (!onTrustedClick || !onTrustedText || (rules.some((rule) => String(rule && rule.valueType || '').toLowerCase() === 'date') && !onTrustedKey)) throw new Error('ISS Corretora: interação confiável não foi disponibilizada para criar o filtro.');

    const conditionCaptions = rules.map(formatIssFilterConditionCaption);
    if (conditionCaptions.some((caption) => !caption)) throw new Error('ISS Corretora: regra de filtro inválida.');
    const filterName = String(opts.filterName || ('POS AUTO ISS ' + Date.now())).trim();
    if (!filterName) throw new Error('ISS Corretora: nome automático do filtro inválido.');

    const trustedClick = async (target) => !!(await Promise.resolve(onTrustedClick(target)));

    onStatus('ISS CORRETORA — aguardando Contas a Pagar carregar...');
    const accountsPayableReady = await waitForIssCorretoraAccountsPayableReady(source, {
      signal,
      timeoutMs: 60000,
      pollMs: 100
    });
    if (!accountsPayableReady.ready) {
      emitDiagnostic(onLog, 'ISS_CORRETORA_ACCOUNTS_PAYABLE_NOT_READY', 'Contas a Pagar não concluiu a prontidão semântica dentro da trava de segurança.', accountsPayableReady);
      throw new Error(
        'ISS Corretora: Contas a Pagar não ficou pronta ' +
        '(tela=' + (accountsPayableReady.screenReady ? 'sim' : 'não') +
        ', grade=' + (accountsPayableReady.gridReady ? 'sim' : 'não') +
        ', Filtrar=' + (accountsPayableReady.filterReady ? 'sim' : 'não') + ').'
      );
    }
    emitDiagnostic(onLog, 'ISS_CORRETORA_ACCOUNTS_PAYABLE_READY', 'Contas a Pagar ficou pronta por marcadores semânticos antes do filtro.', accountsPayableReady);

    if (findIssFilterBanner(source)) {
      onStatus('ISS CORRETORA — removendo filtros anteriores do browse...');
      const cleared = await performVerifiedAction(source, {
        label: 'ISS Corretora — Remover filtros anteriores',
        findTarget: findIssCorretoraRemoveAppliedFiltersButton,
        execute: trustedClick,
        isSuccess: (currentDoc) => !findIssFilterBanner(currentDoc),
        inspectRetryState: (currentDoc) => {
          if (!findIssFilterBanner(currentDoc)) return { state: 'success', reason: 'banner removido' };
          if (findIssCorretoraRemoveAppliedFiltersButton(currentDoc)) return { state: 'previous', reason: 'banner e Remover continuam disponíveis' };
          return { state: 'processing', reason: 'banner permanece, botão Remover está em transição' };
        },
        retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
        maxAttempts: 2,
        effectTimeoutMs: 10000,
        processingTimeoutMs: 10000,
        effectPollMs: 100,
        onStatus,
        onLog,
        signal
      });
      if (!cleared) throw new Error('ISS Corretora: o Protheus não confirmou a remoção dos filtros anteriores.');
    }

    onStatus('ISS CORRETORA — abrindo gerenciador de filtros...');
    const managerCondition = (currentDoc) => !!findIssFilterManagerMarker(currentDoc) && !!findIssFilterManagerCreateButton(currentDoc);
    const managerReady = await performVerifiedAction(source, {
      label: 'ISS Corretora — Abrir Gerenciador de Filtros',
      findTarget: findIssCorretoraFilterButton,
      execute: trustedClick,
      isSuccess: managerCondition,
      inspectRetryState: (currentDoc) => {
        if (managerCondition(currentDoc)) return { state: 'success', reason: 'Gerenciador de Filtros visível' };
        if (findIssFilterManagerMarker(currentDoc)) return { state: 'processing', reason: 'Gerenciador apareceu parcialmente' };
        if (findIssCorretoraFilterButton(currentDoc)) return { state: 'previous', reason: 'Filtrar continua disponível e o gerenciador não apareceu' };
        return { state: 'processing', reason: 'Filtrar saiu de cena e o gerenciador ainda está carregando' };
      },
      retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
      maxAttempts: 2,
      effectTimeoutMs: 5000,
      processingTimeoutMs: 8000,
      effectPollMs: 100,
      retryDelayMs: 250,
      onStatus,
      onLog,
      signal
    });
    if (!managerReady) throw new Error('ISS Corretora: Gerenciador de Filtros não ficou disponível após retry seguro.');

    onStatus('ISS CORRETORA — criando filtro pelo código...');
    const createCondition = (currentDoc) => {
      return !!findIssFilterNameControl(currentDoc) && !!findIssFilterFieldControl(currentDoc) && !!findIssFilterOperatorControl(currentDoc) &&
        !!findIssFilterExpressionControl(currentDoc) && !!findIssFilterAddButton(currentDoc) && !!findIssFilterSaveButton(currentDoc);
    };
    const createReady = await performVerifiedAction(source, {
      label: 'ISS Corretora — Abrir Criar Filtro',
      findTarget: findIssFilterManagerCreateButton,
      execute: trustedClick,
      isSuccess: createCondition,
      inspectRetryState: (currentDoc) => {
        if (createCondition(currentDoc)) return { state: 'success', reason: 'construtor completo' };
        if (findIssFilterCreateDialogMarker(currentDoc) || findIssFilterNameControl(currentDoc) || findIssFilterFieldControl(currentDoc)) {
          return { state: 'processing', reason: 'construtor apareceu parcialmente' };
        }
        if (findIssFilterManagerMarker(currentDoc) && findIssFilterManagerCreateButton(currentDoc)) {
          return { state: 'previous', reason: 'Gerenciador continua íntegro e Criar Filtro permanece disponível' };
        }
        return { state: 'processing', reason: 'transição entre gerenciador e construtor' };
      },
      retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
      maxAttempts: 2,
      effectTimeoutMs: 5000,
      processingTimeoutMs: 8000,
      effectPollMs: 80,
      retryDelayMs: 250,
      onStatus,
      onLog,
      signal
    });
    if (!createReady) throw new Error('ISS Corretora: construtor Criar Filtro não ficou pronto após retry seguro.');

    const nameReady = await performVerifiedAction(source, {
      label: 'ISS Corretora — Preencher nome do filtro',
      findTarget: findIssFilterNameControl,
      execute: (control) => dispatchIssFilterTextControl(control, filterName, { signal, onTrustedClick, onTrustedText, onLog }),
      isSuccess: (currentDoc) => readIssFilterTextControl(findIssFilterNameControl(currentDoc)) === filterName,
      inspectRetryState: (currentDoc) => {
        const control = findIssFilterNameControl(currentDoc);
        if (!control) return { state: 'processing', reason: 'controle do nome foi recriado/está indisponível' };
        const value = readIssFilterTextControl(control);
        if (value === filterName) return { state: 'success', reason: 'nome confirmado' };
        if (value === '') return { state: 'previous', reason: 'campo continua vazio' };
        return { state: 'ambiguous', reason: 'campo contém valor inesperado: ' + value };
      },
      retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
      maxAttempts: 2,
      effectTimeoutMs: 2500,
      processingTimeoutMs: 2500,
      effectPollMs: 60,
      onStatus,
      onLog,
      signal
    });
    if (!nameReady) throw new Error('ISS Corretora: não foi possível preencher e confirmar o nome automático do filtro.');

    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
      const rule = rules[ruleIndex];
      const conditionCaption = conditionCaptions[ruleIndex];

      if (ruleIndex > 0) {
        const connectorCountBefore = countIssFilterButtonsByCaption(source, 'e');
        const joinedReady = await performVerifiedAction(source, {
          label: 'ISS Corretora — Conectar condições com e',
          findTarget: (currentDoc) => findIssFilterLogicalConnectorButton(currentDoc, 'e'),
          execute: trustedClick,
          isSuccess: (currentDoc) => countIssFilterButtonsByCaption(currentDoc, 'e') > connectorCountBefore,
          inspectRetryState: (currentDoc) => {
            if (countIssFilterButtonsByCaption(currentDoc, 'e') > connectorCountBefore) return { state: 'success', reason: 'token lógico e criado' };
            if (findIssFilterCreateDialog(currentDoc) && findIssFilterLogicalConnectorButton(currentDoc, 'e')) {
              return { state: 'processing', reason: 'construtor permanece aberto após o clique único no conector e' };
            }
            return { state: 'ambiguous', reason: 'estado após inserir o conector e não é conclusivo' };
          },
          retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.NEVER_BLIND_RETRY,
          maxAttempts: 1,
          effectTimeoutMs: 4000,
          processingTimeoutMs: 4000,
          effectPollMs: 80,
          onStatus,
          onLog,
          signal
        });
        if (!joinedReady) throw new Error('ISS Corretora: o conector lógico e não foi confirmado pelo Protheus.');
        emitDiagnostic(onLog, 'ISS_CORRETORA_FILTER_AND_READY', 'Conector lógico e inserido entre as condições do filtro.', {
          filterName, ruleIndex, connectorCountBefore, connectorCountAfter: countIssFilterButtonsByCaption(source, 'e')
        });
      }

      const fieldReady = await performVerifiedAction(source, {
        label: 'ISS Corretora — Selecionar campo ' + String(rule.field || ''),
        findTarget: findIssFilterFieldControl,
        execute: (control) => setIssFilterComboboxByText(control, rule.field),
        isSuccess: (currentDoc) => normalizeText(readIssFilterComboboxText(findIssFilterFieldControl(currentDoc))) === normalizeText(rule.field),
        inspectRetryState: (currentDoc) => {
          const control = findIssFilterFieldControl(currentDoc);
          if (!control) return { state: 'processing', reason: 'combobox Campo indisponível durante atualização' };
          return normalizeText(readIssFilterComboboxText(control)) === normalizeText(rule.field)
            ? { state: 'success', reason: 'campo confirmado' }
            : { state: 'previous', reason: 'campo ainda não corresponde ao esperado' };
        },
        retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
        maxAttempts: 2,
        effectTimeoutMs: 1500,
        processingTimeoutMs: 1200,
        effectPollMs: 60,
        onStatus,
        onLog,
        signal
      });
      if (!fieldReady) throw new Error('ISS Corretora: campo do filtro não pôde ser selecionado semanticamente: ' + String(rule.field || ''));

      const operatorReady = await performVerifiedAction(source, {
        label: 'ISS Corretora — Selecionar operador ' + String(rule.operator || ''),
        findTarget: findIssFilterOperatorControl,
        execute: (control) => setIssFilterComboboxByText(control, rule.operator),
        isSuccess: (currentDoc) => normalizeText(readIssFilterComboboxText(findIssFilterOperatorControl(currentDoc))) === normalizeText(rule.operator),
        inspectRetryState: (currentDoc) => {
          const control = findIssFilterOperatorControl(currentDoc);
          if (!control) return { state: 'processing', reason: 'combobox Operador indisponível durante atualização' };
          return normalizeText(readIssFilterComboboxText(control)) === normalizeText(rule.operator)
            ? { state: 'success', reason: 'operador confirmado' }
            : { state: 'previous', reason: 'operador ainda não corresponde ao esperado' };
        },
        retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
        maxAttempts: 2,
        effectTimeoutMs: 1500,
        processingTimeoutMs: 1200,
        effectPollMs: 60,
        onStatus,
        onLog,
        signal
      });
      if (!operatorReady) throw new Error('ISS Corretora: operador do filtro não pôde ser selecionado semanticamente: ' + String(rule.operator || ''));

      const expectedExpression = String(rule.value == null ? '' : rule.value);
      const isDateRule = String(rule.valueType || '').toLowerCase() === 'date';
      const expressionReady = await performVerifiedAction(source, {
        label: 'ISS Corretora — Preencher expressão do filtro',
        findTarget: findIssFilterExpressionControl,
        execute: (control) => isDateRule
          ? dispatchIssFilterDateControl(control, expectedExpression, { signal, onTrustedClick, onTrustedKey, onLog })
          : dispatchIssFilterTextControl(control, expectedExpression, { signal, onTrustedClick, onTrustedText, onLog }),
        isSuccess: (currentDoc) => readIssFilterTextControl(findIssFilterExpressionControl(currentDoc)) === expectedExpression,
        inspectRetryState: (currentDoc) => {
          const control = findIssFilterExpressionControl(currentDoc);
          if (!control) return { state: 'processing', reason: 'controle Expressão foi recriado/está indisponível' };
          const value = readIssFilterTextControl(control);
          if (value === expectedExpression) return { state: 'success', reason: 'expressão confirmada' };
          if (value === '' || (String(rule.valueType || '').toLowerCase() === 'date' && /^\/\s*\/$/.test(value.replace(/\s+/g, '')))) {
            return { state: 'previous', reason: 'Expressão continua vazia' };
          }
          return { state: 'ambiguous', reason: 'Expressão contém valor inesperado: ' + value };
        },
        retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
        maxAttempts: 2,
        effectTimeoutMs: 2500,
        processingTimeoutMs: 2500,
        effectPollMs: 60,
        onStatus,
        onLog,
        signal
      });
      if (!expressionReady) throw new Error('ISS Corretora: não foi possível preencher e confirmar a expressão do filtro.');

      const conditionReady = await performVerifiedAction(source, {
        label: 'ISS Corretora — Adicionar condição',
        findTarget: findIssFilterAddButton,
        execute: trustedClick,
        isSuccess: (currentDoc) => !!findIssFilterConditionButton(currentDoc, conditionCaption),
        inspectRetryState: (currentDoc) => {
          if (findIssFilterConditionButton(currentDoc, conditionCaption)) return { state: 'success', reason: 'chip da condição criado' };
          if (findIssFilterCreateDialog(currentDoc) && findIssFilterAddButton(currentDoc)) return { state: 'processing', reason: 'construtor continua aberto após Adicionar' };
          return { state: 'ambiguous', reason: 'estado após Adicionar não é conclusivo' };
        },
        retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.NEVER_BLIND_RETRY,
        maxAttempts: 2,
        effectTimeoutMs: 6000,
        processingTimeoutMs: 6000,
        effectPollMs: 80,
        onStatus,
        onLog,
        signal
      });
      if (!conditionReady) throw new Error('ISS Corretora: a condição criada não foi confirmada pelo Protheus: ' + conditionCaption);

      emitDiagnostic(onLog, 'ISS_CORRETORA_FILTER_RULE_READY', 'Condição do filtro criada pelo Protheus.', {
        filterName, ruleIndex, field: String(rule.field || ''), operator: String(rule.operator || ''), value: expectedExpression, valueType: String(rule.valueType || ''), conditionCaption
      });
    }

    const savedReady = await performVerifiedAction(source, {
      label: 'ISS Corretora — Salvar filtro',
      findTarget: findIssFilterSaveButton,
      execute: trustedClick,
      isSuccess: (currentDoc) => !findIssFilterCreateDialog(currentDoc) && !!findIssFilterManagerMarker(currentDoc) && !!findIssSavedFilterCheckbox(currentDoc, filterName),
      inspectRetryState: (currentDoc) => {
        if (!findIssFilterCreateDialog(currentDoc) && findIssFilterManagerMarker(currentDoc) && findIssSavedFilterCheckbox(currentDoc, filterName)) {
          return { state: 'success', reason: 'filtro salvo no gerenciador' };
        }
        if (findIssFilterCreateDialog(currentDoc)) return { state: 'processing', reason: 'diálogo de criação ainda está aberto' };
        if (findIssFilterManagerMarker(currentDoc)) return { state: 'processing', reason: 'gerenciador voltou, aguardando filtro salvo aparecer' };
        return { state: 'ambiguous', reason: 'estado após Salvar não é conclusivo' };
      },
      retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.NEVER_BLIND_RETRY,
      maxAttempts: 2,
      effectTimeoutMs: 10000,
      processingTimeoutMs: 10000,
      effectPollMs: 80,
      onStatus,
      onLog,
      signal
    });
    if (!savedReady) throw new Error('ISS Corretora: filtro automático não apareceu no Gerenciador de Filtros após Salvar; o clique não foi repetido cegamente.');

    let filterSelectionObserved = false;
    const selectionReady = await performVerifiedAction(source, {
      label: 'ISS Corretora — Selecionar filtro salvo',
      findTarget: (currentDoc) => findIssSavedFilterCheckbox(currentDoc, filterName),
      execute: async (target, context) => {
        const before = isIssCheckboxChecked(target);
        const strategy = context && context.attempt > 1 ? 'trusted' : 'native';
        const executed = await activateIssSavedFilterCheckbox(target, { strategy, onTrustedClick, onLog });
        const after = isIssCheckboxChecked(target);
        if (after) filterSelectionObserved = true;
        emitDiagnostic(onLog, 'ISS_CORRETORA_FILTER_SELECTION_STATE', 'Tentativa de seleção enviada; Aplicar só será liberado depois que o checkbox estiver realmente marcado.', {
          strategy,
          before,
          after,
          executed,
          filterSelectionObserved,
          validationDeferredToApply: false,
          target: describeActionTarget(target)
        });
        return executed;
      },
      isSuccess: (currentDoc) => {
        const saved = findIssSavedFilterCheckbox(currentDoc, filterName);
        const checked = !!saved && isIssCheckboxChecked(saved);
        if (checked) filterSelectionObserved = true;
        return checked;
      },
      inspectRetryState: (currentDoc) => {
        const saved = findIssSavedFilterCheckbox(currentDoc, filterName);
        if (saved && isIssCheckboxChecked(saved)) return { state: 'success', reason: 'checkbox do filtro confirmado como marcado' };
        if (findIssFilterManagerMarker(currentDoc) && findIssFilterApplyButton(currentDoc) && saved) {
          return { state: 'previous', reason: 'checkbox do filtro continua desmarcado; é seguro tentar outra estratégia sem risco de desmarcar' };
        }
        return { state: 'processing', reason: 'gerenciador está atualizando a seleção do filtro' };
      },
      retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
      maxAttempts: 2,
      effectTimeoutMs: 900,
      processingTimeoutMs: 1200,
      effectPollMs: 40,
      retryDelayMs: 120,
      successStabilityMs: 120,
      onStatus,
      onLog,
      signal
    });
    if (!selectionReady || !filterSelectionObserved) {
      throw new Error('ISS Corretora: o filtro automático foi salvo, mas o checkbox não ficou marcado; Aplicar não será acionado sem seleção confirmada.');
    }

    onStatus('ISS CORRETORA — aplicando filtro criado pelo código...');
    const applied = await performVerifiedAction(source, {
      label: 'ISS Corretora — Aplicar filtros selecionados',
      findTarget: findIssFilterApplyButton,
      execute: trustedClick,
      isSuccess: (currentDoc) => !!findIssFilterBanner(currentDoc) && isIssGridFilteredByRules(currentDoc, rules),
      inspectRetryState: (currentDoc) => {
        if (findIssFilterBanner(currentDoc) && isIssGridFilteredByRules(currentDoc, rules)) {
          return { state: 'success', reason: 'banner e grade confirmados' };
        }
        if (findIssFilterBanner(currentDoc)) return { state: 'processing', reason: 'banner apareceu; grade ainda está atualizando' };
        const saved = findIssSavedFilterCheckbox(currentDoc, filterName);
        if (findIssFilterManagerMarker(currentDoc) && findIssFilterApplyButton(currentDoc) && saved) {
          return { state: 'previous', reason: 'gerenciador ainda está aberto após Apply; é seguro repetir apenas o Apply sem tocar novamente na seleção' };
        }
        return { state: 'processing', reason: 'gerenciador fechou e o browse ainda está aplicando o filtro' };
      },
      retryPolicy: VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY,
      maxAttempts: 2,
      effectTimeoutMs: 12000,
      processingTimeoutMs: 20000,
      effectPollMs: 100,
      retryDelayMs: 300,
      onStatus,
      onLog,
      signal
    });
    if (!applied) throw new Error('ISS Corretora: o filtro não foi confirmado pelo banner e pela grade após retry seguro.');

    const values = getIssGridColumnValues(source, 'Natureza');
    emitDiagnostic(onLog, 'ISS_CORRETORA_FILTER_APPLIED', 'Filtro dinâmico criado e aplicado; grade validada em todas as regras.', {
      filterName, conditionCaptions, renderedRows: values.length, rules: rules.map((rule) => ({ field: String(rule.field || ''), operator: String(rule.operator || ''), value: String(rule.value == null ? '' : rule.value), valueType: String(rule.valueType || '') }))
    });
    onStatus('ISS CORRETORA — filtro aplicado e validado (' + values.length + ' linha(s) visíveis).');
    return { ok: true, filterName, conditionCaption: conditionCaptions[0], conditionCaptions, renderedRows: values.length };
  }

  function findSoomarUpdatesButton(doc) {
    return findUniqueSoomarSemanticElement(doc || document, 'wa-menu-item[data-advpl="tmenuitem"],wa-menu-item', 'Atualizações');
  }

  function findSoomarUpdatesOption(doc) {
    return findUniqueSoomarSemanticElement(doc || document, 'wa-text-view[data-advpl="tsay"],wa-text-view', 'Prest. Contas/reembolso');
  }

  function isSoomarUpdatesMenuReady(doc) {
    // O menu pode fechar imediatamente depois de navegar. O efeito confiável
    // da ação é a opção semanticamente correta aparecer na página seguinte.
    return !!findSoomarUpdatesOption(doc || document);
  }

  function findSoomarExpenseEntryOption(doc) {
    return findActiveElementByExactId(doc || document, 'COMP4561', '');
  }

  function findSoomarCollaboratorCodeControl(doc) {
    return findActiveElementByExactId(doc || document, 'COMP6021', '');
  }

  function getSoomarCollaboratorEditable(control) {
    return getSoomarParameterEditable(control);
  }

  function readSoomarCollaboratorCode(control) {
    if (!control || String(control.id || '') !== 'COMP6021') return '';
    const inner = getSoomarCollaboratorEditable(control);
    if (!inner) return '';
    try { return String(inner.value == null ? '' : inner.value).trim(); } catch (_) { return ''; }
  }

  function setSoomarCollaboratorCode(control, value) {
    if (!control || String(control.id || '') !== 'COMP6021' || isControlLocked(control)) return false;
    const inner = getSoomarCollaboratorEditable(control);
    if (!inner || isControlLocked(inner)) return false;
    const text = String(value == null ? '' : value).trim();
    if (!/^\d{6}$/.test(text)) return false;

    try { if (typeof inner.focus === 'function') inner.focus(); } catch (_) {}
    try { if (typeof inner.select === 'function') inner.select(); } catch (_) {}
    if (!setNativeEditableValue(inner, '')) return false;
    dispatchSyntheticEvent(inner, 'input', { data: '', inputType: 'deleteContentBackward' });

    let current = '';
    for (const char of text) {
      dispatchSyntheticEvent(inner, 'keydown', { key: char, code: 'Digit' + char, data: char });
      dispatchSyntheticEvent(inner, 'beforeinput', { data: char, inputType: 'insertText' });
      current += char;
      if (!setNativeEditableValue(inner, current)) return false;
      dispatchSyntheticEvent(inner, 'input', { data: char, inputType: 'insertText' });
      dispatchSyntheticEvent(inner, 'keyup', { key: char, code: 'Digit' + char, data: char });
    }
    dispatchSyntheticEvent(inner, 'change');
    try { if (typeof inner.blur === 'function') inner.blur(); } catch (_) {}
    return readSoomarCollaboratorCode(control) === text;
  }

  async function fillSoomarCollaboratorCodeReliably(doc, value, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const stepDelayMs = normalizeSoomarStepDelayMs(opts.stepDelayMs);
    const text = String(value == null ? '' : value).trim();

    for (let attempt = 1; attempt <= 6; attempt++) {
      throwIfAborted(signal);
      const control = findSoomarCollaboratorCodeControl(source);
      if (control && setSoomarCollaboratorCode(control, text)) {
        await applySoomarStepDelay(stepDelayMs, signal);
        const verified = findSoomarCollaboratorCodeControl(source);
        if (verified && readSoomarCollaboratorCode(verified) === text) {
          emitDiagnostic(onLog, 'SOOMAR_COLLABORATOR_SET', 'Código do colaborador Soomar preenchido e validado.', { value: text, attempt });
          return true;
        }
      }
      await applySoomarStepDelay(stepDelayMs, signal);
    }
    return false;
  }

  async function runSoomarPostParameterNavigation(doc, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const onTrustedClick = typeof opts.onTrustedClick === 'function' ? opts.onTrustedClick : null;
    const stepDelayMs = normalizeSoomarStepDelayMs(opts.stepDelayMs);
    const collaboratorCode = String(opts.collaboratorCode || '000011').trim();

    const trustedThenFallback = async function (target) {
      throwIfAborted(signal);
      if (onTrustedClick) {
        const trusted = await Promise.resolve(onTrustedClick(target));
        emitDiagnostic(onLog, 'SOOMAR_TRUSTED_CLICK', 'Clique confiável via Edge/CDP executado na navegação Soomar.', {
          trusted: !!trusted,
          target: describeActionTarget(target),
          semanticLabels: getSoomarSemanticLabels(target)
        });
        if (trusted) return true;
      }
      const fallback = dispatchWaButtonGesture(target) || clickElement(target);
      emitDiagnostic(onLog, 'SOOMAR_CLICK_FALLBACK', 'Fallback sintético usado na navegação Soomar.', {
        fallback: !!fallback,
        target: describeActionTarget(target),
        semanticLabels: getSoomarSemanticLabels(target)
      });
      return fallback;
    };

    throwIfAborted(signal);
    onStatus('SOOMAR — aguardando 2 segundos antes de abrir Atualizações...');
    await abortableSleep(2000, signal);

    emitDiagnostic(onLog, 'SOOMAR_NAV_CANDIDATES', 'Candidatos de menu antes de abrir Atualizações.', {
      menuItems: listSoomarNavigationCandidates(source, 'wa-menu-item[data-advpl="tmenuitem"],wa-menu-item')
    });
    onStatus('SOOMAR — abrindo Atualizações...');
    const updatesOpened = await performConfirmedClick(source, {
      label: 'Soomar — Atualizações',
      findTarget: findSoomarUpdatesButton,
      isSuccess: isSoomarUpdatesMenuReady,
      triggerTarget: trustedThenFallback,
      onStatus,
      onLog,
      signal,
      stepDelayMs,
      maxAttempts: 2,
      retryDelayMs: stepDelayMs,
      effectTimeoutMs: 4000,
      effectPollMs: 100
    });
    if (!updatesOpened) {
      emitDiagnostic(onLog, 'SOOMAR_NAV_FAIL', 'Atualizações não abriu ou não revelou a opção correta.', {
        menuItems: listSoomarNavigationCandidates(source, 'wa-menu-item[data-advpl="tmenuitem"],wa-menu-item'),
        textViews: listSoomarNavigationCandidates(source, 'wa-text-view[data-advpl="tsay"],wa-text-view')
      });
      throw new Error('Soomar: não foi possível abrir o menu Atualizações e localizar Prest. Contas/reembolso pelo texto.');
    }

    const updatesOption = findSoomarUpdatesOption(source);
    emitDiagnostic(onLog, 'SOOMAR_SEMANTIC_TARGET', 'Opção Prest. Contas/reembolso localizada semanticamente.', {
      target: describeActionTarget(updatesOption),
      semanticLabels: getSoomarSemanticLabels(updatesOption),
      textViews: listSoomarNavigationCandidates(source, 'wa-text-view[data-advpl="tsay"],wa-text-view')
    });
    if (!updatesOption) {
      throw new Error('Soomar: Prest. Contas/reembolso não foi localizado de forma única no menu Atualizações.');
    }

    onStatus('SOOMAR — abrindo Prest. Contas/reembolso...');
    const optionOpened = await performConfirmedClick(source, {
      label: 'Soomar — Prest. Contas/reembolso',
      findTarget: findSoomarUpdatesOption,
      isSuccess: (currentDoc) => !!findSoomarExpenseEntryOption(currentDoc),
      triggerTarget: trustedThenFallback,
      onStatus,
      onLog,
      signal,
      stepDelayMs,
      maxAttempts: 2,
      retryDelayMs: stepDelayMs,
      effectTimeoutMs: 7000,
      effectPollMs: 120
    });
    if (!optionOpened) {
      emitDiagnostic(onLog, 'SOOMAR_NAV_FAIL', 'Prest. Contas/reembolso foi localizado, mas a próxima opção não apareceu.', {
        expected: 'COMP4561',
        selectedTarget: describeActionTarget(findSoomarUpdatesOption(source)),
        textViews: listSoomarNavigationCandidates(source, 'wa-text-view[data-advpl="tsay"],wa-text-view')
      });
      throw new Error('Soomar: Prest. Contas/reembolso foi acionado, mas a opção seguinte COMP4561 não apareceu.');
    }

    onStatus('SOOMAR — abrindo tela de lançamento...');
    const entryOpened = await performConfirmedClick(source, {
      label: 'Soomar — abrir lançamento COMP4561',
      findTarget: findSoomarExpenseEntryOption,
      isSuccess: (currentDoc) => !!findSoomarCollaboratorCodeControl(currentDoc),
      triggerTarget: trustedThenFallback,
      onStatus,
      onLog,
      signal,
      stepDelayMs,
      maxAttempts: 2,
      retryDelayMs: stepDelayMs,
      effectTimeoutMs: 12000,
      effectPollMs: 200
    });
    if (!entryOpened) throw new Error('Soomar: COMP4561 foi acionado, mas a tela com COMP6021 não carregou.');

    const collaboratorControl = await waitForElement(source, findSoomarCollaboratorCodeControl, stepDelayMs, signal);
    if (!collaboratorControl) throw new Error('Soomar: o campo COMP6021 não foi encontrado após carregar a tela de lançamento.');

    onStatus('SOOMAR — preenchendo colaborador ' + collaboratorCode + '...');
    if (!await fillSoomarCollaboratorCodeReliably(source, collaboratorCode, { signal, onLog, stepDelayMs })) {
      throw new Error('Soomar: não foi possível preencher e validar o valor ' + collaboratorCode + ' em COMP6021.');
    }

    emitDiagnostic(onLog, 'SOOMAR_POST_PARAMETER_READY', 'Navegação pós-parâmetro concluída e colaborador preenchido.', { collaboratorCode });
    return { ok: true, collaboratorCode };
  }

  function formatSoomarExpenseMoneyInput(cents) {
    const value = Math.round(Number(cents) || 0);
    const negative = value < 0;
    const absolute = Math.abs(value);
    const integer = Math.floor(absolute / 100);
    const fraction = String(absolute % 100).padStart(2, '0');
    return (negative ? '-' : '') + String(integer) + ',' + fraction;
  }

  function buildSoomarFirstExpenseCellPlan(row) {
    const source = row || {};
    const typeCode = String(source.typeCode || '').trim();
    if (!source.mappingFound || !/^\d{3}$/.test(typeCode)) {
      throw new Error('Soomar: a despesa está sem mapeamento de Tipo Despesa e não será lançada automaticamente.');
    }
    const dateText = String(source.dateText || '').trim();
    const receiptNumber = String(source.receiptNumber || '').trim();
    const observation = String(source.observation || '').replace(/\s+/g, ' ').trim();
    const valueCents = Math.round(Number(source.valueCents) || 0);
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) throw new Error('Soomar: Data Despesa inválida para o lançamento.');
    if (!/^\d{8}$/.test(receiptNumber)) throw new Error('Soomar: Num. Recibo inválido para o lançamento.');
    if (!observation) throw new Error('Soomar: Observação vazia para o lançamento.');
    if (valueCents <= 0) throw new Error('Soomar: Vlr. Despesa inválido para o lançamento.');

    return [
      { columnIndex: 1, label: 'Data Despesa', value: dateText, kind: 'date', editorName: 'M->PV7_DATA' },
      { columnIndex: 2, label: 'Tipo Despesa', value: typeCode, kind: 'code', editorName: 'M->PV7_TIPDES' },
      { columnIndex: 6, label: 'Vlr. Despesa', value: formatSoomarExpenseMoneyInput(valueCents), kind: 'money', editorName: 'M->PV7_VALOR' },
      { columnIndex: 7, label: 'Num. Recibo', value: receiptNumber, kind: 'text', editorName: 'M->PV7_RECIBO' },
      { columnIndex: 8, label: 'Observacao', value: observation, kind: 'text', editorName: 'M->PV7_OBS' }
    ];
  }

  function findSoomarExpenseGrid(doc) {
    return findActiveElementByExactId(doc || document, 'COMP6050', 'WA-TGRID');
  }

  function findSoomarGridCell(grid, rowIndex, columnIndex) {
    if (!grid) return null;
    let root = null;
    try { root = grid.shadowRoot || null; } catch (_) {}
    if (!root) return null;

    let rows = [];
    try { rows = Array.from(root.querySelectorAll('tbody tr')); } catch (_) {}
    const wantedRow = String(rowIndex);
    const row = rows.find((candidate) => String(candidate && candidate.id || '') === wantedRow) || rows[rowIndex] || null;
    if (!row) return null;

    let cells = [];
    try { cells = Array.from(row.querySelectorAll('td')); } catch (_) {}
    const wantedColumn = String(columnIndex);
    return cells.find((candidate) => String(candidate && candidate.id || '') === wantedColumn) || cells[columnIndex] || null;
  }

  function getSoomarGridCellText(grid, rowIndex, columnIndex) {
    const cell = findSoomarGridCell(grid, rowIndex, columnIndex);
    return cell ? String(getNodeText(cell) || '').replace(/\s+/g, ' ').trim() : '';
  }

  function formatSoomarGridItem(rowIndex) {
    const numeric = Math.max(0, Math.floor(Number(rowIndex) || 0)) + 1;
    return String(numeric).padStart(3, '0');
  }

  function getSoomarGridRowItem(grid, rowIndex) {
    return String(getSoomarGridCellText(grid, rowIndex, 0) || '').replace(/\s+/g, ' ').trim();
  }

  function isSoomarExpectedGridRow(grid, rowIndex) {
    if (!grid) return false;
    return getSoomarGridRowItem(grid, rowIndex) === formatSoomarGridItem(rowIndex);
  }

  function getSoomarGridCellSlotName(rowIndex, columnIndex) {
    return 'cell-widget' + String(rowIndex) + '|' + String(columnIndex);
  }

  function getSoomarControlName(node) {
    if (!node) return '';
    try { return String(node.getAttribute && node.getAttribute('name') || node.name || '').trim(); } catch (_) { return ''; }
  }

  function findSoomarNamedGridControl(doc, editorName) {
    const wanted = String(editorName || '').trim();
    if (!doc || !wanted) return null;
    const matches = [];
    for (const root of collectRoots(doc)) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('[name]')); } catch (_) {}
      for (const node of nodes) {
        if (getSoomarControlName(node) !== wanted) continue;
        matches.push(node);
      }
    }
    if (!matches.length) return null;
    const score = (node) => {
      let tag = '';
      try { tag = String(node.tagName || '').toUpperCase(); } catch (_) {}
      if (tag === 'WA-TEXT-INPUT' || tag === 'WA-NUMBER-INPUT' || tag === 'WA-DATE-INPUT') return 30;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return 25;
      if (tag === 'WA-BUTTON') return 5;
      return 10;
    };
    matches.sort((a, b) => score(b) - score(a));
    return matches[0] || null;
  }

  function shouldUseSoomarCodeKeyboardFallback(doc, editorName) {
    const control = findSoomarNamedGridControl(doc, editorName);
    if (!control) return false;
    let tag = '';
    try { tag = String(control.tagName || '').toUpperCase(); } catch (_) {}
    return tag === 'WA-BUTTON' && !getSoomarGridEditableFromNode(control);
  }

  async function typeSoomarCodeWithTrustedKeys(value, onTrustedKey) {
    if (typeof onTrustedKey !== 'function') return false;
    const text = String(value == null ? '' : value);
    if (!text) return false;
    for (const char of text) {
      let ok = false;
      try { ok = !!(await Promise.resolve(onTrustedKey(char))); } catch (_) { ok = false; }
      if (!ok) return false;
    }
    return true;
  }

  function getSoomarGridEditableFromNode(node) {
    if (!node) return null;
    let tag = '';
    try { tag = String(node.tagName || '').toUpperCase(); } catch (_) {}
    if (tag === 'INPUT' || tag === 'TEXTAREA') return isControlLocked(node) ? null : node;
    try {
      if (node.getAttribute && String(node.getAttribute('contenteditable') || '').toLowerCase() === 'true' && !isControlLocked(node)) return node;
    } catch (_) {}
    const inner = getInnerEditable(node);
    if (inner && !isControlLocked(inner)) return inner;
    try {
      const nested = node.querySelector && node.querySelector('input:not([disabled]):not([readonly]),textarea:not([disabled]):not([readonly]),[contenteditable="true"]');
      if (nested && !isControlLocked(nested)) return nested;
    } catch (_) {}
    return null;
  }

  function isSoomarGridEditorFocused(node) {
    if (!node) return false;
    try {
      if (typeof node.matches === 'function' && node.matches(':focus')) return true;
    } catch (_) {}
    try {
      if (node.shadowRoot && node.shadowRoot.activeElement) return true;
    } catch (_) {}
    try {
      const root = typeof node.getRootNode === 'function' ? node.getRootNode() : null;
      if (root && root.activeElement === node) return true;
    } catch (_) {}
    return false;
  }

  function findSoomarGridCellEditor(grid, rowIndex, columnIndex, editorName) {
    if (!grid) return null;
    const wantedName = String(editorName || '').trim();
    const slotName = getSoomarGridCellSlotName(rowIndex, columnIndex);
    const cell = findSoomarGridCell(grid, rowIndex, columnIndex);

    if (cell) {
      try {
        const slot = cell.querySelector('slot[name="' + slotName.replace(/"/g, '\\"') + '"]');
        if (slot && typeof slot.assignedElements === 'function') {
          const assigned = slot.assignedElements({ flatten: true });
          for (const node of assigned) {
            const editable = getSoomarGridEditableFromNode(node);
            if (editable) return editable;
          }
        }
      } catch (_) {}
    }

    try {
      const host = grid.querySelector('[slot="' + slotName.replace(/"/g, '\\"') + '"]');
      const editable = getSoomarGridEditableFromNode(host);
      if (editable) return editable;
    } catch (_) {}

    // O editor do tgrid é criado em um wa-dialog irmão da grade (ex.: COMP7500),
    // não necessariamente dentro do Shadow DOM de COMP6050. Os COMP750x são
    // reciclados, então a identidade estável é o name AdvPL (M->PV7_*).
    const searchRoot = grid.ownerDocument || grid;
    if (wantedName) {
      const namedControl = findSoomarNamedGridControl(searchRoot, wantedName);
      const namedEditable = getSoomarGridEditableFromNode(namedControl);
      if (namedEditable && (isSoomarGridEditorFocused(namedControl) || isSoomarGridEditorFocused(namedEditable))) return namedEditable;
    }
    const roots = collectRoots(searchRoot);
    for (const root of roots) {
      let candidates = [];
      try {
        candidates = Array.from(root.querySelectorAll('input:not([disabled]):not([readonly]),textarea:not([disabled]):not([readonly]),[contenteditable="true"],wa-text-input,wa-number-input,wa-date-input'));
      } catch (_) {}
      for (const candidate of candidates) {
        let slot = '';
        try { slot = String(candidate.getAttribute && candidate.getAttribute('slot') || ''); } catch (_) {}
        if (slot && slot !== slotName) continue;
        if (wantedName) {
          const candidateName = getSoomarControlName(candidate);
          let parentName = '';
          try {
            const rootNode = typeof candidate.getRootNode === 'function' ? candidate.getRootNode() : null;
            parentName = getSoomarControlName(rootNode && rootNode.host);
          } catch (_) {}
          if (candidateName !== wantedName && parentName !== wantedName) continue;
        }
        const editable = getSoomarGridEditableFromNode(candidate);
        if (!editable) continue;
        if (slot === slotName) return editable;
        // O tgrid pode criar o editor ativo sem atributo slot. Nesse caso,
        // aceitamos somente o WA/input que realmente está com foco, evitando
        // confundir com outros campos visíveis da tela (ex.: colaborador).
        if (!slot && isSoomarGridEditorFocused(candidate)) return editable;
      }
    }
    return null;
  }

  async function waitForSoomarGridCellEditor(grid, rowIndex, columnIndex, editorName, timeoutMs, signal, pollMs) {
    const timeout = Math.max(100, Number(timeoutMs) || 1500);
    const every = normalizeSoomarStepDelayMs(pollMs);
    const startedAt = Date.now();
    for (;;) {
      throwIfAborted(signal);
      const editor = findSoomarGridCellEditor(grid, rowIndex, columnIndex, editorName);
      if (editor) return editor;
      if (Date.now() - startedAt >= timeout) return null;
      await abortableSleep(every, signal);
    }
  }

  function dispatchSoomarGridCellEditGesture(cell) {
    if (!cell) return false;
    let target = cell;
    try { target = cell.querySelector('div') || cell; } catch (_) {}
    if (!dispatchWaButtonGesture(target)) return false;

    try {
      const view = getElementView(target);
      const MouseCtor = view && view.MouseEvent ? view.MouseEvent : (typeof MouseEvent !== 'undefined' ? MouseEvent : null);
      if (MouseCtor && typeof target.dispatchEvent === 'function') {
        const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : null;
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: view || null,
          detail: 2,
          button: 0,
          buttons: 0,
          clientX: rect && Number.isFinite(rect.left) ? rect.left + ((rect.width || 0) / 2) : 0,
          clientY: rect && Number.isFinite(rect.top) ? rect.top + ((rect.height || 0) / 2) : 0
        };
        target.dispatchEvent(new MouseCtor('dblclick', init));
      }
    } catch (_) {}
    return true;
  }

  function getSoomarGridEditorInputValue(editable, kind, value) {
    const text = String(value == null ? '' : value);
    if (String(kind || '').toLowerCase() !== 'date') return text;
    let inputType = '';
    try { inputType = String(editable && (editable.type || (editable.getAttribute && editable.getAttribute('type'))) || '').toLowerCase(); } catch (_) {}
    if (inputType !== 'date') return text;
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return match ? match[3] + '-' + match[2] + '-' + match[1] : text;
  }

  function setSoomarGridEditableValue(editable, value, kind) {
    if (!editable || isControlLocked(editable)) return false;
    const text = getSoomarGridEditorInputValue(editable, kind, value);
    let inputType = '';
    try { inputType = String(editable.type || (editable.getAttribute && editable.getAttribute('type')) || '').toLowerCase(); } catch (_) {}
    try { if (typeof editable.focus === 'function') editable.focus(); } catch (_) {}
    try { if (typeof editable.select === 'function') editable.select(); } catch (_) {}

    if (String(kind || '').toLowerCase() === 'date' && inputType === 'date') {
      if (!setNativeEditableValue(editable, text)) return false;
      dispatchSyntheticEvent(editable, 'input', { data: text, inputType: 'insertText' });
      dispatchSyntheticEvent(editable, 'change');
      try { return String(editable.value == null ? '' : editable.value) === text; } catch (_) { return true; }
    }

    if (!setNativeEditableValue(editable, '')) return false;
    dispatchSyntheticEvent(editable, 'input', { data: '', inputType: 'deleteContentBackward' });

    let current = '';
    for (const char of text) {
      dispatchSyntheticEvent(editable, 'keydown', { key: char, data: char });
      dispatchSyntheticEvent(editable, 'beforeinput', { data: char, inputType: 'insertText' });
      current += char;
      if (!setNativeEditableValue(editable, current)) return false;
      dispatchSyntheticEvent(editable, 'input', { data: char, inputType: 'insertText' });
      dispatchSyntheticEvent(editable, 'keyup', { key: char, data: char });
    }
    dispatchSyntheticEvent(editable, 'change');
    return true;
  }

  function isSoomarGridCellCommitted(grid, rowIndex, step) {
    const rendered = getSoomarGridCellText(grid, rowIndex, step.columnIndex);
    if (step.kind === 'money') {
      return parseProtheusMoneyToCents(rendered) === parseProtheusMoneyToCents(step.value);
    }
    return normalizeText(rendered) === normalizeText(step.value);
  }

  async function fillSoomarGridCell(doc, rowIndex, step, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const onTrustedDoubleClick = typeof opts.onTrustedDoubleClick === 'function' ? opts.onTrustedDoubleClick : null;
    const onTrustedKey = typeof opts.onTrustedKey === 'function' ? opts.onTrustedKey : null;
    const onTrustedText = typeof opts.onTrustedText === 'function' ? opts.onTrustedText : null;
    const stepDelayMs = normalizeSoomarStepDelayMs(opts.stepDelayMs);
    const maxAttempts = 2;

    throwIfAborted(signal);
    const grid = findSoomarExpenseGrid(source);
    if (!grid) throw new Error('Soomar: a grade COMP6050 deixou de estar disponível durante o preenchimento.');
    const cell = findSoomarGridCell(grid, rowIndex, step.columnIndex);
    if (!cell) throw new Error('Soomar: célula ' + step.label + ' da linha 001 não foi encontrada na grade COMP6050.');

    await applySoomarStepDelay(stepDelayMs, signal);

    let activation = 'synthetic-double-click';
    let activated = false;
    if (onTrustedDoubleClick) {
      activation = 'trusted-double-click';
      activated = !!(await Promise.resolve(onTrustedDoubleClick(cell)));
      emitDiagnostic(onLog, 'SOOMAR_GRID_TRUSTED_DOUBLE_CLICK', 'Duplo clique confiável enviado para ativar a célula.', {
        rowIndex,
        columnIndex: step.columnIndex,
        label: step.label,
        activated
      });
    }
    if (!activated) {
      activated = dispatchSoomarGridCellEditGesture(cell);
      emitDiagnostic(onLog, 'SOOMAR_GRID_SYNTHETIC_ACTIVATION', 'Fallback sintético usado para ativar a célula.', {
        rowIndex,
        columnIndex: step.columnIndex,
        label: step.label,
        activated
      });
    }

    await applySoomarStepDelay(stepDelayMs, signal);
    let editor = await waitForSoomarGridCellEditor(grid, rowIndex, step.columnIndex, step.editorName, 2200, signal, stepDelayMs);
    if (!editor) {
      emitDiagnostic(onLog, 'SOOMAR_GRID_EDITOR_RECOVERY', 'Editor não apareceu após duplo clique; executando uma única recuperação com F2.', {
        rowIndex,
        columnIndex: step.columnIndex,
        label: step.label,
        attempt: 1,
        maxAttempts,
        activation
      });
      let keySent = false;
      if (onTrustedKey) keySent = !!(await Promise.resolve(onTrustedKey('F2')));
      if (!keySent) {
        dispatchSyntheticEvent(cell, 'keydown', { key: 'F2', code: 'F2' });
        dispatchSyntheticEvent(cell, 'keyup', { key: 'F2', code: 'F2' });
      }
      await applySoomarStepDelay(stepDelayMs, signal);
      editor = await waitForSoomarGridCellEditor(grid, rowIndex, step.columnIndex, step.editorName, 1800, signal, stepDelayMs);
    }

    if (!editor && step.kind === 'code' && shouldUseSoomarCodeKeyboardFallback(source, step.editorName)) {
      emitDiagnostic(onLog, 'SOOMAR_GRID_CODE_FALLBACK', 'Tipo Despesa expôs apenas o controle auxiliar; digitando o código por teclado confiável na célula ativa.', {
        rowIndex,
        columnIndex: step.columnIndex,
        label: step.label,
        editorName: step.editorName,
        value: step.value
      });
      await applySoomarStepDelay(stepDelayMs, signal);
      let typed = false;
      if (onTrustedKey) typed = await typeSoomarCodeWithTrustedKeys(step.value, onTrustedKey);
      if (typed) {
        await applySoomarStepDelay(stepDelayMs, signal);
        let enterSent = false;
        try { enterSent = !!(await Promise.resolve(onTrustedKey('Enter'))); } catch (_) { enterSent = false; }
        await applySoomarStepDelay(stepDelayMs, signal);
        const committedByKeyboard = await waitForCondition(() => {
          const currentGrid = findSoomarExpenseGrid(source);
          return !!currentGrid && isSoomarGridCellCommitted(currentGrid, rowIndex, step);
        }, 5000, 120, signal);
        if (committedByKeyboard) {
          emitDiagnostic(onLog, 'SOOMAR_GRID_CODE_SET', 'Tipo Despesa preenchido e validado pelo fallback de teclado confiável.', {
            rowIndex,
            columnIndex: step.columnIndex,
            label: step.label,
            value: step.value,
            enterSent
          });
          return true;
        }
      }
    }

    if (!editor) {
      emitDiagnostic(onLog, 'SOOMAR_GRID_EDITOR_MISSING', 'Editor da célula não apareceu após duplo clique confiável e recuperação F2.', {
        rowIndex,
        columnIndex: step.columnIndex,
        label: step.label,
        editorName: step.editorName,
        attempt: 2,
        maxAttempts
      });
      return false;
    }

    emitDiagnostic(onLog, 'SOOMAR_GRID_EDITOR_READY', 'Editor da célula localizado após ativação.', {
      rowIndex,
      columnIndex: step.columnIndex,
      label: step.label,
      editorName: step.editorName,
      editor: describeActionTarget(editor)
    });

    await applySoomarStepDelay(stepDelayMs, signal);
    let valueSet = false;
    if (onTrustedText) {
      try { if (typeof editor.focus === 'function') editor.focus(); } catch (_) {}
      try { if (typeof editor.select === 'function') editor.select(); } catch (_) {}
      try { valueSet = !!(await Promise.resolve(onTrustedText(String(step.value == null ? '' : step.value)))); } catch (_) { valueSet = false; }
      if (valueSet) {
        await applySoomarStepDelay(stepDelayMs, signal);
        let editorValue = '';
        try { editorValue = String(editor.value == null ? '' : editor.value); } catch (_) {}
        if (step.kind === 'money') valueSet = parseProtheusMoneyToCents(editorValue) === parseProtheusMoneyToCents(step.value);
        else valueSet = normalizeText(editorValue) === normalizeText(step.value);
      }
      emitDiagnostic(onLog, 'SOOMAR_GRID_TRUSTED_TEXT', 'Texto confiável enviado ao editor ativo da célula.', {
        rowIndex,
        columnIndex: step.columnIndex,
        label: step.label,
        value: step.value,
        trusted: valueSet,
        editor: describeActionTarget(editor)
      });
    }
    if (!valueSet) valueSet = setSoomarGridEditableValue(editor, step.value, step.kind);
    if (!valueSet) return false;

    // A digitação acima altera o valor; um Enter confiável consolida a
    // edição no componente quando o Protheus exige uma tecla real.
    await applySoomarStepDelay(stepDelayMs, signal);
    let enterCommitted = false;
    if (onTrustedKey) {
      try { enterCommitted = !!(await Promise.resolve(onTrustedKey('Enter'))); } catch (_) {}
    }
    if (!enterCommitted) {
      dispatchSyntheticEvent(editor, 'keydown', { key: 'Enter', code: 'Enter' });
      dispatchSyntheticEvent(editor, 'keyup', { key: 'Enter', code: 'Enter' });
    }
    try { if (typeof editor.blur === 'function') editor.blur(); } catch (_) {}

    await applySoomarStepDelay(stepDelayMs, signal);
    const committed = await waitForCondition(() => {
      const currentGrid = findSoomarExpenseGrid(source);
      return !!currentGrid && isSoomarGridCellCommitted(currentGrid, rowIndex, step);
    }, 5000, 120, signal);
    if (committed) {
      emitDiagnostic(onLog, 'SOOMAR_GRID_CELL_SET', 'Célula da primeira despesa preenchida e validada.', {
        rowIndex,
        columnIndex: step.columnIndex,
        label: step.label,
        value: step.value,
        attempt: 1
      });
      return true;
    }

    emitDiagnostic(onLog, 'SOOMAR_GRID_COMMIT_MISSING', 'Editor recebeu o valor, mas a célula não confirmou o conteúdo renderizado.', {
      rowIndex,
      columnIndex: step.columnIndex,
      label: step.label,
      value: step.value
    });
    return false;
  }

  async function fillSoomarExpenseRow(doc, row, rowIndex, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const onTrustedDoubleClick = typeof opts.onTrustedDoubleClick === 'function' ? opts.onTrustedDoubleClick : null;
    const onTrustedKey = typeof opts.onTrustedKey === 'function' ? opts.onTrustedKey : null;
    const onTrustedText = typeof opts.onTrustedText === 'function' ? opts.onTrustedText : null;
    const stepDelayMs = normalizeSoomarStepDelayMs(opts.stepDelayMs);
    const plan = buildSoomarFirstExpenseCellPlan(row);
    const item = formatSoomarGridItem(rowIndex);

    throwIfAborted(signal);
    const grid = await waitForElement(source, findSoomarExpenseGrid, stepDelayMs, signal);
    if (!grid) throw new Error('Soomar: a grade COMP6050 não foi encontrada na tela de inclusão.');
    if (!isSoomarExpectedGridRow(grid, rowIndex)) {
      throw new Error('Soomar: a linha ' + item + ' não está disponível/identificada corretamente; preenchimento interrompido para evitar sobreposição.');
    }
    await applySoomarStepDelay(stepDelayMs, signal);

    for (let index = 0; index < plan.length; index++) {
      const step = plan[index];
      throwIfAborted(signal);
      const currentGrid = findSoomarExpenseGrid(source);
      if (!currentGrid || !isSoomarExpectedGridRow(currentGrid, rowIndex)) {
        throw new Error('Soomar: a linha ativa esperada ' + item + ' mudou antes de ' + step.label + '; rotina interrompida para evitar sobrescrever outra linha.');
      }
      onStatus('SOOMAR — linha ' + item + ': preenchendo ' + step.label + ' (' + (index + 1) + '/' + plan.length + ')...');
      const ok = await fillSoomarGridCell(source, rowIndex, step, { signal, onLog, onTrustedDoubleClick, onTrustedKey, onTrustedText, stepDelayMs });
      if (!ok) throw new Error('Soomar: não foi possível preencher/confirmar ' + step.label + ' na linha ' + item + '.');
    }

    const expectedDescription = String(row && row.description || '').replace(/\s+/g, ' ').trim();
    if (expectedDescription) {
      await applySoomarStepDelay(stepDelayMs, signal);
      const descriptionReady = await waitForCondition(
        () => {
          const currentGrid = findSoomarExpenseGrid(source);
          return !!currentGrid && isSoomarExpectedGridRow(currentGrid, rowIndex) && normalizeText(getSoomarGridCellText(currentGrid, rowIndex, 3)) === normalizeText(expectedDescription);
        },
        5000,
        Math.max(100, stepDelayMs),
        signal
      );
      if (!descriptionReady) {
        throw new Error('Soomar: Tipo Despesa foi preenchido, mas a descrição automática da linha ' + item + ' não ficou como "' + expectedDescription + '".');
      }
    }

    emitDiagnostic(onLog, 'SOOMAR_EXPENSE_ROW_COMPLETE', 'Linha da prestação de contas preenchida e validada.', {
      rowIndex,
      item,
      dateText: row.dateText,
      typeCode: row.typeCode,
      description: row.description,
      valueCents: row.valueCents,
      receiptNumber: row.receiptNumber,
      observation: row.observation
    });
    return { ok: true, rowIndex, item, fields: plan };
  }

  async function runSoomarFirstExpenseRow(doc, row, options) {
    const opts = options || {};
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    onStatus('SOOMAR — preparando primeira linha da prestação de contas...');
    const result = await fillSoomarExpenseRow(doc, row, 0, opts);
    emitDiagnostic(typeof opts.onLog === 'function' ? opts.onLog : function () {}, 'SOOMAR_FIRST_ROW_COMPLETE', 'Primeira linha da prestação de contas preenchida e validada.', {
      dateText: row && row.dateText,
      typeCode: row && row.typeCode,
      description: row && row.description,
      valueCents: row && row.valueCents,
      receiptNumber: row && row.receiptNumber,
      observation: row && row.observation
    });
    onStatus('SOOMAR — linha 001 preenchida para conferência.');
    return result;
  }

  async function runSoomarExpenseRows(doc, rows, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const onTrustedClick = typeof opts.onTrustedClick === 'function' ? opts.onTrustedClick : null;
    const onTrustedKey = typeof opts.onTrustedKey === 'function' ? opts.onTrustedKey : null;
    const stepDelayMs = normalizeSoomarStepDelayMs(opts.stepDelayMs);
    const expenses = Array.isArray(rows) ? rows : [];
    if (!expenses.length) throw new Error('Soomar: não há despesas com valor para lançar.');

    onStatus('SOOMAR — preparando ' + expenses.length + ' linha(s) da prestação de contas...');
    const grid = await waitForElement(source, findSoomarExpenseGrid, stepDelayMs, signal);
    if (!grid) throw new Error('Soomar: a grade COMP6050 não foi encontrada na tela de inclusão.');

    for (let rowIndex = 0; rowIndex < expenses.length; rowIndex++) {
      throwIfAborted(signal);
      const item = formatSoomarGridItem(rowIndex);
      const rowReady = await waitForCondition(() => {
        const currentGrid = findSoomarExpenseGrid(source);
        return !!currentGrid && isSoomarExpectedGridRow(currentGrid, rowIndex);
      }, 5000, Math.max(100, stepDelayMs), signal);
      if (!rowReady) {
        throw new Error('Soomar: a linha ' + item + ' não apareceu como esperado; rotina interrompida para evitar sobreposição.');
      }

      await fillSoomarExpenseRow(source, expenses[rowIndex], rowIndex, opts);

      if (rowIndex >= expenses.length - 1) continue;
      await applySoomarStepDelay(stepDelayMs, signal);

      const currentGrid = findSoomarExpenseGrid(source);
      const focusTarget = findSoomarGridCell(currentGrid, rowIndex, 0) || currentGrid;
      let gridFocused = false;
      if (focusTarget && onTrustedClick) {
        try { gridFocused = !!(await Promise.resolve(onTrustedClick(focusTarget))); } catch (_) { gridFocused = false; }
      }
      if (!gridFocused && focusTarget) {
        try { if (typeof focusTarget.focus === 'function') focusTarget.focus(); } catch (_) {}
        try { dispatchSyntheticEvent(focusTarget, 'click'); } catch (_) {}
      }
      emitDiagnostic(onLog, 'SOOMAR_GRID_FOCUS_BEFORE_ARROW', 'Grade refocada antes de solicitar a próxima linha.', {
        completedItem: item,
        nextItem: formatSoomarGridItem(rowIndex + 1),
        trusted: gridFocused,
        targetColumn: 0
      });
      await applySoomarStepDelay(stepDelayMs, signal);

      let arrowSent = false;
      if (onTrustedKey) {
        try { arrowSent = !!(await Promise.resolve(onTrustedKey('ArrowDown'))); } catch (_) { arrowSent = false; }
      }
      if (!arrowSent) {
        const currentGrid = findSoomarExpenseGrid(source);
        dispatchSyntheticEvent(currentGrid, 'keydown', { key: 'ArrowDown', code: 'ArrowDown' });
        dispatchSyntheticEvent(currentGrid, 'keyup', { key: 'ArrowDown', code: 'ArrowDown' });
      }
      emitDiagnostic(onLog, 'SOOMAR_NEXT_ROW_REQUESTED', 'Seta para baixo enviada para criar/avançar à próxima linha.', {
        completedItem: item,
        nextItem: formatSoomarGridItem(rowIndex + 1),
        trusted: arrowSent
      });

      await applySoomarStepDelay(stepDelayMs, signal);
      const nextReady = await waitForCondition(() => {
        const currentGrid = findSoomarExpenseGrid(source);
        return !!currentGrid && isSoomarExpectedGridRow(currentGrid, rowIndex + 1);
      }, 5000, Math.max(100, stepDelayMs), signal);
      if (!nextReady) {
        throw new Error('Soomar: a próxima linha ' + formatSoomarGridItem(rowIndex + 1) + ' não foi criada/identificada após ArrowDown.');
      }
    }

    emitDiagnostic(onLog, 'SOOMAR_ALL_ROWS_COMPLETE', 'Todas as despesas foram preenchidas e validadas sem acionar confirmação final.', {
      total: expenses.length,
      lastItem: formatSoomarGridItem(expenses.length - 1)
    });
    onStatus('SOOMAR — ' + expenses.length + ' despesa(s) preenchida(s) para conferência.');
    return { ok: true, total: expenses.length, lastItem: formatSoomarGridItem(expenses.length - 1) };
  }


  function normalizeSoomarApprovalDate(value) {
    const text = String(value == null ? '' : value).trim();
    if (/^\d{8}$/.test(text)) return text;
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return match ? (match[3] + match[2] + match[1]) : text.replace(/\D/g, '');
  }

  function findSoomarFinalConfirmButton(doc) {
    const source = doc || document;
    return findActiveElementByExactId(source, 'COMP6056', '')
      || findUniqueSoomarSemanticElement(source, 'wa-button[data-advpl="tbutton"],wa-button[data-advpl="tbrowsebutton"],wa-button', 'Confirmar');
  }

  function findSoomarFinalYesButton(doc) {
    const source = doc || document;
    const exact = findActiveElementByExactId(source, 'COMP7511', '', (node) => getSoomarSemanticLabels(node).includes(normalizeSoomarSemanticLabel('Sim')));
    return exact
      || findUniqueSoomarSemanticElement(source, 'wa-button[data-advpl="tbutton"],wa-button[data-advpl="tbrowsebutton"],wa-button', 'Sim');
  }

  function findSoomarPostSubmitCloseButton(doc) {
    const source = doc || document;
    const wanted = normalizeSoomarSemanticLabel('Fechar');
    return findActiveElementByExactId(source, 'COMP7511', '', (node) => getSoomarSemanticLabels(node).includes(wanted));
  }

  function findSoomarEntryWindowCloseButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP4514', '');
  }

  function classifySoomarApprovalContext(state) {
    const value = state || {};
    if (value.dialogOpen) return 'dialog';
    if (value.browseReady) return 'browse';
    if (value.optionVisible) return 'menu';
    return 'unknown';
  }

  function getSoomarApprovalContext(doc) {
    const source = doc || document;
    const dialogOpen = !!findSoomarApprovalDialog(source) && !!findSoomarApprovalBrowse(source);
    const browseReady = !dialogOpen && !!findSoomarApprovalBottomButton(source) && !!findSoomarApprovalAnalyzeButton(source);
    const optionVisible = !dialogOpen && !browseReady && !!findSoomarDepartmentApprovalOption(source);
    return {
      stage: classifySoomarApprovalContext({ dialogOpen, browseReady, optionVisible }),
      dialogOpen,
      browseReady,
      optionVisible
    };
  }

  function findSoomarDepartmentApprovalOption(doc) {
    return findUniqueSoomarSemanticElement(doc || document, 'wa-text-view[data-advpl="tsay"],wa-text-view', 'Aprov. Depto Prest. Contas');
  }

  function findSoomarApprovalBottomButton(doc) {
    const source = doc || document;
    const exact = findActiveElementByExactId(source, 'COMP4510', '');
    if (exact) return exact;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('wa-button[data-advpl="tbtnbmp"],wa-button')); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (!isElementActive(node) || isControlLocked(node)) continue;
        let css = '';
        try { css = String(node.getAttribute('style') || '') + ' ' + String(node.style && node.style.backgroundImage || ''); } catch (_) {}
        if (/fwskin_scroll_btm\.png/i.test(css)) matches.push(node);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function findSoomarApprovalAnalyzeButton(doc) {
    const source = doc || document;
    return findActiveElementByExactId(source, 'COMP4565', '')
      || findUniqueSoomarSemanticElement(source, 'wa-button[data-advpl="tbrowsebutton"],wa-button[data-advpl="tbutton"],wa-button', 'Analisar');
  }

  function findSoomarApprovalDialog(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let dialogs = [];
      try { dialogs = Array.from(root.querySelectorAll('wa-dialog')); } catch (_) {}
      for (const dialog of dialogs) {
        if (!dialog || seen.has(dialog)) continue;
        seen.add(dialog);
        if (!isElementStateActive(dialog)) continue;
        const title = normalizeSoomarSemanticLabel((dialog.getAttribute && dialog.getAttribute('title')) || dialog.title || '');
        if (title === normalizeSoomarSemanticLabel('Aprovação Despesas')) matches.push(dialog);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function findSoomarApprovalBrowse(doc) {
    const dialog = findSoomarApprovalDialog(doc || document);
    if (!dialog) return null;
    const roots = collectRoots(dialog);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('wa-tcbrowse[data-advpl="tcbrowse"],wa-tcbrowse')); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (!isElementStateActive(node)) continue;
        matches.push(node);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function getSoomarApprovalCellText(cell) {
    if (!cell) return '';
    try {
      const label = cell.querySelector && cell.querySelector('label');
      if (label) return String(label.textContent == null ? '' : label.textContent).replace(/\s+/g, ' ').trim();
    } catch (_) {}
    return String(cell.textContent == null ? '' : cell.textContent).replace(/\s+/g, ' ').trim();
  }

  function getSoomarApprovalRowInfo(row, rowIndex) {
    let cells = [];
    try { cells = Array.from(row && row.querySelectorAll ? row.querySelectorAll('td') : []); } catch (_) {}
    const checkboxCell = cells[0] || null;
    let checkboxTarget = null;
    let checkboxBackground = '';
    try {
      if (checkboxCell && checkboxCell.querySelector) {
        checkboxTarget = checkboxCell.querySelector('div.image-cell') || checkboxCell.querySelector('.image-cell');
      }
    } catch (_) {}
    if (!checkboxTarget) checkboxTarget = checkboxCell;
    try {
      checkboxBackground = String((checkboxTarget && checkboxTarget.style && checkboxTarget.style.backgroundImage) || (checkboxTarget && checkboxTarget.getAttribute && checkboxTarget.getAttribute('style')) || '');
    } catch (_) {}
    return {
      row,
      rowIndex: Number(rowIndex) || 0,
      checkboxCell,
      checkboxTarget,
      checkboxBackground,
      item: getSoomarApprovalCellText(cells[1]),
      dateText: getSoomarApprovalCellText(cells[2]),
      typeCode: getSoomarApprovalCellText(cells[3]),
      description: getSoomarApprovalCellText(cells[4]),
      valueCents: parseProtheusMoneyToCents(getSoomarApprovalCellText(cells[5])),
      approvedCents: parseProtheusMoneyToCents(getSoomarApprovalCellText(cells[6])),
      observation: getSoomarApprovalCellText(cells[7]),
      status: getSoomarApprovalCellText(cells[8]),
      km: getSoomarApprovalCellText(cells[9]),
      receiptNumber: getSoomarApprovalCellText(cells[10])
    };
  }

  function getSoomarApprovalRowsFromBrowse(browse) {
    if (!browse) return [];
    const roots = [];
    const seenRoots = new Set();
    const addRoot = function (root) {
      if (!root || seenRoots.has(root)) return;
      seenRoots.add(root);
      roots.push(root);
    };
    addRoot(browse);
    try {
      if (browse.shadowRoot) {
        for (const root of collectRoots(browse.shadowRoot)) addRoot(root);
      }
    } catch (_) {}
    for (const root of collectRoots(browse)) addRoot(root);

    const rows = [];
    const seen = new Set();
    for (const root of roots) {
      let found = [];
      try { found = Array.from(root.querySelectorAll('tbody tr')); } catch (_) {}
      for (const row of found) {
        if (!row || seen.has(row)) continue;
        seen.add(row);
        rows.push(getSoomarApprovalRowInfo(row, rows.length));
      }
    }
    return rows;
  }

  function getSoomarApprovalRows(doc) {
    const browse = findSoomarApprovalBrowse(doc || document);
    return getSoomarApprovalRowsFromBrowse(browse);
  }

  async function waitForSoomarApprovalRows(getRows, expectedCount, options) {
    const getter = typeof getRows === 'function' ? getRows : function () { return []; };
    const opts = options || {};
    const expected = Math.max(0, Number(expectedCount) || 0);
    const timeoutMs = Math.max(0, Number(opts.timeoutMs) || 8000);
    const pollMs = Math.max(25, Number(opts.pollMs) || 120);
    const signal = opts.signal;
    const startedAt = Date.now();
    let latest = [];
    for (;;) {
      throwIfAborted(signal);
      try { latest = getter() || []; } catch (_) { latest = []; }
      if (expected > 0 ? latest.length === expected : latest.length > 0) return latest;
      if (Date.now() - startedAt >= timeoutMs) return latest;
      await abortableSleep(Math.min(pollMs, Math.max(25, timeoutMs - (Date.now() - startedAt))), signal);
    }
  }

  function isSoomarApprovalCheckboxChecked(info) {
    const text = String(info && info.checkboxBackground || '').toLowerCase();
    if (!text) return false;
    if (text.includes('lbno_mdi.png') || text.includes('lbno')) return false;
    return text.includes('lbyes') || text.includes('yes') || text.includes('check') || text.includes('.png');
  }

  function didSoomarApprovalCheckboxToggle(previousBackground, latestInfo) {
    const before = String(previousBackground == null ? '' : previousBackground).trim().toLowerCase();
    const after = String(latestInfo && latestInfo.checkboxBackground || '').trim().toLowerCase();
    if (!after || after === before) return false;
    return isSoomarApprovalCheckboxChecked(latestInfo);
  }

  function validateSoomarApprovalRows(actualRows, expectedExpenses) {
    const actual = Array.isArray(actualRows) ? actualRows : [];
    const expected = Array.isArray(expectedExpenses) ? expectedExpenses : [];
    if (actual.length !== expected.length) {
      return { ok: false, reason: 'count', actual: actual.length, expected: expected.length };
    }
    for (let index = 0; index < expected.length; index++) {
      const a = actual[index] || {};
      const e = expected[index] || {};
      const expectedItem = formatSoomarGridItem(index);
      const mismatches = [];
      if (String(a.item || '').trim() !== expectedItem) mismatches.push('item');
      if (normalizeSoomarApprovalDate(a.dateText) !== normalizeSoomarApprovalDate(e.dateText)) mismatches.push('data');
      if (String(a.typeCode || '').trim() !== String(e.typeCode || '').trim()) mismatches.push('tipo');
      if (normalizeText(a.description) !== normalizeText(e.description)) mismatches.push('descrição');
      if (Number(a.valueCents || 0) !== Number(e.valueCents || 0)) mismatches.push('valor');
      if (normalizeText(a.observation) !== normalizeText(e.observation)) mismatches.push('observação');
      if (String(a.receiptNumber || '').trim() !== String(e.receiptNumber || '').trim()) mismatches.push('recibo');
      if (mismatches.length) {
        return { ok: false, reason: 'row-mismatch', rowIndex: index, item: expectedItem, mismatches, actual: a, expected: e };
      }
    }
    return { ok: true, total: expected.length };
  }

  async function runSoomarSubmissionAndApprovalSelection(doc, expenses, options) {
    const source = doc || document;
    const rowsExpected = Array.isArray(expenses) ? expenses : [];
    const opts = options || {};
    const signal = opts.signal;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const onTrustedClick = typeof opts.onTrustedClick === 'function' ? opts.onTrustedClick : null;
    const stepDelayMs = normalizeSoomarStepDelayMs(opts.stepDelayMs);

    const trustedThenFallback = async function (target) {
      throwIfAborted(signal);
      await applySoomarStepDelay(stepDelayMs, signal);
      if (onTrustedClick) {
        let trusted = false;
        try { trusted = !!(await Promise.resolve(onTrustedClick(target))); } catch (_) { trusted = false; }
        if (trusted) return true;
      }
      return dispatchWaButtonGesture(target) || clickElement(target);
    };

    if (!rowsExpected.length) throw new Error('Soomar: não há despesas para confirmar e preparar aprovação.');

    onStatus('SOOMAR — confirmando a prestação de contas...');
    const finalConfirmed = await performConfirmedClick(source, {
      label: 'Soomar — Confirmar prestação de contas',
      findTarget: findSoomarFinalConfirmButton,
      isSuccess: (currentDoc) => !!findSoomarFinalYesButton(currentDoc),
      triggerTarget: trustedThenFallback,
      onStatus, onLog, signal, stepDelayMs,
      maxAttempts: 2, retryDelayMs: stepDelayMs, effectTimeoutMs: 8000, effectPollMs: 120
    });
    if (!finalConfirmed) throw new Error('Soomar: o Confirmar da prestação de contas foi acionado, mas a confirmação Sim não apareceu.');

    onStatus('SOOMAR — enviando prestação de contas para aprovação...');
    const yesConfirmed = await performConfirmedClick(source, {
      label: 'Soomar — confirmar Sim',
      findTarget: findSoomarFinalYesButton,
      isSuccess: (currentDoc) => !findSoomarFinalYesButton(currentDoc),
      triggerTarget: trustedThenFallback,
      onStatus, onLog, signal, stepDelayMs,
      maxAttempts: 2, retryDelayMs: stepDelayMs, effectTimeoutMs: 10000, effectPollMs: 150
    });
    if (!yesConfirmed) throw new Error('Soomar: o botão Sim foi acionado, mas a janela de confirmação não fechou.');

    onStatus('SOOMAR — aguardando mensagem final do lançamento...');
    const postCloseReady = await waitForCondition(
      () => !!findSoomarPostSubmitCloseButton(source),
      10000,
      Math.max(100, stepDelayMs),
      signal
    );
    if (!postCloseReady) throw new Error('Soomar: após o Sim, a janela final com o botão Fechar não apareceu.');

    const postClosed = await performConfirmedClick(source, {
      label: 'Soomar — fechar mensagem final',
      findTarget: findSoomarPostSubmitCloseButton,
      isSuccess: (currentDoc) => !findSoomarPostSubmitCloseButton(currentDoc),
      triggerTarget: trustedThenFallback,
      onStatus, onLog, signal, stepDelayMs,
      maxAttempts: 2, retryDelayMs: stepDelayMs, effectTimeoutMs: 10000, effectPollMs: 150
    });
    if (!postClosed) throw new Error('Soomar: o botão Fechar da mensagem final foi acionado, mas a janela não fechou.');

    await abortableSleep(Math.max(500, stepDelayMs), signal);
    onStatus('SOOMAR — fechando lançamento concluído...');
    const closed = await performConfirmedClick(source, {
      label: 'Soomar — fechar lançamento',
      findTarget: findSoomarEntryWindowCloseButton,
      isSuccess: (currentDoc) => !findSoomarEntryWindowCloseButton(currentDoc) && !!findSoomarDepartmentApprovalOption(currentDoc),
      triggerTarget: trustedThenFallback,
      onStatus, onLog, signal, stepDelayMs,
      maxAttempts: 2, retryDelayMs: stepDelayMs, effectTimeoutMs: 10000, effectPollMs: 150
    });
    if (!closed) throw new Error('Soomar: não foi possível fechar o lançamento e retornar às rotinas de Viagem/Despesas.');

    return runSoomarApprovalSelection(source, rowsExpected, opts);
  }

  async function runSoomarApprovalSelection(doc, expenses, options) {
    const source = doc || document;
    const rowsExpected = Array.isArray(expenses) ? expenses : [];
    const opts = options || {};
    const signal = opts.signal;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const onTrustedClick = typeof opts.onTrustedClick === 'function' ? opts.onTrustedClick : null;
    const onTrustedDoubleClick = typeof opts.onTrustedDoubleClick === 'function' ? opts.onTrustedDoubleClick : null;
    const stepDelayMs = normalizeSoomarStepDelayMs(opts.stepDelayMs);

    const trustedThenFallback = async function (target) {
      throwIfAborted(signal);
      await applySoomarStepDelay(stepDelayMs, signal);
      if (onTrustedClick) {
        let trusted = false;
        try { trusted = !!(await Promise.resolve(onTrustedClick(target))); } catch (_) { trusted = false; }
        if (trusted) return true;
      }
      return dispatchWaButtonGesture(target) || clickElement(target);
    };

    const trustedDoubleThenFallback = async function (target, item) {
      throwIfAborted(signal);
      await applySoomarStepDelay(stepDelayMs, signal);
      let trusted = false;
      if (onTrustedDoubleClick) {
        try { trusted = !!(await Promise.resolve(onTrustedDoubleClick(target))); } catch (_) { trusted = false; }
      }
      emitDiagnostic(onLog, 'SOOMAR_APPROVAL_DOUBLE_CLICK', 'Duplo clique enviado à seleção da despesa na aprovação.', {
        item: item || '',
        trusted,
        target: describeActionTarget(target)
      });
      if (trusted) return true;
      return dispatchSoomarGridCellEditGesture(target);
    };

    if (!rowsExpected.length) throw new Error('Soomar: não há despesas para localizar na etapa de aprovação.');

    let context = getSoomarApprovalContext(source);
    emitDiagnostic(onLog, 'SOOMAR_APPROVAL_CONTEXT', 'Estado inicial da etapa de aprovação identificado.', context);

    if (context.stage === 'unknown') {
      const updatesButton = findSoomarUpdatesButton(source);
      if (updatesButton) {
        onStatus('SOOMAR — abrindo Atualizações para localizar a etapa de aprovação...');
        const updatesOpened = await performConfirmedClick(source, {
          label: 'Soomar — Atualizações para aprovação',
          findTarget: findSoomarUpdatesButton,
          isSuccess: (currentDoc) => !!findSoomarDepartmentApprovalOption(currentDoc),
          triggerTarget: trustedThenFallback,
          onStatus, onLog, signal, stepDelayMs,
          maxAttempts: 2, retryDelayMs: stepDelayMs, effectTimeoutMs: 5000, effectPollMs: 120
        });
        if (!updatesOpened) throw new Error('Soomar: não foi possível revelar Aprov. Depto Prest. Contas no menu Atualizações.');
      } else {
        await waitForCondition(() => {
          const latest = getSoomarApprovalContext(source);
          return latest.stage !== 'unknown';
        }, 2500, Math.max(100, stepDelayMs), signal);
      }
      context = getSoomarApprovalContext(source);
      emitDiagnostic(onLog, 'SOOMAR_APPROVAL_CONTEXT', 'Estado da etapa de aprovação reavaliado após navegação.', context);
    }

    if (context.stage === 'menu') {
      const approvalOption = findSoomarDepartmentApprovalOption(source);
      emitDiagnostic(onLog, 'SOOMAR_APPROVAL_TARGET', 'Rotina Aprov. Depto Prest. Contas localizada semanticamente.', {
        target: describeActionTarget(approvalOption), semanticLabels: getSoomarSemanticLabels(approvalOption)
      });
      if (!approvalOption) throw new Error('Soomar: a rotina Aprov. Depto Prest. Contas não foi localizada.');

      onStatus('SOOMAR — abrindo Aprov. Depto Prest. Contas...');
      const approvalOpened = await performConfirmedClick(source, {
        label: 'Soomar — Aprov. Depto Prest. Contas',
        findTarget: findSoomarDepartmentApprovalOption,
        isSuccess: (currentDoc) => !!findSoomarApprovalBottomButton(currentDoc) && !!findSoomarApprovalAnalyzeButton(currentDoc),
        triggerTarget: trustedThenFallback,
        onStatus, onLog, signal, stepDelayMs,
        maxAttempts: 2, retryDelayMs: stepDelayMs, effectTimeoutMs: 12000, effectPollMs: 180
      });
      if (!approvalOpened) throw new Error('Soomar: a rotina de aprovação abriu, mas os controles do browse não ficaram disponíveis.');
      context = getSoomarApprovalContext(source);
    }

    if (context.stage === 'browse') {
      onStatus('SOOMAR — posicionando no registro mais recente...');
      const bottom = findSoomarApprovalBottomButton(source);
      if (!bottom || !await trustedThenFallback(bottom)) throw new Error('Soomar: não foi possível acionar o botão de ir ao final da lista.');
      await abortableSleep(1000, signal);

      onStatus('SOOMAR — abrindo análise das despesas...');
      const analyzed = await performConfirmedClick(source, {
        label: 'Soomar — Analisar prestação de contas',
        findTarget: findSoomarApprovalAnalyzeButton,
        isSuccess: (currentDoc) => !!findSoomarApprovalDialog(currentDoc) && !!findSoomarApprovalBrowse(currentDoc),
        triggerTarget: trustedThenFallback,
        onStatus, onLog, signal, stepDelayMs,
        maxAttempts: 2, retryDelayMs: stepDelayMs, effectTimeoutMs: 12000, effectPollMs: 150
      });
      if (!analyzed) throw new Error('Soomar: Analisar foi acionado, mas a janela Aprovação Despesas não abriu.');
      context = getSoomarApprovalContext(source);
    }

    if (context.stage !== 'dialog') {
      context = getSoomarApprovalContext(source);
      if (context.stage !== 'dialog') {
        throw new Error('Soomar: não foi possível chegar à janela Aprovação Despesas a partir do estado atual.');
      }
    }

    onStatus('SOOMAR — aguardando carregar as despesas para aprovação...');
    let approvalRows = await waitForSoomarApprovalRows(
      () => getSoomarApprovalRows(source),
      rowsExpected.length,
      { timeoutMs: 8000, pollMs: Math.max(100, stepDelayMs), signal }
    );
    emitDiagnostic(onLog, 'SOOMAR_APPROVAL_ROWS_READY', 'Grade da aprovação carregada para conferência.', {
      actual: approvalRows.length,
      expected: rowsExpected.length,
      items: approvalRows.map((row) => row.item)
    });
    const validation = validateSoomarApprovalRows(approvalRows, rowsExpected);
    emitDiagnostic(onLog, 'SOOMAR_APPROVAL_ROWS_VALIDATED', 'Linhas da janela de aprovação comparadas com as despesas enviadas.', validation);
    if (!validation.ok) {
      throw new Error('Soomar: as despesas exibidas para aprovação não correspondem exatamente às despesas enviadas (' + String(validation.reason || 'divergência') + ').');
    }

    for (let index = 0; index < approvalRows.length; index++) {
      throwIfAborted(signal);
      approvalRows = getSoomarApprovalRows(source);
      const current = approvalRows[index];
      const item = formatSoomarGridItem(index);
      if (!current) throw new Error('Soomar: a despesa ' + item + ' desapareceu da janela de aprovação.');
      if (isSoomarApprovalCheckboxChecked(current)) continue;

      const previousBackground = String(current.checkboxBackground || '');
      onStatus('SOOMAR — marcando despesa ' + item + ' para aprovação...');
      if (!current.checkboxTarget || !await trustedDoubleThenFallback(current.checkboxTarget, item)) {
        throw new Error('Soomar: não foi possível aplicar o duplo clique na despesa ' + item + ' para aprovação.');
      }

      const checked = await waitForCondition(() => {
        const latestRows = getSoomarApprovalRows(source);
        const latest = latestRows[index];
        return !!latest && didSoomarApprovalCheckboxToggle(previousBackground, latest);
      }, 5000, Math.max(100, stepDelayMs), signal);
      if (!checked) throw new Error('Soomar: a checkbox da despesa ' + item + ' não confirmou a marcação após o duplo clique.');
    }

    const finalRows = getSoomarApprovalRows(source);
    if (!finalRows.length || finalRows.some((row) => !isSoomarApprovalCheckboxChecked(row))) {
      throw new Error('Soomar: nem todas as despesas permaneceram marcadas para aprovação.');
    }

    emitDiagnostic(onLog, 'SOOMAR_APPROVAL_SELECTION_READY', 'Todas as despesas foram marcadas para aprovação; botão Ok não foi acionado.', {
      total: finalRows.length, items: finalRows.map((row) => row.item)
    });
    onStatus('SOOMAR — ' + finalRows.length + ' despesa(s) marcada(s) para aprovação.');
    return { ok: true, total: finalRows.length, items: finalRows.map((row) => row.item) };
  }


  function collectRoots(root, visited) {
    visited = visited || new Set();
    if (!root || visited.has(root)) return [];
    visited.add(root);

    const roots = [root];
    let nodes = [];
    try { nodes = Array.from(root.querySelectorAll('*')); } catch (_) {}

    for (const el of nodes) {
      try {
        if (el.shadowRoot) roots.push(...collectRoots(el.shadowRoot, visited));
      } catch (_) {}
      try {
        if (el.tagName === 'IFRAME' && el.contentDocument) {
          roots.push(...collectRoots(el.contentDocument, visited));
        }
      } catch (_) {}
    }
    return roots;
  }

  function getElementTextData(el) {
    if (!el) return {};
    let title = '';
    let caption = '';
    let text = '';
    let value = '';
    let ariaLabel = '';

    try { title = el.getAttribute('title') || ''; } catch (_) {}
    try { caption = el.getAttribute('caption') || ''; } catch (_) {}
    try { ariaLabel = el.getAttribute('aria-label') || ''; } catch (_) {}
    try { value = el.getAttribute('value') || el.value || ''; } catch (_) {}
    try { text = el.innerText || el.textContent || ''; } catch (_) {}

    return { title, caption, text, value, ariaLabel };
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      if (el.hidden || el.getAttribute('hidden') !== null) return false;
    } catch (_) {}

    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
      return true;
    }

    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (_) {
      return true;
    }
  }

  function parseProtheusNumber(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return 0;
    const normalized = text.replace(/\./g, '').replace(',', '.').replace(/[^0-9+\-.]/g, '');
    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function parseProtheusMoneyToCents(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return 0;

    const negative = /^\s*-/.test(raw) || /^\s*\(.*\)\s*$/.test(raw);
    const cleaned = raw.replace(/[^0-9,]/g, '');
    if (!cleaned) return 0;

    const commaIndex = cleaned.lastIndexOf(',');
    let integerPart = commaIndex >= 0 ? cleaned.slice(0, commaIndex) : cleaned;
    let decimalPart = commaIndex >= 0 ? cleaned.slice(commaIndex + 1) : '';
    integerPart = integerPart.replace(/\D/g, '') || '0';
    decimalPart = (decimalPart.replace(/\D/g, '') + '00').slice(0, 2);

    const cents = (Number.parseInt(integerPart, 10) * 100) + Number.parseInt(decimalPart, 10);
    if (!Number.isSafeInteger(cents)) return 0;
    return negative ? -cents : cents;
  }

  function getTableHeaderMap(table) {
    if (!table) return null;
    let headers = [];
    try { headers = Array.from(table.querySelectorAll('thead th')); } catch (_) {}
    if (!headers.length) return null;

    const texts = headers.map((header) => normalizeText(getNodeText(header)));
    const indexOf = function (aliases) {
      const wanted = (aliases || []).map(normalizeText);
      return texts.findIndex((text) => wanted.includes(text));
    };

    return { headers, texts, indexOf };
  }

  function findCommissionMainTables(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const candidates = [];
    const seen = new Set();

    for (const root of roots) {
      let tables = [];
      try { tables = Array.from(root.querySelectorAll('table')); } catch (_) {}
      for (const table of tables) {
        if (!table || seen.has(table)) continue;
        seen.add(table);
        const map = getTableHeaderMap(table);
        if (!map) continue;
        const idGroupIndex = map.indexOf(['id grupo']);
        const quantityIndex = map.indexOf(['qt.lotes']);
        const openIndex = map.indexOf(['vl.aberto']);
        const approvedIndex = map.indexOf(['vl.aprovado']);
        const sentPaymentIndex = map.indexOf(['vl.env.pagto']);
        if ([idGroupIndex, quantityIndex, openIndex, approvedIndex, sentPaymentIndex].some((index) => index < 0)) continue;
        if (!isElementStateActive(table)) continue;
        candidates.push({ table, map, idGroupIndex, quantityIndex, openIndex, approvedIndex, sentPaymentIndex });
      }
    }

    return candidates;
  }

  function findCommissionMainTable(doc) {
    const candidates = findCommissionMainTables(doc || document);
    return candidates.length ? candidates[0] : null;
  }

  function isTableRowSelected(row) {
    if (!row) return false;
    try { if (row.classList && row.classList.contains('selected-row')) return true; } catch (_) {}
    try { if (/(^|\s)selected-row(\s|$)/.test(String(row.getAttribute('class') || row.className || ''))) return true; } catch (_) {}
    try { if (row.querySelector && row.querySelector('td.selected-cell')) return true; } catch (_) {}
    return false;
  }

  function getBrowseSelectionActionTarget(cell) {
    if (!cell) return null;
    try {
      const label = cell.querySelector && cell.querySelector('label');
      if (label && isElementActive(label)) return label;
    } catch (_) {}
    try {
      const nested = cell.querySelector && cell.querySelector('div,span');
      if (nested && isElementActive(nested)) return nested;
    } catch (_) {}
    return cell;
  }

  function dispatchBrowseSelectionGesture(cell) {
    if (!cell || !isElementActive(cell)) return false;
    const target = getBrowseSelectionActionTarget(cell);
    if (!target) return false;

    try {
      if (typeof cell.scrollIntoView === 'function') {
        cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    } catch (_) {}

    let rect = null;
    try { rect = target.getBoundingClientRect && target.getBoundingClientRect(); } catch (_) {}
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      try { rect = cell.getBoundingClientRect && cell.getBoundingClientRect(); } catch (_) {}
    }

    const clientX = rect && Number.isFinite(rect.left) && Number.isFinite(rect.width) ? rect.left + (rect.width / 2) : 0;
    const clientY = rect && Number.isFinite(rect.top) && Number.isFinite(rect.height) ? rect.top + (rect.height / 2) : 0;
    const view = getElementView(target);
    const MouseCtor = view && view.MouseEvent ? view.MouseEvent : (typeof MouseEvent !== 'undefined' ? MouseEvent : null);
    const PointerCtor = view && view.PointerEvent ? view.PointerEvent : (typeof PointerEvent !== 'undefined' ? PointerEvent : null);
    if (!MouseCtor && !PointerCtor) return false;

    try { if (typeof target.focus === 'function') target.focus({ preventScroll: true }); } catch (_) {
      try { if (typeof target.focus === 'function') target.focus(); } catch (_) {}
    }

    const mouseInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: view || null,
      detail: 1,
      button: 0,
      buttons: 1,
      clientX,
      clientY
    };
    const upInit = Object.assign({}, mouseInit, { buttons: 0 });

    try {
      if (PointerCtor) target.dispatchEvent(new PointerCtor('pointerdown', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, mouseInit)));
      if (MouseCtor) target.dispatchEvent(new MouseCtor('mousedown', mouseInit));
      if (PointerCtor) target.dispatchEvent(new PointerCtor('pointerup', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, upInit)));
      if (MouseCtor) target.dispatchEvent(new MouseCtor('mouseup', upInit));
      if (MouseCtor) target.dispatchEvent(new MouseCtor('click', upInit));
      return true;
    } catch (_) {
      return false;
    }
  }

  function getCommissionApprovalRowInfo(doc, groupValue) {
    const tables = findCommissionMainTables(doc || document);
    if (!tables.length) return null;
    const wanted = normalizeText(groupValue);

    for (const tableInfo of tables) {
      let rows = [];
      try { rows = Array.from(tableInfo.table.querySelectorAll('tbody tr')); } catch (_) {}

      for (const row of rows) {
        let cells = [];
        try { cells = Array.from(row.querySelectorAll('td')); } catch (_) {}
        const maxIndex = Math.max(
          tableInfo.idGroupIndex,
          tableInfo.quantityIndex,
          tableInfo.openIndex,
          tableInfo.approvedIndex,
          tableInfo.sentPaymentIndex
        );
        if (cells.length <= maxIndex) continue;
        const group = normalizeText(getNodeText(cells[tableInfo.idGroupIndex]));
        if (group !== wanted) continue;

        return {
          found: true,
          group: String(groupValue),
          quantity: Math.max(0, parseProtheusNumber(getNodeText(cells[tableInfo.quantityIndex]))),
          openCents: parseProtheusMoneyToCents(getNodeText(cells[tableInfo.openIndex])),
          approvedCents: parseProtheusMoneyToCents(getNodeText(cells[tableInfo.approvedIndex])),
          sentPaymentCents: parseProtheusMoneyToCents(getNodeText(cells[tableInfo.sentPaymentIndex])),
          selected: isTableRowSelected(row),
          row,
          // O browse do Protheus registra a selecao a partir da celula clicada.
          // Usamos Vl.Aberto como alvo preferencial porque e uma celula de dados
          // visivel e evita a coluna de indicador/icone.
          selectCell: cells[tableInfo.openIndex] || cells[tableInfo.idGroupIndex] || row
        };
      }
    }

    return { found: false, group: String(groupValue) };
  }

  function getPendingCommissionApprovalGroups(doc, groupValues) {
    const groups = Array.from(groupValues || []);
    const pending = [];
    for (const group of groups) {
      const info = getCommissionApprovalRowInfo(doc || document, group);
      if (info && info.found && info.openCents > 0) pending.push(info);
    }
    return pending;
  }

  function findUniqueActiveWaButton(doc, predicate) {
    const source = doc || document;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let buttons = [];
      try { buttons = Array.from(root.querySelectorAll('wa-button')); } catch (_) {}
      for (const button of buttons) {
        if (!button || seen.has(button)) continue;
        seen.add(button);
        if (!isElementStateActive(button) || isControlLocked(button)) continue;
        let ok = false;
        try { ok = !!predicate(button); } catch (_) {}
        if (ok) matches.push(button);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function findCommissionApproveButton(doc) {
    return findUniqueActiveWaButton(doc || document, (button) => {
      const caption = normalizeText(button.getAttribute && button.getAttribute('caption'));
      const title = normalizeText(button.getAttribute && button.getAttribute('title'));
      const advpl = normalizeText(button.getAttribute && button.getAttribute('data-advpl'));
      return caption === 'aprovar' && title === 'aprova cálculo de comissão' && advpl === 'tbutton';
    });
  }

  function findApprovalLotTable(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const matches = [];
    for (const root of roots) {
      let tables = [];
      try { tables = Array.from(root.querySelectorAll('table')); } catch (_) {}
      for (const table of tables) {
        const map = getTableHeaderMap(table);
        if (!map) continue;
        if (map.indexOf(['selecione lote']) < 0) continue;
        if (!isElementStateActive(table)) continue;
        matches.push(table);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function getApprovalLotRows(doc) {
    const table = findApprovalLotTable(doc || document);
    if (!table) return [];
    try { return Array.from(table.querySelectorAll('tbody tr')); } catch (_) { return []; }
  }

  function getUncheckedApprovalLotCheckboxes(doc) {
    const rows = getApprovalLotRows(doc || document);
    const unchecked = [];
    for (const row of rows) {
      let cells = [];
      try { cells = Array.from(row.querySelectorAll('td')); } catch (_) {}
      if (!cells.length) continue;
      let imageCell = null;
      try { imageCell = cells[0].querySelector('.image-cell'); } catch (_) {}
      if (!imageCell) continue;
      let styleText = '';
      try { styleText = String(imageCell.getAttribute('style') || ''); } catch (_) {}
      try { styleText += ' ' + String((imageCell.style && imageCell.style.backgroundImage) || ''); } catch (_) {}
      if (normalizeText(styleText).includes('lbno_mdi.png')) unchecked.push(imageCell);
    }
    return unchecked;
  }

  function findApprovalMarkAllButton(doc) {
    return findUniqueActiveWaButton(doc || document, (button) => {
      const caption = normalizeText(button.getAttribute && button.getAttribute('caption'));
      return caption === 'marca todos - <f4>' || caption === 'marca todos' || caption.startsWith('marca todos -');
    });
  }

  async function markAllApprovalLots(doc, options) {
    const source = doc || document;
    const opts = options || {};
    const signal = opts.signal;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const pollMs = Math.max(25, Number(opts.pollMs) || ACTION_EFFECT_POLL_MS);
    const timeoutMs = Math.max(100, Number(opts.timeoutMs) || ACTION_EFFECT_TIMEOUT_MS);
    const rows = getApprovalLotRows(source);
    const total = rows.length;
    if (total <= 0) throw new Error('A janela de aprovação não apresentou nenhum lote para selecionar.');

    throwIfAborted(signal);
    const uncheckedBefore = getUncheckedApprovalLotCheckboxes(source).length;
    if (uncheckedBefore === 0) return { total, selected: total };

    const markAllButton = findApprovalMarkAllButton(source);
    if (!markAllButton) {
      throw new Error('O botão nativo Marca Todos da janela de aprovação não foi encontrado de forma segura.');
    }

    emitDiagnostic(onLog, 'APPROVAL_MARK_ALL', 'Acionando o comando nativo Marca Todos do Protheus.', {
      total,
      uncheckedBefore,
      selectedBefore: Math.max(0, total - uncheckedBefore),
      target: describeActionTarget(markAllButton)
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfAborted(signal);
      emitDiagnostic(onLog, 'APPROVAL_MARK_ALL_GESTURE', 'Enviando gesto completo ao botão Marca Todos do Protheus.', {
        attempt,
        target: describeActionTarget(markAllButton)
      });

      if (!dispatchWaButtonGesture(markAllButton)) {
        if (attempt >= 3) throw new Error('Não foi possível acionar o botão Marca Todos da janela de aprovação.');
        await abortableSleep(250, signal);
        continue;
      }

      const allSelected = await waitForCondition(
        () => getUncheckedApprovalLotCheckboxes(source).length === 0,
        timeoutMs,
        pollMs,
        signal
      );

      if (allSelected) {
        emitDiagnostic(onLog, 'APPROVAL_MARK_ALL_CONFIRMED', 'Todos os lotes ficaram marcados pelo comando nativo do Protheus.', {
          total,
          selected: total,
          attempt
        });
        return { total, selected: total };
      }

      const uncheckedAfter = getUncheckedApprovalLotCheckboxes(source).length;
      emitDiagnostic(onLog, attempt < 3 ? 'APPROVAL_MARK_ALL_RETRY' : 'APPROVAL_MARK_ALL_FAIL', attempt < 3
        ? 'O primeiro gesto não marcou todos os lotes; repetindo o mesmo comando idempotente.'
        : 'O comando Marca Todos foi acionado, mas ainda existem lotes desmarcados.', {
        total,
        uncheckedBefore,
        uncheckedAfter,
        selectedAfter: Math.max(0, total - uncheckedAfter),
        attempt
      });

      if (attempt < 3) await abortableSleep(250, signal);
    }

    throw new Error('O Protheus não confirmou a seleção de todos os lotes após o comando Marca Todos.');
  }

  function findApprovalConfirmButton(doc) {
    return findUniqueActiveWaButton(doc || document, (button) => {
      const caption = normalizeText(button.getAttribute && button.getAttribute('caption'));
      const advpl = normalizeText(button.getAttribute && button.getAttribute('data-advpl'));
      return caption === 'confirmar' && advpl === 'tbrowsebutton';
    });
  }

  function findApprovalProcessingDialog(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();
    const wantedTitle = 'processamento de lotes de comissão - encerramento';

    for (const root of roots) {
      let dialogs = [];
      try { dialogs = Array.from(root.querySelectorAll('wa-dialog')); } catch (_) {}
      for (const dialog of dialogs) {
        if (!dialog || seen.has(dialog)) continue;
        seen.add(dialog);
        const title = normalizeText(dialog.getAttribute && dialog.getAttribute('title'));
        let opened = false;
        try {
          opened = typeof dialog.hasAttribute === 'function'
            ? dialog.hasAttribute('opened')
            : dialog.getAttribute('opened') !== null;
        } catch (_) {}
        if (title !== wantedTitle || !opened || !isElementStateActive(dialog)) continue;
        matches.push(dialog);
      }
    }

    return matches.length === 1 ? matches[0] : null;
  }

  function findApprovalProcessingConfirmButton(doc) {
    const dialog = findApprovalProcessingDialog(doc || document);
    if (!dialog) return null;

    const roots = collectRoots(dialog);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let buttons = [];
      try { buttons = Array.from(root.querySelectorAll('wa-button')); } catch (_) {}
      for (const button of buttons) {
        if (!button || seen.has(button)) continue;
        seen.add(button);
        if (!isElementStateActive(button) || isControlLocked(button)) continue;
        const caption = normalizeText(button.getAttribute && button.getAttribute('caption'));
        const advpl = normalizeText(button.getAttribute && button.getAttribute('data-advpl'));
        if (caption === 'confirmar' && advpl === 'tbrowsebutton') matches.push(button);
      }
    }

    if (matches.length === 1) return matches[0];
    const exact = matches.filter((button) => String(button.id || '') === 'COMP7507');
    return exact.length === 1 ? exact[0] : null;
  }

  function isCommissionApprovalTransitionComplete(before, after) {
    if (!before || !after || !after.found) return false;
    if (before.openCents <= 0) return after.openCents === 0;
    return after.openCents === 0 &&
      after.approvedCents === before.approvedCents + before.openCents &&
      after.sentPaymentCents === before.sentPaymentCents + before.openCents;
  }

  async function waitForApprovalFinancialUpdate(doc, groupValue, beforeInfo, options) {
    const source = doc || document;
    const opts = options || {};
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const signal = opts.signal;
    const timeoutMs = Math.max(100, Number(opts.timeoutMs) || APPROVAL_UPDATE_TIMEOUT_MS);
    const pollMs = Math.max(25, Number(opts.pollMs) || 500);
    const readGroup = typeof opts.readGroup === 'function'
      ? opts.readGroup
      : (value) => getCommissionApprovalRowInfo(source, value);

    let processingConfirmed = false;
    let afterInfo = null;
    let deadlineAt = Date.now() + timeoutMs;

    for (;;) {
      throwIfAborted(signal);

      if (!processingConfirmed) {
        const processingDialog = findApprovalProcessingDialog(source);
        if (processingDialog) {
          const confirmButton = findApprovalProcessingConfirmButton(source);
          if (!confirmButton) {
            throw new Error('Grupo ' + groupValue + ': a janela de processamento foi exibida, mas o botão Confirmar não foi encontrado de forma segura.');
          }

          onStatus('APROVAÇÃO — Grupo ' + groupValue + ': processamento concluído; confirmando resultado dos lotes...');
          emitDiagnostic(onLog, 'APPROVAL_PROCESSING_DIALOG', 'Janela adicional de processamento detectada após a aprovação.', {
            group: groupValue,
            dialogId: String(processingDialog.id || ''),
            target: describeActionTarget(confirmButton)
          });
          emitDiagnostic(onLog, 'APPROVAL_PROCESSING_CONFIRM', 'Confirmando a janela de processamento dos lotes.', {
            group: groupValue,
            target: describeActionTarget(confirmButton)
          });

          if (!dispatchWaButtonGesture(confirmButton)) {
            throw new Error('Grupo ' + groupValue + ': não foi possível acionar o Confirmar da janela de processamento.');
          }

          const closed = await waitForCondition(
            () => !findApprovalProcessingDialog(source),
            15000,
            250,
            signal
          );
          if (!closed) {
            throw new Error('Grupo ' + groupValue + ': o Protheus não fechou a janela de processamento após Confirmar.');
          }

          processingConfirmed = true;
          deadlineAt = Date.now() + timeoutMs;
          emitDiagnostic(onLog, 'APPROVAL_PROCESSING_CONFIRM_CONFIRMED', 'Janela adicional de processamento confirmada e fechada.', {
            group: groupValue
          });
          onStatus('APROVAÇÃO — Grupo ' + groupValue + ': aguardando atualização dos valores...');
        }
      }

      afterInfo = await Promise.resolve(readGroup(groupValue));
      if (isCommissionApprovalTransitionComplete(beforeInfo, afterInfo)) {
        return { updated: true, afterInfo, processingConfirmed };
      }

      const now = Date.now();
      if (now >= deadlineAt) {
        return { updated: false, afterInfo, processingConfirmed };
      }

      await abortableSleep(Math.min(pollMs, Math.max(25, deadlineAt - now)), signal);
    }
  }

  async function processCommissionApprovalSequence(groupValues, options) {
    const groups = Array.from(groupValues || []);
    const opts = options || {};
    const readGroup = typeof opts.readGroup === 'function' ? opts.readGroup : async function () { return null; };
    const approveGroup = typeof opts.approveGroup === 'function' ? opts.approveGroup : async function () { return { ok: true }; };
    const onSkip = typeof opts.onSkip === 'function' ? opts.onSkip : function () {};
    const onGroupStart = typeof opts.onGroupStart === 'function' ? opts.onGroupStart : function () {};
    const results = [];

    for (let index = 0; index < groups.length; index++) {
      const group = String(groups[index]);
      const total = groups.length;
      await onGroupStart(group, index, total);
      const info = await readGroup(group, index, total);
      if (!info || !info.found) {
        const missingInfo = info || { group, found: false, openCents: 0 };
        await onSkip(group, missingInfo, index, total);
        results.push({ group, skipped: true, approved: false, openCents: 0, reason: 'missing' });
        continue;
      }
      if (info.openCents < 0) throw new Error('Grupo ' + group + ': Vl.Aberto negativo não será aprovado automaticamente.');

      if (info.openCents === 0) {
        await onSkip(group, info, index, total);
        results.push({ group, skipped: true, approved: false, openCents: 0, reason: 'zero-open' });
        continue;
      }

      const result = await approveGroup(group, info, index, total);
      results.push(Object.assign({ group, skipped: false, approved: true, openCents: info.openCents }, result || {}));
    }

    return results;
  }

  function getNodeText(node) {
    if (!node) return '';
    try { if (node.innerText != null) return String(node.innerText); } catch (_) {}
    try { if (node.textContent != null) return String(node.textContent); } catch (_) {}
    return '';
  }

  function getExistingCommissionLotInfo(doc, groupValue) {
    const source = doc || document;
    const wantedGroup = normalizeText(groupValue);
    const roots = collectRoots(source);
    let sawCompatibleTable = false;
    let fallback = null;

    for (const root of roots) {
      let tables = [];
      try { tables = Array.from(root.querySelectorAll('table')); } catch (_) {}

      for (const table of tables) {
        let headers = [];
        try { headers = Array.from(table.querySelectorAll('thead th')); } catch (_) {}
        if (!headers.length) continue;

        const headerTexts = headers.map((header) => normalizeText(getNodeText(header)));
        const idGroupIndex = headerTexts.findIndex((text) => text === 'id grupo');
        const groupNameIndex = headerTexts.findIndex((text) => text === 'grupo comissão' || text === 'grupo comissao');
        const quantityIndex = headerTexts.findIndex((text) => text === 'qt.lotes');
        if (idGroupIndex < 0 || groupNameIndex < 0 || quantityIndex < 0) continue;
        if (!isElementStateActive(table)) continue;

        sawCompatibleTable = true;
        let rows = [];
        try { rows = Array.from(table.querySelectorAll('tbody tr')); } catch (_) {}

        let found = false;
        let quantity = 0;
        for (const row of rows) {
          let cells = [];
          try { cells = Array.from(row.querySelectorAll('td')); } catch (_) {}
          if (cells.length <= Math.max(idGroupIndex, quantityIndex)) continue;

          const groupId = normalizeText(getNodeText(cells[idGroupIndex]));
          if (groupId !== wantedGroup) continue;
          found = true;
          quantity += Math.max(0, parseProtheusNumber(getNodeText(cells[quantityIndex])));
        }

        const current = {
          found,
          quantity,
          alreadyGenerated: found && quantity > 0
        };
        if (current.alreadyGenerated) return current;
        if (current.found || !fallback) fallback = current;
      }
    }

    return sawCompatibleTable ? (fallback || { found: false, quantity: 0, alreadyGenerated: false }) : null;
  }


  async function processCommissionGroupSequence(groupValues, options) {
    const groups = Array.from(groupValues || []);
    const opts = options || {};
    const checkGroup = typeof opts.checkGroup === 'function' ? opts.checkGroup : async function () { return { found: false, quantity: 0, alreadyGenerated: false }; };
    const generateGroup = typeof opts.generateGroup === 'function' ? opts.generateGroup : async function () { return { ok: true }; };
    const onSkip = typeof opts.onSkip === 'function' ? opts.onSkip : function () {};
    const onGroupStart = typeof opts.onGroupStart === 'function' ? opts.onGroupStart : function () {};
    const results = [];

    for (let index = 0; index < groups.length; index++) {
      const group = String(groups[index]);
      const total = groups.length;
      await onGroupStart(group, index, total);
      const existingLot = await checkGroup(group, index, total);

      if (existingLot && existingLot.alreadyGenerated) {
        await onSkip(group, existingLot, index, total);
        results.push({
          group,
          skipped: true,
          quantity: Math.max(0, Number(existingLot.quantity) || 0),
          alreadyGenerated: true
        });
        continue;
      }

      const generated = await generateGroup(group, index, total);
      results.push(Object.assign({
        group,
        skipped: false,
        alreadyGenerated: false
      }, generated || {}));
    }

    return results;
  }

  function findElementByText(doc, needles, selector) {
    const roots = collectRoots(doc || document);
    const query = selector || 'wa-button,button,input,a,wa-text-view,wa-text-input,[title],[caption],[aria-label],[value]';

    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(query)); } catch (_) {}

      for (const el of nodes) {
        if (!isElementActive(el)) continue;
        if (matchesAnyText(getElementTextData(el), needles)) return el;
      }
    }

    return null;
  }

  function findPainelComissoesPagar(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const wanted = normalizeText(TARGET_PANEL);
    const matches = [];
    const seen = new Set();

    for (const root of roots) {
      let nodes = [];
      try {
        nodes = Array.from(root.querySelectorAll('wa-text-view[data-advpl="tsay"],wa-text-view[title],wa-text-view[caption]'));
      } catch (_) {}

      for (const el of nodes) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (!isElementActive(el)) continue;

        let tag = '';
        let advpl = '';
        let title = '';
        let caption = '';
        try { tag = String(el.tagName || '').toUpperCase(); } catch (_) {}
        try { advpl = normalizeText(el.getAttribute && el.getAttribute('data-advpl')); } catch (_) {}
        try { title = normalizeText(el.getAttribute && el.getAttribute('title')); } catch (_) {}
        try { caption = normalizeText(el.getAttribute && el.getAttribute('caption')).replace(/^[•·\-\s]+/, '').trim(); } catch (_) {}

        if (tag !== 'WA-TEXT-VIEW') continue;
        if (advpl && advpl !== 'tsay') continue;
        if (title === wanted || caption === wanted) matches.push(el);
      }
    }

    if (matches.length > 1) {
      const exact = matches.filter((el) => {
        try {
          return normalizeText(el.getAttribute('title')) === wanted &&
            normalizeText(el.getAttribute('caption')).replace(/^[•·\-\s]+/, '').trim() === wanted;
        } catch (_) {
          return false;
        }
      });
      if (exact.length === 1) return exact[0];
      return null;
    }

    return matches[0] || null;
  }

  function normalizeActionCaption(value) {
    return normalizeText(value).replace(/[<>]+/g, '').replace(/\s+/g, ' ').trim();
  }

  function findProtheusButtonByCaption(doc, label) {
    const source = doc || document;
    const roots = collectRoots(source);
    const wanted = normalizeActionCaption(label);
    const matches = [];
    const seen = new Set();

    for (const root of roots) {
      let nodes = [];
      // Primeiro identificamos o componente Protheus pelo caption do host.
      // O <button> interno será resolvido apenas no momento do clique, evitando
      // contar host + Shadow DOM como dois controles diferentes.
      try { nodes = Array.from(root.querySelectorAll('wa-button[caption]')); } catch (_) {}
      for (const el of nodes) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (!isElementActive(el)) continue;
        if (isControlLocked(el)) continue;

        let caption = '';
        let text = '';
        let value = '';
        try { caption = el.getAttribute ? el.getAttribute('caption') || '' : ''; } catch (_) {}
        try { text = el.innerText || el.textContent || ''; } catch (_) {}
        try { value = el.getAttribute ? el.getAttribute('value') || '' : (el.value || ''); } catch (_) {}

        const candidates = [caption, text, value].map(normalizeActionCaption).filter(Boolean);
        if (candidates.some((candidate) => candidate === wanted || candidate.includes(wanted))) matches.push(el);
      }
    }

    return matches.length === 1 ? matches[0] : null;
  }

  function findLoteManualButton(doc) {
    return findProtheusButtonByCaption(doc || document, TARGET_LOTE_MANUAL) ||
      findElementByText(doc || document, [TARGET_LOTE_MANUAL], 'wa-button,button,input,[title],[caption],[value]');
  }

  function isCommissionPanelReady(currentDoc) {
    const source = currentDoc || document;
    try {
      if (getExistingCommissionLotInfo(source, COMMISSION_GROUP_VALUES[0]) !== null) return true;
    } catch (_) {}
    return !!findLoteManualButton(source);
  }

  function findAvancarButton(doc) {
    return findProtheusButtonByCaption(doc || document, TARGET_AVANCAR) ||
      findElementByText(doc || document, [TARGET_AVANCAR], 'wa-button,button,input,[title],[caption],[value]');
  }

  function getRenderedText(el) {
    if (!el) return '';
    try {
      if ('innerText' in el) return el.innerText || '';
    } catch (_) {}
    try { return el.textContent || ''; } catch (_) {}
    return '';
  }

  function getElementView(el) {
    try {
      if (el && el.ownerDocument && el.ownerDocument.defaultView) return el.ownerDocument.defaultView;
    } catch (_) {}
    try { if (typeof window !== 'undefined') return window; } catch (_) {}
    return null;
  }

  function getComposedParentForState(node) {
    if (!node) return null;
    try { if (node.parentElement) return node.parentElement; } catch (_) {}
    try {
      const root = node.getRootNode && node.getRootNode();
      if (root && root.host) return root.host;
    } catch (_) {}
    return null;
  }

  // "Ativo" para controles de automacao significa montado e renderizado pelo
  // Protheus. Nao exige estar dentro da viewport: o WebApp usa areas rolaveis e
  // muitos controles validos ficam fora da parte atualmente visivel da tela.
  // Tambem nao depende de foco, document.hidden ou aplicativo em primeiro plano.
  function isElementActive(el) {
    if (!el) return false;
    try { if (typeof el.isConnected === 'boolean' && !el.isConnected) return false; } catch (_) {}
    const view = getElementView(el);

    let current = el;
    for (let depth = 0; current && depth < 40; depth++) {
      try {
        if (current.hidden === true) return false;
        if (current.getAttribute) {
          if (current.getAttribute('hidden') !== null) return false;
          if (normalizeText(current.getAttribute('aria-hidden')) === 'true') return false;
          if (current.getAttribute('inert') !== null) return false;
        }
      } catch (_) {}

      let style = null;
      try {
        if (view && typeof view.getComputedStyle === 'function') style = view.getComputedStyle(current);
      } catch (_) {}
      if (!style) {
        try { style = current.style || null; } catch (_) {}
      }

      if (style) {
        try {
          const display = normalizeText(style.display);
          const visibility = normalizeText(style.visibility);
          const contentVisibility = normalizeText(style.contentVisibility || style['content-visibility']);
          const opacity = Number.parseFloat(style.opacity);
          if (display === 'none') return false;
          if (visibility === 'hidden' || visibility === 'collapse') return false;
          if (contentVisibility === 'hidden') return false;
          if (Number.isFinite(opacity) && opacity <= 0.001) return false;
        } catch (_) {}
      }

      current = getComposedParentForState(current);
    }

    try {
      if (typeof el.getBoundingClientRect === 'function') {
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      }
    } catch (_) {}

    return true;
  }

  // Marcadores de estado transitório (Gerando composição, Log, Atualizando
  // Listagem) precisam de uma regra mais restrita. O Protheus pode manter
  // janelas antigas montadas fora da área visível; para esses marcadores, fora
  // da viewport significa estado INATIVO. Essa regra NAO e usada para botoes,
  // campos ou itens de menu.
  function isElementStateActive(el) {
    if (!isElementActive(el)) return false;
    const view = getElementView(el);
    try {
      if (typeof el.getBoundingClientRect === 'function') {
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        if (view) {
          const width = Number(view.innerWidth);
          const height = Number(view.innerHeight);
          if (Number.isFinite(width) && width > 0 && (rect.right <= 0 || rect.left >= width)) return false;
          if (Number.isFinite(height) && height > 0 && (rect.bottom <= 0 || rect.top >= height)) return false;
        }
      }
    } catch (_) {}
    return true;
  }

  function findTextMarkerInternal(doc, needle, options) {
    const source = doc || document;
    const opts = options || {};
    const requireActive = opts.requireActive === true;
    const preferLeaf = opts.preferLeaf === true;
    const useRenderedText = opts.useRenderedText !== false;
    const roots = collectRoots(source);
    const query = 'wa-text-view,label,span,div,[title],[caption]';
    const wanted = normalizeText(needle);
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(query)); } catch (_) {}

      const matches = [];
      for (const el of nodes) {
        const data = getElementTextData(el);
        let text = '';
        if (useRenderedText) {
          text = getRenderedText(el);
        } else {
          try { text = el.textContent || el.innerText || ''; } catch (_) {}
        }

        const candidates = [
          { value: data.title, weight: -1000 },
          { value: data.caption, weight: -900 },
          { value: text, weight: 0 }
        ];

        let score = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
          const normalized = normalizeText(candidate.value);
          if (!normalized || !normalized.includes(wanted)) continue;
          score = Math.min(score, candidate.weight + normalized.length);
        }
        if (!Number.isFinite(score)) continue;
        matches.push({ el, score, active: isElementStateActive(el) });
      }

      let inheritedAncestors = null;
      if (preferLeaf && matches.length > 1) {
        const matchedElements = new Set(matches.map((item) => item.el));
        inheritedAncestors = new Set();
        for (const item of matches) {
          let current = getComposedParentForState(item.el);
          for (let depth = 0; current && depth < 30; depth++) {
            if (matchedElements.has(current)) inheritedAncestors.add(current);
            current = getComposedParentForState(current);
          }
        }
      }

      for (const item of matches) {
        if (requireActive && !item.active) continue;
        // Evita falso positivo em ancestrais visiveis cujo texto vem apenas
        // de um marcador filho que ja esta oculto. Isso era o que deixava
        // "Atualizando Listagem" preso em ATIVO depois do popup sumir.
        if (inheritedAncestors && inheritedAncestors.has(item.el)) continue;
        if (item.score < bestScore) {
          best = item.el;
          bestScore = item.score;
        }
      }
    }

    return best;
  }

  function findActiveTextMarker(doc, needle, options) {
    const opts = Object.assign({}, options || {}, { requireActive: true, useRenderedText: true });
    return findTextMarkerInternal(doc || document, needle, opts);
  }

  function findTextMarkerAnyState(doc, needle, options) {
    const opts = Object.assign({}, options || {}, { requireActive: false, useRenderedText: false });
    return findTextMarkerInternal(doc || document, needle, opts);
  }

  function findBestTextMarker(doc, needle) {
    return findActiveTextMarker(doc || document, needle);
  }

  function findProcessingWindowMarker(doc) {
    return findActiveTextMarker(doc || document, PROCESSING_WINDOW_TEXT);
  }

  function findCommissionLogMarker(doc) {
    return findActiveTextMarker(doc || document, LOG_WINDOW_TEXT);
  }

  function findUpdatingListMarker(doc) {
    return findActiveTextMarker(doc || document, UPDATING_WINDOW_TEXT, { preferLeaf: true });
  }

  function nodeContainsText(node, needle) {
    if (!node) return false;
    const wanted = normalizeText(needle);
    if (!wanted) return false;

    let text = '';
    let title = '';
    let caption = '';
    try { text = node.textContent || node.innerText || ''; } catch (_) {}
    try { title = node.getAttribute ? node.getAttribute('title') || '' : ''; } catch (_) {}
    try { caption = node.getAttribute ? node.getAttribute('caption') || '' : ''; } catch (_) {}

    return [text, title, caption].some((value) => normalizeText(value).includes(wanted));
  }

  function nodeContainsRenderedText(node, needle) {
    if (!node) return false;
    const wanted = normalizeText(needle);
    if (!wanted) return false;

    let el = node;
    try {
      if (node.nodeType === 3 && node.parentElement) el = node.parentElement;
    } catch (_) {}

    try {
      if (el && el.getAttribute && !isElementStateActive(el)) return false;
    } catch (_) {}

    let title = '';
    let caption = '';
    try { title = el && el.getAttribute ? el.getAttribute('title') || '' : ''; } catch (_) {}
    try { caption = el && el.getAttribute ? el.getAttribute('caption') || '' : ''; } catch (_) {}
    const rendered = getRenderedText(el);

    return [rendered, title, caption].some((value) => normalizeText(value).includes(wanted));
  }

  function getComposedParent(node) {
    if (!node) return null;
    try { if (node.parentElement) return node.parentElement; } catch (_) {}
    try {
      const root = node.getRootNode && node.getRootNode();
      if (root && root.host) return root.host;
    } catch (_) {}
    return null;
  }

  function findScopedButtonByText(marker, label) {
    if (!marker) return null;
    const selector = 'wa-button,button,input,[title],[caption],[value]';
    let container = getComposedParent(marker) || marker;

    for (let depth = 0; container && depth < 14; depth++) {
      let nodes = [];
      try { nodes = Array.from(container.querySelectorAll(selector)); } catch (_) {}
      const matches = nodes.filter((el) => isElementActive(el) && matchesAnyText(getElementTextData(el), [label]));
      if (matches.length === 1) return matches[0];
      container = getComposedParent(container);
    }

    return null;
  }

  // O Cancelar do Log e um TBrowseButton do Protheus. Ele pode estar em um
  // ramo diferente do marcador textual do Log, portanto nao dependemos da
  // arvore de ancestrais do titulo para encontra-lo.
  function findLogCancelButton(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();

    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('wa-button[data-advpl="tbrowsebutton"]')); } catch (_) {}

      for (const el of nodes) {
        if (!el || seen.has(el)) continue;
        seen.add(el);

        let caption = '';
        let advpl = '';
        let className = '';
        try {
          caption = normalizeText(el.getAttribute('caption') || '');
          advpl = normalizeText(el.getAttribute('data-advpl') || '');
          className = normalizeText(el.getAttribute('class') || '');
        } catch (_) {}

        if (caption !== 'cancelar') continue;
        if (advpl !== 'tbrowsebutton') continue;
        if (className && !className.split(/\s+/).includes('dict-tbrowsebutton')) continue;
        if (!isElementActive(el)) continue;
        if (isControlLocked(el)) continue;
        matches.push(el);
      }
    }

    // Segurança: nunca adivinhar entre dois botoes Cancelar ativos.
    return matches.length === 1 ? matches[0] : null;
  }

  function isNodeConnected(node) {
    if (!node) return false;
    try {
      if (typeof node.isConnected === 'boolean') return node.isConnected;
    } catch (_) {}
    return true;
  }

  function getObserverCtor(source) {
    try {
      if (source && source.defaultView && source.defaultView.MutationObserver) return source.defaultView.MutationObserver;
    } catch (_) {}
    try { if (typeof MutationObserver !== 'undefined') return MutationObserver; } catch (_) {}
    return null;
  }

  // Watcher direcionado: depois de localizar o marcador, observa apenas o
  // proprio elemento e seus ancestrais. Isso evita observar o DOM inteiro do
  // Protheus e previne a degradacao progressiva de desempenho.
  function createElementStateWatcher(doc, needle, options) {
    const source = doc || document;
    const opts = options || {};
    const fallbackMs = Math.max(500, Number(opts.fallbackMs) || STATE_WATCH_FALLBACK_MS);
    const missingRescanMs = Math.max(500, Number(opts.missingRescanMs) || MARKER_MISSING_RESCAN_MS);
    const inactiveRescanMs = Math.max(1000, Number(opts.inactiveRescanMs) || MARKER_INACTIVE_RESCAN_MS);
    const ObserverCtor = getObserverCtor(source);
    const preferLeaf = opts.preferLeaf === true;

    let marker = null;
    let active = false;
    let initialized = false;
    let stopped = false;
    let lastSearchAt = 0;
    let timer = null;
    let observer = null;
    const transitions = [];
    const waiters = new Set();

    const notifyWaiters = () => {
      for (const waiter of Array.from(waiters)) {
        if (waiter.wanted !== active) continue;
        waiters.delete(waiter);
        try { waiter.cleanup(); } catch (_) {}
        waiter.resolve(marker || true);
      }
    };

    const recordState = (next) => {
      next = !!next;
      if (!initialized || next !== active) {
        active = next;
        initialized = true;
        transitions.push({ active: next, at: Date.now() });
        if (transitions.length > 40) transitions.splice(0, transitions.length - 40);
      }
      notifyWaiters();
    };

    const disconnectObserver = () => {
      if (!observer) return;
      try { observer.disconnect(); } catch (_) {}
      observer = null;
    };

    const attachTargetedObserver = () => {
      disconnectObserver();
      if (!ObserverCtor || !marker) return;
      try {
        observer = new ObserverCtor(() => {
          if (stopped) return;
          if (!isNodeConnected(marker)) {
            marker = null;
            recordState(false);
            return;
          }
          recordState(isElementStateActive(marker));
        });

        const targets = [];
        let current = marker;
        for (let depth = 0; current && depth < 18; depth++) {
          targets.push(current);
          current = getComposedParentForState(current);
        }

        for (const target of targets) {
          try {
            observer.observe(target, {
              attributes: true,
              attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'inert']
            });
          } catch (_) {}
        }

        // Texto/filhos somente no proprio marcador: escopo pequeno e barato.
        try {
          observer.observe(marker, { childList: true, subtree: true, characterData: true });
        } catch (_) {}
      } catch (_) {
        observer = null;
      }
    };

    const switchMarker = (nextMarker) => {
      if (nextMarker === marker) return;
      marker = nextMarker || null;
      attachTargetedObserver();
      recordState(marker ? isElementStateActive(marker) : false);
    };

    const searchMarker = (preferActive) => {
      lastSearchAt = Date.now();
      let found = null;
      if (preferActive) found = findActiveTextMarker(source, needle, { preferLeaf });
      if (!found) found = findTextMarkerAnyState(source, needle, { preferLeaf });
      if (found) switchMarker(found);
      else if (!marker || !isNodeConnected(marker)) switchMarker(null);
    };

    const evaluate = () => {
      if (stopped) return active;
      const now = Date.now();

      if (marker && !isNodeConnected(marker)) {
        switchMarker(null);
      }

      if (!marker) {
        if (now - lastSearchAt >= missingRescanMs) searchMarker(true);
      } else {
        recordState(isElementStateActive(marker));
        // Rescan raro apenas para trocar um clone antigo por um novo marcador ativo.
        if (!active && now - lastSearchAt >= inactiveRescanMs) {
          const activeCandidate = findActiveTextMarker(source, needle, { preferLeaf });
          lastSearchAt = now;
          if (activeCandidate && activeCandidate !== marker) switchMarker(activeCandidate);
        }
      }

      return active;
    };

    searchMarker(true);
    timer = setInterval(evaluate, fallbackMs);

    return {
      getMarker() {
        return marker;
      },
      isActive() {
        return active;
      },
      resetTransitions() {
        transitions.length = 0;
      },
      getTransitions() {
        return transitions.slice();
      },
      waitForState(wanted, signal) {
        wanted = !!wanted;
        throwIfAborted(signal);
        if (active === wanted) return Promise.resolve(marker || true);

        return new Promise((resolve, reject) => {
          const waiter = {
            wanted,
            resolve,
            reject,
            cleanup: function () {}
          };

          const onAbort = () => {
            waiters.delete(waiter);
            reject(makeAbortError());
          };
          waiter.cleanup = () => {
            if (signal && typeof signal.removeEventListener === 'function') {
              try { signal.removeEventListener('abort', onAbort); } catch (_) {}
            }
          };

          if (signal && typeof signal.addEventListener === 'function') {
            signal.addEventListener('abort', onAbort, { once: true });
          }
          waiters.add(waiter);
        });
      },
      disconnect() {
        stopped = true;
        if (timer) clearInterval(timer);
        disconnectObserver();
        for (const waiter of Array.from(waiters)) {
          waiters.delete(waiter);
          try { waiter.cleanup(); } catch (_) {}
          waiter.reject(makeAbortError('Watcher encerrado.'));
        }
      }
    };
  }

  function findCompletedActiveCycle(transitions, armedAt, gateAt) {
    let startAt = null;
    for (const transition of transitions || []) {
      if (transition.at < armedAt) continue;
      if (transition.active) {
        if (startAt == null) startAt = transition.at;
      } else if (startAt != null) {
        const endAt = transition.at;
        if (endAt >= gateAt) return { startAt, endAt };
        startAt = null;
      }
    }
    return null;
  }

  function findOpenActiveCycle(transitions, armedAt, gateAt) {
    let startAt = null;
    for (const transition of transitions || []) {
      if (transition.at < armedAt) continue;
      if (transition.active) startAt = transition.at;
      else startAt = null;
    }
    if (startAt != null && Date.now() >= gateAt) return { startAt };
    return null;
  }

  async function monitorCommissionProcessing(doc, options) {
    const source = doc || document;
    const onStatus = options && typeof options.onStatus === 'function' ? options.onStatus : function () {};
    const onLog = options && typeof options.onLog === 'function' ? options.onLog : function () {};
    const signal = options && options.signal;

    // Criados imediatamente apos Finalizar para capturar transicoes rapidas,
    // mas Atualizando Listagem so passa a valer depois que o calculo iniciou.
    const processing = createElementStateWatcher(source, PROCESSING_WINDOW_TEXT, { inactiveRescanMs: 2000 });
    const log = createElementStateWatcher(source, LOG_WINDOW_TEXT, { inactiveRescanMs: 2000 });
    const updating = createElementStateWatcher(source, UPDATING_WINDOW_TEXT, { inactiveRescanMs: 5000, preferLeaf: true });

    try {
      throwIfAborted(signal);
      onStatus('FASE 1/5 — ignorando Atualizando Listagem inicial; aguardando Gerando composição ATIVO...');
      await processing.waitForState(true, signal);
      const processingStartedAt = Date.now();

      // Se uma Atualizando Listagem antiga ainda estiver ATIVA neste instante,
      // exigimos primeiro que ela fique INATIVA. Somente o proximo ciclo conta.
      updating.resetTransitions();
      let updateArmed = !updating.isActive();
      let updateArmedAt = updateArmed ? processingStartedAt : 0;

      onStatus('FASE 2/5 — Gerando composição ATIVO. Monitorando cálculo e Log...');

      let logCancelAt = 0;
      let cancelAttempts = 0;
      let lastCancelAttemptAt = 0;
      let processingEndedAt = 0;

      while (!processingEndedAt) {
        throwIfAborted(signal);

        if (!updateArmed && !updating.isActive()) {
          updateArmed = true;
          updateArmedAt = Date.now();
          updating.resetTransitions();
          onStatus('FASE 2/5 — atualização inicial INATIVA; monitorando cálculo e Log...');
        }

        if (log.isActive()) {
          const now = Date.now();
          if (cancelAttempts === 0 || (cancelAttempts < 3 && now - lastCancelAttemptAt >= 1500)) {
            onStatus('FASE 3/5 — Log ATIVO. Procurando TBrowseButton Cancelar...');
            const cancel = findLogCancelButton(source);
            if (cancel) {
              onStatus('FASE 3/5 — Cancelar do Log encontrado. Acionando com confirmação...');
              throwIfAborted(signal);
              lastCancelAttemptAt = now;
              cancelAttempts++;
              const cancelConfirmed = await performConfirmedClick(source, {
                label: 'Cancelar do Log',
                findTarget: findLogCancelButton,
                isSuccess: (currentDoc) => !findCommissionLogMarker(currentDoc),
                maxAttempts: 1,
                effectTimeoutMs: 1800,
                effectPollMs: 200,
                retryDelayMs: 0,
                onStatus, onLog, signal
              });
              if (cancelConfirmed) {
                if (!logCancelAt) logCancelAt = Date.now();
                onStatus('FASE 3/5 — Cancelar confirmado. Aguardando fechamento do cálculo...');
              } else {
                onStatus('FASE 3/5 — Cancelar não foi confirmado. Nova tentativa será feita...');
              }
            } else {
              onStatus('FASE 3/5 — Log ATIVO, mas Cancelar ainda não foi localizado...');
            }
          }
        }

        if (!processing.isActive()) {
          // Usa o timestamp real registrado pelo watcher, nao o momento em que
          // este loop percebeu a mudanca. Assim ciclos muito rapidos de
          // Atualizando Listagem que ocorram entre dois polls nao sao descartados.
          const processingTransitions = processing.getTransitions();
          const lastInactive = processingTransitions.slice().reverse().find((transition) =>
            transition.active === false && transition.at >= processingStartedAt
          );
          processingEndedAt = lastInactive ? lastInactive.at : Date.now();
          break;
        }

        await abortableSleep(INTENSIVE_POLL_INTERVAL_MS, signal);
      }

      const gateAt = processingEndedAt;
      const configuredSafetyTimeout = options && Number(options.postProcessingSafetyTimeoutMs);
      const safetyTimeoutMs = Number.isFinite(configuredSafetyTimeout) && configuredSafetyTimeout >= 0
        ? configuredSafetyTimeout
        : POST_PROCESSING_SAFETY_TIMEOUT_MS;
      const safetyStartedAt = Date.now();
      const safetyDeadlineAt = safetyStartedAt + safetyTimeoutMs;
      onStatus('FASE 4/5 — Gerando composição INATIVO. Janela de segurança de 10 segundos iniciada...');

      let finalUpdateSeen = false;
      for (;;) {
        throwIfAborted(signal);
        const now = Date.now();

        // A atualizacao anterior ao calculo nao vale. Quando ela finalmente
        // ficar INATIVA, armamos o watcher para aceitar somente o proximo ciclo.
        if (!updateArmed && !updating.isActive()) {
          updateArmed = true;
          updateArmedAt = now;
          updating.resetTransitions();
          onStatus('FASE 5/5 — Atualizando Listagem anterior ficou INATIVO. Aguardando ciclo final...');
        }

        if (updateArmed) {
          const transitions = updating.getTransitions();
          const completed = findCompletedActiveCycle(transitions, updateArmedAt, gateAt);
          if (completed) finalUpdateSeen = true;

          const open = findOpenActiveCycle(transitions, updateArmedAt, gateAt);
          if (open || (now >= gateAt && updating.isActive())) finalUpdateSeen = true;

          // Se o ciclo final foi observado e ja esta INATIVO, encerramos cedo.
          // Nao precisamos capturar o exato milissegundo da transicao.
          if (finalUpdateSeen && !updating.isActive()) {
            onStatus('FASE 5/5 — Atualizando Listagem final concluiu. Aguardando 1 segundo...');
            await abortableSleep(POST_UPDATE_DELAY_MS, signal);
            return true;
          }
        }

        // O Atualizando Listagem e um sinal auxiliar. Nunca pode prender a
        // rotina indefinidamente: apos 10 segundos do fim do calculo, seguimos.
        if (now >= safetyDeadlineAt) {
          onStatus('FASE 5/5 — timeout de segurança de 10 segundos atingido. Seguindo a rotina...');
          return true;
        }

        if (finalUpdateSeen) {
          onStatus('FASE 5/5 — Atualizando Listagem final ATIVO registrado. Aguardando INATIVO ou timeout de segurança...');
        } else if (updateArmed) {
          onStatus('FASE 5/5 — aguardando Atualizando Listagem final ou timeout de segurança...');
        } else {
          onStatus('FASE 5/5 — aguardando atualização anterior ficar INATIVA ou timeout de segurança...');
        }

        await abortableSleep(INTENSIVE_POLL_INTERVAL_MS, signal);
      }
    } finally {
      processing.disconnect();
      log.disconnect();
      updating.disconnect();
    }
  }

  function findCalculateNowMarker(doc) {
    return findElementByText(
      doc || document,
      [TARGET_CALCULAR_AGORA],
      'wa-text-view,label,span,div,[title],[caption]'
    );
  }

  function findFinalizarButton(doc) {
    return findProtheusButtonByCaption(doc || document, TARGET_FINALIZAR) ||
      findElementByText(
        doc || document,
        [TARGET_FINALIZAR],
        'wa-button,button,input,[title],[caption],[value]'
      );
  }

  function getNativeActionTarget(el) {
    if (!el) return null;
    let tag = '';
    try { tag = String(el.tagName || '').toUpperCase(); } catch (_) {}

    if (tag === 'WA-BUTTON' || tag === 'WA-TAB-BUTTON') {
      try {
        if (el.shadowRoot) {
          const inner = el.shadowRoot.querySelector('button:not([disabled]),input[type="button"]:not([disabled]),input[type="submit"]:not([disabled])');
          if (inner) return inner;
        }
      } catch (_) {}
    }

    // Itens de menu e textos clicáveis do Protheus recebem a interação no
    // elemento interno do Shadow DOM. Disparar mouse/pointer apenas no host
    // pode não acionar o handler ADVPL, mesmo que o elemento seja encontrado.
    if (tag === 'WA-MENU-ITEM') {
      try {
        if (el.shadowRoot) {
          const inner = el.shadowRoot.querySelector('span.caption,[class~="caption"],span[tabindex]');
          if (inner) return inner;
        }
      } catch (_) {}
    }

    if (tag === 'WA-TEXT-VIEW') {
      try {
        if (el.shadowRoot) {
          const inner = el.shadowRoot.querySelector('label,[role="button"],[tabindex]');
          if (inner) return inner;
        }
      } catch (_) {}
    }

    if (tag === 'WA-CHECKBOX') {
      try {
        if (el.shadowRoot) {
          const inner = el.shadowRoot.querySelector('input[type="checkbox"]:not([disabled])');
          if (inner) return inner;
        }
      } catch (_) {}
    }

    if (tag === 'WA-TEXT-INPUT') {
      try {
        if (el.shadowRoot) {
          const inner = el.shadowRoot.querySelector('input:not([disabled]):not([readonly]),textarea:not([disabled]):not([readonly])');
          if (inner) return inner;
        }
      } catch (_) {}
    }

    return el;
  }

  function clickElement(el) {
    if (!el || isControlLocked(el)) return false;
    const target = getNativeActionTarget(el);
    if (!target || isControlLocked(target)) return false;

    // Não usamos foco da janela, coordenadas ou eventos de mouse reais. Para
    // wa-button o clique vai direto ao <button> nativo do Shadow DOM, cuja
    // mensagem click atravessa o Shadow DOM e chega ao componente Protheus.
    try {
      if (typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
      }
      if (typeof target.click === 'function') {
        target.click();
        return true;
      }
    } catch (_) {}

    try {
      const view = getElementView(target);
      const MouseCtor = view && view.MouseEvent ? view.MouseEvent : (typeof MouseEvent !== 'undefined' ? MouseEvent : null);
      if (MouseCtor && typeof target.dispatchEvent === 'function') {
        target.dispatchEvent(new MouseCtor('click', { bubbles: true, cancelable: true, composed: true, button: 0 }));
        return true;
      }
    } catch (_) {}

    return false;
  }

  function dispatchWaButtonGesture(el) {
    if (!el || isControlLocked(el)) return false;
    const target = getNativeActionTarget(el);
    if (!target || isControlLocked(target)) return false;

    try {
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    } catch (_) {}

    let rect = null;
    try { rect = target.getBoundingClientRect && target.getBoundingClientRect(); } catch (_) {}
    const clientX = rect && Number.isFinite(rect.left) && Number.isFinite(rect.width) ? rect.left + (rect.width / 2) : 0;
    const clientY = rect && Number.isFinite(rect.top) && Number.isFinite(rect.height) ? rect.top + (rect.height / 2) : 0;
    const view = getElementView(target);
    const MouseCtor = view && view.MouseEvent ? view.MouseEvent : (typeof MouseEvent !== 'undefined' ? MouseEvent : null);
    const PointerCtor = view && view.PointerEvent ? view.PointerEvent : (typeof PointerEvent !== 'undefined' ? PointerEvent : null);
    if (!MouseCtor && !PointerCtor) return false;

    try {
      if (typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
      }
    } catch (_) {}

    const downInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: view || null,
      detail: 1,
      button: 0,
      buttons: 1,
      clientX,
      clientY
    };
    const upInit = Object.assign({}, downInit, { buttons: 0 });

    try {
      if (PointerCtor) target.dispatchEvent(new PointerCtor('pointerdown', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, downInit)));
      if (MouseCtor) target.dispatchEvent(new MouseCtor('mousedown', downInit));
      if (PointerCtor) target.dispatchEvent(new PointerCtor('pointerup', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, upInit)));
      if (MouseCtor) target.dispatchEvent(new MouseCtor('mouseup', upInit));
      if (MouseCtor) target.dispatchEvent(new MouseCtor('click', upInit));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function waitForCondition(predicate, timeoutMs, pollMs, signal) {
    const timeout = Math.max(0, Number(timeoutMs) || 0);
    const poll = Math.max(25, Number(pollMs) || ACTION_EFFECT_POLL_MS);
    const startedAt = Date.now();

    for (;;) {
      throwIfAborted(signal);
      try { if (predicate()) return true; } catch (_) {}
      if (Date.now() - startedAt >= timeout) return false;
      await abortableSleep(Math.min(poll, Math.max(25, timeout - (Date.now() - startedAt))), signal);
    }
  }

  async function waitForStableCondition(predicate, timeoutMs, pollMs, stabilityMs, signal, onUnstable) {
    const timeout = Math.max(0, Number(timeoutMs) || 0);
    const poll = Math.max(25, Number(pollMs) || ACTION_EFFECT_POLL_MS);
    const stability = Math.max(0, Number(stabilityMs) || 0);
    const startedAt = Date.now();
    let stableSince = null;

    for (;;) {
      throwIfAborted(signal);
      let matched = false;
      try { matched = !!predicate(); } catch (_) {}
      const now = Date.now();

      if (matched) {
        if (stableSince == null) stableSince = now;
        if (stability === 0 || now - stableSince >= stability) return true;
      } else if (stableSince != null) {
        if (typeof onUnstable === 'function') {
          try { onUnstable({ stableForMs: now - stableSince }); } catch (_) {}
        }
        stableSince = null;
      }

      if (now - startedAt >= timeout) return false;
      const remaining = timeout - (now - startedAt);
      await abortableSleep(Math.min(poll, Math.max(25, remaining)), signal);
    }
  }

  async function waitForConditionWithStateWatchdog(predicate, timeoutMs, pollMs, signal, options) {
    const opts = options || {};
    const timeout = Math.max(0, Number(timeoutMs) || 0);
    const poll = Math.max(25, Number(pollMs) || ACTION_EFFECT_POLL_MS);
    const stallMs = Math.max(25, Number(opts.stallMs) || STATE_WATCHDOG_STALL_MS);
    const recheckMs = Math.max(25, Number(opts.recheckMs) || STATE_WATCHDOG_RECHECK_MS);
    const maxRecoveries = Math.max(0, Number.isFinite(Number(opts.maxRecoveries)) ? Number(opts.maxRecoveries) : STATE_WATCHDOG_MAX_RECOVERIES);
    const inspect = typeof opts.inspect === 'function' ? opts.inspect : null;
    const recover = typeof opts.recover === 'function' ? opts.recover : null;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const label = String(opts.label || 'Etapa');
    const startedAt = Date.now();
    let nextInspectionAt = startedAt + stallMs;
    let inspections = 0;
    let recoveries = 0;

    for (;;) {
      throwIfAborted(signal);
      try {
        if (predicate()) return { matched: true, inspections, recoveries, elapsedMs: Date.now() - startedAt };
      } catch (_) {}

      const now = Date.now();
      if (now - startedAt >= timeout) {
        return { matched: false, inspections, recoveries, elapsedMs: now - startedAt };
      }

      if (inspect && now >= nextInspectionAt) {
        inspections += 1;
        let report = null;
        try { report = await Promise.resolve(inspect({ inspections, recoveries, elapsedMs: now - startedAt })); } catch (error) {
          emitDiagnostic(onLog, 'STATE_WATCHDOG_INSPECT_ERROR', label + ': falha ao inspecionar o estado.', { message: String(error && error.message || error) });
          report = { action: 'ambiguous', reason: 'inspection-error' };
        }
        const action = normalizeText(report && report.action) || 'ambiguous';
        emitDiagnostic(onLog, 'STATE_WATCHDOG_CHECK', label + ': reconciliando estado após espera acima do normal.', {
          inspections, recoveries, action, reason: report && report.reason ? String(report.reason) : ''
        });

        if (action === 'fail') {
          const message = report && report.message ? String(report.message) : (label + ': estado inconsistente detectado pelo watchdog.');
          throw new Error(message);
        }

        if (action === 'recover') {
          if (!recover || recoveries >= maxRecoveries) {
            emitDiagnostic(onLog, 'STATE_WATCHDOG_RECOVERY_BLOCKED', label + ': recuperação automática bloqueada pelo limite de segurança.', { inspections, recoveries, maxRecoveries });
          } else {
            recoveries += 1;
            emitDiagnostic(onLog, 'STATE_WATCHDOG_RECOVER', label + ': estado anterior confirmado; executando uma recuperação segura.', {
              inspections, recoveries, reason: report && report.reason ? String(report.reason) : ''
            });
            const recovered = await Promise.resolve(recover(report, { inspections, recoveries }));
            if (!recovered) {
              emitDiagnostic(onLog, 'STATE_WATCHDOG_RECOVER_NO_EFFECT', label + ': a recuperação não confirmou efeito imediato; observação continuará.', { inspections, recoveries });
            }
            nextInspectionAt = Date.now() + stallMs;
            continue;
          }
        } else if (action === 'ambiguous') {
          emitDiagnostic(onLog, 'STATE_WATCHDOG_AMBIGUOUS', label + ': estado ambíguo; nenhuma ação automática será executada.', {
            inspections, recoveries, reason: report && report.reason ? String(report.reason) : ''
          });
        }

        const requestedNextCheckMs = report && Number(report.nextCheckMs);
        nextInspectionAt = Date.now() + (Number.isFinite(requestedNextCheckMs) && requestedNextCheckMs >= 25 ? requestedNextCheckMs : recheckMs);
      }

      await abortableSleep(Math.min(poll, Math.max(25, timeout - (Date.now() - startedAt))), signal);
    }
  }

  function normalizeVerifiedActionState(report) {
    const raw = typeof report === 'string' ? report : (report && report.state);
    const state = normalizeText(raw || 'ambiguous');
    if (state === 'success' || state === 'previous' || state === 'processing' || state === 'ambiguous' || state === 'failed') {
      return state;
    }
    return 'ambiguous';
  }

  async function performVerifiedAction(doc, options) {
    const source = doc || document;
    const opts = options || {};
    const label = String(opts.label || 'Ação');
    const findTarget = typeof opts.findTarget === 'function' ? opts.findTarget : function () { return null; };
    const execute = typeof opts.execute === 'function' ? opts.execute : clickElement;
    const isSuccess = typeof opts.isSuccess === 'function' ? opts.isSuccess : function () { return false; };
    const inspectRetryState = typeof opts.inspectRetryState === 'function' ? opts.inspectRetryState : null;
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const signal = opts.signal;
    const requestedPolicy = String(opts.retryPolicy || VERIFIED_ACTION_RETRY_POLICIES.SAFE);
    const retryPolicy = Object.values(VERIFIED_ACTION_RETRY_POLICIES).includes(requestedPolicy)
      ? requestedPolicy
      : VERIFIED_ACTION_RETRY_POLICIES.SAFE;
    const maxAttempts = Math.max(1, Math.trunc(Number(opts.maxAttempts) || ACTION_MAX_ATTEMPTS));
    const effectTimeoutMs = Math.max(10, Number(opts.effectTimeoutMs) || ACTION_EFFECT_TIMEOUT_MS);
    const effectPollMs = Math.max(5, Number(opts.effectPollMs) || ACTION_EFFECT_POLL_MS);
    const retryDelayMs = Math.max(0, Number(opts.retryDelayMs) || 0);
    const processingTimeoutMs = Math.max(0, Number.isFinite(Number(opts.processingTimeoutMs)) ? Number(opts.processingTimeoutMs) : effectTimeoutMs);
    const stepDelayMs = Math.max(0, Number(opts.stepDelayMs) || 0);
    const successStabilityMs = Math.max(0, Number(opts.successStabilityMs) || 0);

    const successNow = async () => {
      let matched = false;
      try { matched = !!isSuccess(source); } catch (_) {}
      if (!matched) return false;
      if (successStabilityMs <= 0) return true;
      return waitForStableCondition(
        () => isSuccess(source),
        Math.max(successStabilityMs + effectPollMs, effectPollMs),
        effectPollMs,
        successStabilityMs,
        signal
      );
    };
    const waitSuccess = async (timeoutMs) => {
      if (successStabilityMs > 0) {
        return waitForStableCondition(
          () => isSuccess(source),
          Math.max(successStabilityMs, Number(timeoutMs) || 0),
          effectPollMs,
          successStabilityMs,
          signal
        );
      }
      return waitForCondition(() => isSuccess(source), Math.max(0, Number(timeoutMs) || 0), effectPollMs, signal);
    };
    const inspect = async (context) => {
      if (!inspectRetryState) return { state: 'ambiguous', reason: 'no-inspector' };
      try {
        const report = await Promise.resolve(inspectRetryState(source, context || {}));
        const normalized = (report && typeof report === 'object') ? Object.assign({}, report) : { state: report };
        normalized.state = normalizeVerifiedActionState(normalized);
        return normalized;
      } catch (error) {
        return { state: 'failed', reason: 'inspection-error', message: String(error && error.message || error) };
      }
    };

    throwIfAborted(signal);
    if (await successNow()) {
      emitDiagnostic(onLog, 'VERIFIED_ACTION_SUCCESS', label + ': efeito já estava confirmado antes da ação.', { label, retryPolicy, phase: 'preexisting' });
      return true;
    }

    emitDiagnostic(onLog, 'VERIFIED_ACTION_START', label + ': iniciando ação verificada.', { label, retryPolicy, maxAttempts, effectTimeoutMs });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfAborted(signal);
      if (await successNow()) {
        emitDiagnostic(onLog, 'VERIFIED_ACTION_SUCCESS', label + ': efeito confirmado antes da tentativa.', { label, retryPolicy, attempt, phase: 'before-attempt' });
        return true;
      }

      let target = null;
      try { target = findTarget(source); } catch (error) { throw error; }
      if (!target) {
        emitDiagnostic(onLog, 'VERIFIED_ACTION_BLOCKED', label + ': alvo semântico não está disponível.', { label, retryPolicy, attempt, reason: 'target-missing' });
        if (attempt < maxAttempts) {
          if (retryDelayMs > 0) await abortableSleep(retryDelayMs, signal);
          continue;
        }
        emitDiagnostic(onLog, 'VERIFIED_ACTION_FAIL', label + ': alvo não pôde ser adquirido.', { label, retryPolicy, maxAttempts });
        return false;
      }

      emitDiagnostic(onLog, 'VERIFIED_ACTION_TARGET', label + ': alvo semântico adquirido.', {
        label, retryPolicy, attempt, target: describeActionTarget(target)
      });
      onStatus(label + ': executando (tentativa ' + attempt + '/' + maxAttempts + ')...');
      if (stepDelayMs > 0) await abortableSleep(stepDelayMs, signal);

      const executed = !!(await Promise.resolve(execute(target, { attempt, label, retryPolicy, source })));
      emitDiagnostic(onLog, 'VERIFIED_ACTION_EXECUTE', label + ': acionador executado.', { label, retryPolicy, attempt, executed });
      if (!executed) {
        if (attempt < maxAttempts) {
          emitDiagnostic(onLog, 'VERIFIED_ACTION_RETRY', label + ': execução não foi disparada; readquirindo o alvo.', {
            label, retryPolicy, attempt, reason: 'execute-returned-false'
          });
          if (retryDelayMs > 0) await abortableSleep(retryDelayMs, signal);
          continue;
        }
        emitDiagnostic(onLog, 'VERIFIED_ACTION_FAIL', label + ': o acionador falhou em todas as tentativas.', { label, retryPolicy, maxAttempts });
        return false;
      }

      onStatus(label + ': ação enviada. Aguardando confirmação do Protheus...');
      emitDiagnostic(onLog, 'VERIFIED_ACTION_WAIT', label + ': aguardando efeito esperado.', { label, retryPolicy, attempt, timeoutMs: effectTimeoutMs });
      if (await waitSuccess(effectTimeoutMs)) {
        emitDiagnostic(onLog, 'VERIFIED_ACTION_SUCCESS', label + ': efeito confirmado pelo Protheus.', { label, retryPolicy, attempt, phase: 'effect' });
        return true;
      }

      let report = await inspect({ attempt, target, phase: 'effect-timeout' });
      emitDiagnostic(onLog, 'VERIFIED_ACTION_STATE', label + ': estado reconciliado após demora.', {
        label, retryPolicy, attempt, state: report.state, reason: String(report.reason || '')
      });

      if (report.state === 'success' || await successNow()) {
        emitDiagnostic(onLog, 'VERIFIED_ACTION_SUCCESS', label + ': efeito confirmado durante a reconciliação.', { label, retryPolicy, attempt, phase: 'inspection' });
        return true;
      }
      if (report.state === 'failed') {
        const message = report.message ? String(report.message) : (label + ': inspeção detectou estado inconsistente.');
        emitDiagnostic(onLog, 'VERIFIED_ACTION_FAIL', message, { label, retryPolicy, attempt, reason: String(report.reason || '') });
        throw new Error(message);
      }

      if (report.state === 'processing') {
        emitDiagnostic(onLog, 'VERIFIED_ACTION_WAIT', label + ': transição em andamento; nenhuma repetição será enviada.', {
          label, retryPolicy, attempt, timeoutMs: processingTimeoutMs, phase: 'processing'
        });
        if (processingTimeoutMs > 0 && await waitSuccess(processingTimeoutMs)) {
          emitDiagnostic(onLog, 'VERIFIED_ACTION_SUCCESS', label + ': efeito confirmado durante processamento.', { label, retryPolicy, attempt, phase: 'processing' });
          return true;
        }
        report = await inspect({ attempt, target, phase: 'processing-timeout' });
        emitDiagnostic(onLog, 'VERIFIED_ACTION_STATE', label + ': estado reconciliado após processamento prolongado.', {
          label, retryPolicy, attempt, state: report.state, reason: String(report.reason || '')
        });
        if (report.state === 'success' || await successNow()) {
          emitDiagnostic(onLog, 'VERIFIED_ACTION_SUCCESS', label + ': efeito confirmado após processamento prolongado.', { label, retryPolicy, attempt, phase: 'processing-inspection' });
          return true;
        }
        if (report.state === 'failed') {
          const message = report.message ? String(report.message) : (label + ': inspeção detectou falha após processamento.');
          emitDiagnostic(onLog, 'VERIFIED_ACTION_FAIL', message, { label, retryPolicy, attempt, reason: String(report.reason || '') });
          throw new Error(message);
        }
      }

      if (retryPolicy === VERIFIED_ACTION_RETRY_POLICIES.NEVER_BLIND_RETRY) {
        emitDiagnostic(onLog, 'VERIFIED_ACTION_BLOCKED', label + ': retry bloqueado pela política never-blind-retry.', {
          label, retryPolicy, attempt, state: report.state, reason: String(report.reason || '')
        });
        return false;
      }

      let mayRetry = false;
      if (retryPolicy === VERIFIED_ACTION_RETRY_POLICIES.SAFE) {
        mayRetry = report.state !== 'failed';
      } else if (retryPolicy === VERIFIED_ACTION_RETRY_POLICIES.VERIFY_BEFORE_RETRY) {
        mayRetry = report.state === 'previous';
      }

      if (!mayRetry) {
        emitDiagnostic(onLog, 'VERIFIED_ACTION_BLOCKED', label + ': estado não autoriza uma nova tentativa.', {
          label, retryPolicy, attempt, state: report.state, reason: String(report.reason || '')
        });
        return false;
      }

      if (attempt >= maxAttempts) break;
      emitDiagnostic(onLog, 'VERIFIED_ACTION_RETRY', label + ': estado anterior confirmado; readquirindo alvo para retry seguro.', {
        label, retryPolicy, attempt, state: report.state, reason: String(report.reason || '')
      });
      if (retryDelayMs > 0) await abortableSleep(retryDelayMs, signal);
    }

    emitDiagnostic(onLog, 'VERIFIED_ACTION_FAIL', label + ': tentativas esgotadas sem confirmação do efeito.', { label, retryPolicy, maxAttempts });
    return false;
  }

  async function performConfirmedClick(doc, options) {
    const source = doc || document;
    const opts = options || {};
    const label = String(opts.label || 'Ação');
    const findTarget = typeof opts.findTarget === 'function' ? opts.findTarget : function () { return null; };
    const isSuccess = typeof opts.isSuccess === 'function' ? opts.isSuccess : function () { return false; };
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const signal = opts.signal;
    const maxAttempts = Math.max(1, Number(opts.maxAttempts) || ACTION_MAX_ATTEMPTS);
    const effectTimeoutMs = Math.max(100, Number(opts.effectTimeoutMs) || ACTION_EFFECT_TIMEOUT_MS);
    const effectPollMs = Math.max(25, Number(opts.effectPollMs) || ACTION_EFFECT_POLL_MS);
    const retryDelayMs = Math.max(0, Number(opts.retryDelayMs) || ACTION_RETRY_DELAY_MS);
    const stepDelayMs = Number.isFinite(Number(opts.stepDelayMs)) ? normalizeSoomarStepDelayMs(opts.stepDelayMs) : 0;
    const successStabilityMs = Math.max(0, Number.isFinite(Number(opts.successStabilityMs)) ? Number(opts.successStabilityMs) : ACTION_SUCCESS_STABILITY_MS);
    const triggerTarget = typeof opts.triggerTarget === 'function' ? opts.triggerTarget : clickElement;
    const unstableReporter = (data) => emitDiagnostic(onLog, 'STATE_TRANSITION_UNSTABLE', label + ': o estado de sucesso apareceu apenas de forma transitória; confirmação ignorada.', data);
    const successIsStableNow = async () => {
      let current = false;
      try { current = !!isSuccess(source); } catch (_) {}
      if (!current) return false;
      return waitForStableCondition(
        () => isSuccess(source),
        Math.max(successStabilityMs + 100, 100),
        Math.min(effectPollMs, 75),
        successStabilityMs,
        signal,
        unstableReporter
      );
    };
    const waitForSuccess = async (timeoutForSuccess) => waitForStableCondition(
      () => isSuccess(source),
      Math.max(successStabilityMs, Number(timeoutForSuccess) || 0),
      Math.min(effectPollMs, 75),
      successStabilityMs,
      signal,
      unstableReporter
    );

    throwIfAborted(signal);
    try {
      if (await successIsStableNow()) {
        emitDiagnostic(onLog, 'CONFIRM', label + ': efeito já estava confirmado antes do clique.');
        return true;
      }
    } catch (_) {}

    emitDiagnostic(onLog, 'ACTION', label + ': iniciando ação confirmada.', { maxAttempts, effectTimeoutMs, effectPollMs });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfAborted(signal);
      try {
        if (await successIsStableNow()) {
          emitDiagnostic(onLog, 'CONFIRM', label + ': efeito confirmado antes da tentativa.', { attempt });
          return true;
        }
      } catch (_) {}

      let target = null;
      try { target = findTarget(source); } catch (error) { throw error; }
      if (!target) {
        onStatus(label + ': controle anterior indisponível. Verificando se o efeito já aconteceu...');
        emitDiagnostic(onLog, 'REACQUIRE_WAIT', label + ': alvo indisponível; observando efeito esperado e possível retorno do controle.', {
          attempt,
          timeoutMs: effectTimeoutMs
        });

        const reacquireStartedAt = Date.now();
        let nextTargetCheckAt = 0;
        for (;;) {
          throwIfAborted(signal);

          try {
            if (await successIsStableNow()) {
              const elapsedMs = Date.now() - reacquireStartedAt;
              onStatus(label + ': ação confirmada pelo Protheus.');
              emitDiagnostic(onLog, 'CONFIRM', label + ': efeito confirmado enquanto o controle anterior estava indisponível.', { attempt, elapsedMs });
              return true;
            }
          } catch (_) {}

          const now = Date.now();
          if (now >= nextTargetCheckAt) {
            try { target = findTarget(source); } catch (error) { throw error; }
            if (target) {
              emitDiagnostic(onLog, 'REACQUIRE', label + ': controle voltou a ficar disponível.', { attempt, target: describeActionTarget(target) });
              break;
            }
            nextTargetCheckAt = now + POLL_INTERVAL_MS;
          }

          if (now - reacquireStartedAt >= effectTimeoutMs) {
            emitDiagnostic(onLog, 'REACQUIRE_TIMEOUT', label + ': nem o efeito nem o controle foram encontrados no período de recuperação.', { attempt, timeoutMs: effectTimeoutMs });
            break;
          }

          await abortableSleep(Math.max(25, Math.min(effectPollMs, 250)), signal);
        }
      }

      if (!target) {
        if (attempt < maxAttempts && retryDelayMs > 0) {
          emitDiagnostic(onLog, 'RETRY', label + ': aguardando antes de nova tentativa sem alvo.', { attempt, delayMs: retryDelayMs });
          await abortableSleep(retryDelayMs, signal);
        }
        continue;
      }

      emitDiagnostic(onLog, 'FIND', label + ': controle encontrado.', { attempt, target: describeActionTarget(target) });
      onStatus(label + ': acionando (tentativa ' + attempt + '/' + maxAttempts + ')...');
      if (stepDelayMs > 0) await abortableSleep(stepDelayMs, signal);
      emitDiagnostic(onLog, 'CLICK', label + ': enviando clique.', { attempt, target: describeActionTarget(target), stepDelayMs });
      const triggerSucceeded = await Promise.resolve(triggerTarget(target));
      if (!triggerSucceeded) {
        onStatus(label + ': não foi possível acionar o controle. Nova tentativa...');
        emitDiagnostic(onLog, 'CLICK_FAIL', label + ': o acionador configurado retornou false.', { attempt, target: describeActionTarget(target) });
      } else {
        const confirmationStartedAt = Date.now();
        onStatus(label + ': clique enviado. Aguardando confirmação do Protheus...');
        emitDiagnostic(onLog, 'CONFIRM_WAIT', label + ': aguardando efeito do clique.', { attempt, timeoutMs: effectTimeoutMs, stepDelayMs });
        if (stepDelayMs > 0) await abortableSleep(stepDelayMs, signal);
        if (await waitForSuccess(effectTimeoutMs)) {
          const elapsedMs = Date.now() - confirmationStartedAt;
          onStatus(label + ': ação confirmada pelo Protheus.');
          emitDiagnostic(onLog, 'CONFIRM', label + ': ação confirmada pelo Protheus.', { attempt, elapsedMs });
          return true;
        }
        const elapsedMs = Date.now() - confirmationStartedAt;
        onStatus(label + ': o Protheus não confirmou o efeito. Preparando nova tentativa...');
        emitDiagnostic(onLog, 'CONFIRM_TIMEOUT', label + ': efeito não confirmado dentro do prazo.', { attempt, elapsedMs, timeoutMs: effectTimeoutMs });
      }

      if (attempt < maxAttempts && retryDelayMs > 0) {
        emitDiagnostic(onLog, 'RETRY', label + ': aguardando antes de nova tentativa.', { attempt, delayMs: retryDelayMs });
        await abortableSleep(retryDelayMs, signal);
      }
    }

    emitDiagnostic(onLog, 'ACTION_FAIL', label + ': tentativas esgotadas.', { maxAttempts });
    return false;
  }

  function waitForElement(doc, finder, intervalMs, signal) {
    const every = intervalMs || POLL_INTERVAL_MS;
    return new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (signal && typeof signal.removeEventListener === 'function') {
          try { signal.removeEventListener('abort', onAbort); } catch (_) {}
        }
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(makeAbortError());
      };
      const attempt = () => {
        if (settled) return;
        try { throwIfAborted(signal); } catch (error) {
          settled = true;
          cleanup();
          reject(error);
          return;
        }

        let found = null;
        try {
          found = finder(doc || document);
        } catch (error) {
          settled = true;
          cleanup();
          reject(error);
          return;
        }
        if (found) {
          settled = true;
          cleanup();
          resolve(found);
          return;
        }
        timer = setTimeout(attempt, every);
      };

      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      attempt();
    });
  }

  function isControlLocked(control) {
    if (!control) return true;

    try {
      if (control.disabled === true || control.readOnly === true) return true;
    } catch (_) {}

    try {
      if (control.hasAttribute && (control.hasAttribute('disabled') || control.hasAttribute('readonly'))) return true;
    } catch (_) {}

    return false;
  }

  function isExactGrpComissaoControl(control) {
    if (!control) return false;

    let tag = '';
    let name = '';
    let title = '';
    let maxlength = '';

    try { tag = String(control.tagName || '').toUpperCase(); } catch (_) {}
    try { name = control.getAttribute('name') || ''; } catch (_) {}
    try { title = control.getAttribute('title') || ''; } catch (_) {}
    try { maxlength = control.getAttribute('maxlength') || ''; } catch (_) {}

    return tag === 'WA-TEXT-INPUT' &&
      name === GRP_COMISSAO_NAME &&
      normalizeText(title) === normalizeText(GRP_COMISSAO_TITLE) &&
      String(maxlength) === GRP_COMISSAO_MAXLENGTH &&
      !isControlLocked(control);
  }

  function findGrpComissaoControl(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const unique = new Set();
    const matches = [];
    const selector = 'wa-text-input[name="M->PKA_GRPCMS"]';

    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch (_) {}

      for (const control of nodes) {
        if (unique.has(control)) continue;
        unique.add(control);
        if (!isVisible(control)) continue;
        if (!isExactGrpComissaoControl(control)) continue;
        matches.push(control);
      }
    }

    if (matches.length > 1) {
      throw new Error('Seguranca: encontrei mais de um campo M->PKA_GRPCMS. Nenhum campo foi alterado.');
    }

    return matches[0] || null;
  }

  function getInnerEditable(control) {
    if (!control) return null;
    try {
      if (control.shadowRoot) {
        return control.shadowRoot.querySelector('input:not([disabled]):not([readonly]),textarea:not([disabled]):not([readonly]),[contenteditable="true"]');
      }
    } catch (_) {}
    return null;
  }

  function isAllowedCommissionDateName(name) {
    return Object.values(COMMISSION_DATE_FIELDS).includes(String(name || ''));
  }

  function isExactCommissionDateControl(control, expectedName) {
    if (!control || !isAllowedCommissionDateName(expectedName)) return false;

    let tag = '';
    let name = '';
    let type = '';
    let picture = '';
    let maxlength = '';

    try { tag = String(control.tagName || '').toUpperCase(); } catch (_) {}
    try { name = control.getAttribute('name') || ''; } catch (_) {}
    try { type = control.getAttribute('type') || ''; } catch (_) {}
    try { picture = control.getAttribute('picture') || ''; } catch (_) {}
    try { maxlength = control.getAttribute('maxlength') || ''; } catch (_) {}

    return tag === 'WA-TEXT-INPUT' &&
      name === expectedName &&
      String(type).toLowerCase() === 'date' &&
      String(maxlength) === '10' &&
      String(picture).includes('99/99/9999') &&
      !FORBIDDEN_DATE_FIELDS.includes(name) &&
      !isControlLocked(control);
  }

  function findCommissionDateControl(doc, expectedName) {
    if (!isAllowedCommissionDateName(expectedName)) {
      throw new Error('Seguranca: campo de data nao autorizado para esta rotina: ' + String(expectedName || ''));
    }

    const source = doc || document;
    const roots = collectRoots(source);
    const unique = new Set();
    const matches = [];
    const selector = 'wa-text-input[name="' + expectedName + '"]';

    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch (_) {}

      for (const control of nodes) {
        if (unique.has(control)) continue;
        unique.add(control);
        if (!isVisible(control)) continue;
        if (!isExactCommissionDateControl(control, expectedName)) continue;
        matches.push(control);
      }
    }

    if (matches.length > 1) {
      throw new Error('Seguranca: encontrei mais de um campo ' + expectedName + '. Nenhum campo foi alterado.');
    }

    return matches[0] || null;
  }

  function dateParts(date) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate()
    };
  }

  function calculateCommissionDates(referenceDate) {
    const reference = referenceDate instanceof Date ? referenceDate : new Date();
    if (Number.isNaN(reference.getTime())) throw new Error('Data de referencia invalida.');

    const year = reference.getFullYear();
    const monthIndex = reference.getMonth();

    return {
      baixaDe: dateParts(new Date(year, monthIndex - 1, 1, 12, 0, 0)),
      baixaAte: dateParts(new Date(year, monthIndex, 0, 12, 0, 0)),
      dataPagto: dateParts(new Date(year, monthIndex, 10, 12, 0, 0))
    };
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatDateBR(parts) {
    return pad2(parts.day) + '/' + pad2(parts.month) + '/' + String(parts.year);
  }

  function formatDateISO(parts) {
    return String(parts.year) + '-' + pad2(parts.month) + '-' + pad2(parts.day);
  }

  function makeAbortError(message) {
    const error = new Error(message || 'Rotina cancelada pelo usuário.');
    error.name = 'AbortError';
    return error;
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw makeAbortError();
  }

  function abortableSleep(ms, signal) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }, ms);

      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(makeAbortError());
      };
      const cleanup = () => {
        if (signal && typeof signal.removeEventListener === 'function') {
          try { signal.removeEventListener('abort', onAbort); } catch (_) {}
        }
      };

      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  function sleep(ms) {
    return abortableSleep(ms, null);
  }

  function dispatchSyntheticEvent(target, type, options) {
    if (!target || typeof target.dispatchEvent !== 'function') return;
    const opts = Object.assign({ bubbles: true, composed: true, cancelable: true }, options || {});

    try {
      if ((type === 'beforeinput' || type === 'input') && typeof InputEvent !== 'undefined') {
        target.dispatchEvent(new InputEvent(type, opts));
        return;
      }
      if ((type === 'keydown' || type === 'keyup') && typeof KeyboardEvent !== 'undefined') {
        target.dispatchEvent(new KeyboardEvent(type, opts));
        return;
      }
      if (typeof Event !== 'undefined') {
        target.dispatchEvent(new Event(type, opts));
        return;
      }
    } catch (_) {}

    try { target.dispatchEvent({ type }); } catch (_) {}
  }

  function setNativeEditableValue(input, value) {
    if (!input) return false;
    const text = String(value);

    // Usa o setter nativo do input quando existe. Isso evita setters/proxies
    // do web component alterarem ou descartarem o valor.
    try {
      let proto = input;
      while (proto) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && typeof descriptor.set === 'function') {
          descriptor.set.call(input, text);
          return String(input.value) === text;
        }
        proto = Object.getPrototypeOf(proto);
      }
    } catch (_) {}

    try {
      input.value = text;
      return String(input.value) === text;
    } catch (_) {
      return false;
    }
  }

  function readControlValue(control) {
    const inner = getInnerEditable(control);
    if (!inner) return '';
    try { return String(inner.value == null ? '' : inner.value); } catch (_) { return ''; }
  }

  function setControlValue(control, value) {
    // Trava critica: esta funcao NUNCA escreve em outro campo.
    if (!isExactGrpComissaoControl(control)) return false;

    const inner = getInnerEditable(control);
    if (!inner || isControlLocked(inner)) return false;

    const text = String(value);

    try { if (typeof inner.focus === 'function') inner.focus(); } catch (_) {}
    try { if (typeof inner.select === 'function') inner.select(); } catch (_) {}

    // Limpa apenas o INPUT interno e simula digitacao caractere a caractere.
    if (!setNativeEditableValue(inner, '')) return false;

    let current = '';
    for (const char of text) {
      dispatchSyntheticEvent(inner, 'keydown', { key: char, code: 'Digit' + char, data: char });
      dispatchSyntheticEvent(inner, 'beforeinput', { data: char, inputType: 'insertText' });

      current += char;
      if (!setNativeEditableValue(inner, current)) return false;

      dispatchSyntheticEvent(inner, 'input', { data: char, inputType: 'insertText' });
      dispatchSyntheticEvent(inner, 'keyup', { key: char, code: 'Digit' + char, data: char });
    }

    dispatchSyntheticEvent(inner, 'change');
    try { if (typeof inner.blur === 'function') inner.blur(); } catch (_) {}

    return readControlValue(control) === text;
  }

  async function fillGrpComissaoReliably(doc, value, signal) {
    const source = doc || document;
    const text = String(value);

    // A tela pode exibir o host antes de o INPUT interno estar totalmente pronto.
    await abortableSleep(700, signal);

    for (let attempt = 1; attempt <= 6; attempt++) {
      throwIfAborted(signal);
      const control = findGrpComissaoControl(source);
      if (control && setControlValue(control, text)) {
        await abortableSleep(250, signal);
        const verifiedControl = findGrpComissaoControl(source);
        if (verifiedControl && readControlValue(verifiedControl) === text) {
          return true;
        }
      }

      await abortableSleep(500, signal);
    }

    return false;
  }

  function expectedDateInputValue(inner, parts) {
    let inputType = '';
    try { inputType = String(inner.type || inner.getAttribute?.('type') || '').toLowerCase(); } catch (_) {}
    return inputType === 'date' ? formatDateISO(parts) : formatDateBR(parts);
  }

  function readCommissionDateControlValue(control, parts) {
    const inner = getInnerEditable(control);
    if (!inner) return '';
    try { return String(inner.value == null ? '' : inner.value); } catch (_) { return ''; }
  }

  function setCommissionDateControlValue(control, expectedName, parts) {
    // Trava critica: somente os tres names explicitamente autorizados podem receber datas.
    if (!isExactCommissionDateControl(control, expectedName)) return false;

    const inner = getInnerEditable(control);
    if (!inner || isControlLocked(inner)) return false;

    const text = expectedDateInputValue(inner, parts);
    let inputType = '';
    try { inputType = String(inner.type || inner.getAttribute?.('type') || '').toLowerCase(); } catch (_) {}

    try { if (typeof inner.focus === 'function') inner.focus(); } catch (_) {}
    try { if (typeof inner.select === 'function') inner.select(); } catch (_) {}

    if (inputType === 'date') {
      if (!setNativeEditableValue(inner, text)) return false;
      dispatchSyntheticEvent(inner, 'input', { data: text, inputType: 'insertText' });
    } else {
      // Os WA-TEXT-INPUT do Protheus costumam persistir melhor quando recebem
      // a mesma sequencia de eventos de uma digitacao humana.
      if (!setNativeEditableValue(inner, '')) return false;
      let current = '';
      for (const char of text) {
        dispatchSyntheticEvent(inner, 'keydown', { key: char, data: char });
        dispatchSyntheticEvent(inner, 'beforeinput', { data: char, inputType: 'insertText' });
        current += char;
        if (!setNativeEditableValue(inner, current)) return false;
        dispatchSyntheticEvent(inner, 'input', { data: char, inputType: 'insertText' });
        dispatchSyntheticEvent(inner, 'keyup', { key: char, data: char });
      }
    }

    dispatchSyntheticEvent(inner, 'change');
    try { if (typeof inner.blur === 'function') inner.blur(); } catch (_) {}

    return readCommissionDateControlValue(control, parts) === text;
  }

  async function fillCommissionDateReliably(doc, expectedName, parts, signal) {
    const source = doc || document;
    await abortableSleep(350, signal);

    for (let attempt = 1; attempt <= 6; attempt++) {
      throwIfAborted(signal);
      const control = findCommissionDateControl(source, expectedName);
      if (control && setCommissionDateControlValue(control, expectedName, parts)) {
        await abortableSleep(300, signal);
        const verifiedControl = findCommissionDateControl(source, expectedName);
        const inner = getInnerEditable(verifiedControl);
        if (verifiedControl && inner && readCommissionDateControlValue(verifiedControl, parts) === expectedDateInputValue(inner, parts)) {
          return true;
        }
      }

      await abortableSleep(500, signal);
    }

    return false;
  }

  function runFirstStep(doc) {
    const el = findPainelComissoesPagar(doc || document);
    if (!el) return { ok: false, detail: 'Painel Comissões a Pagar não encontrado nesta tela.' };
    const ok = clickElement(el);
    return {
      ok,
      detail: ok ? 'Rotina iniciada.' : 'O elemento foi encontrado, mas o clique falhou.'
    };
  }

  async function generateCommissionGroup(source, groupValue, dates, context) {
    const onStatus = context.onStatus;
    const onLog = context.onLog;
    const signal = context.signal;

    onStatus('Grupo ' + groupValue + ': abrindo Lote Manual...');
    if (!await performConfirmedClick(source, {
      label: 'Lote Manual — grupo ' + groupValue,
      findTarget: findLoteManualButton,
      isSuccess: (currentDoc) => !!findAvancarButton(currentDoc),
      onStatus, onLog, signal
    })) throw new Error('Grupo ' + groupValue + ': Lote Manual foi acionado, mas o assistente não abriu após as tentativas de segurança.');

    onStatus('Grupo ' + groupValue + ': avançando para os parâmetros do lote...');
    if (!await performConfirmedClick(source, {
      label: 'Avançar — abertura dos parâmetros — grupo ' + groupValue,
      findTarget: findAvancarButton,
      isSuccess: (currentDoc) => !!findGrpComissaoControl(currentDoc),
      onStatus, onLog, signal
    })) throw new Error('Grupo ' + groupValue + ': Avançar foi acionado, mas os parâmetros do lote não apareceram.');

    onStatus('Grupo ' + groupValue + ': procurando Grp Comissao...');
    await waitForElement(source, findGrpComissaoControl, POLL_INTERVAL_MS, signal);
    onStatus('Grupo ' + groupValue + ': preenchendo Grp Comissao com ' + groupValue + '...');
    emitDiagnostic(onLog, 'FIELD', 'Preenchendo Grp Comissao.', { group: groupValue, name: GRP_COMISSAO_NAME, value: groupValue });
    if (!await fillGrpComissaoReliably(source, groupValue, signal)) throw new Error('Grupo ' + groupValue + ': o valor não permaneceu no campo Grp Comissao.');
    emitDiagnostic(onLog, 'FIELD_CONFIRM', 'Grp Comissao confirmado.', { group: groupValue, name: GRP_COMISSAO_NAME, value: groupValue });

    onStatus('Grupo ' + groupValue + ': preenchendo Dt Baixa De...');
    await waitForElement(source, (currentDoc) => findCommissionDateControl(currentDoc, COMMISSION_DATE_FIELDS.baixaDe), POLL_INTERVAL_MS, signal);
    if (!await fillCommissionDateReliably(source, COMMISSION_DATE_FIELDS.baixaDe, dates.baixaDe, signal)) {
      throw new Error('Grupo ' + groupValue + ': Dt Baixa De não manteve a data ' + formatDateBR(dates.baixaDe) + '.');
    }

    onStatus('Grupo ' + groupValue + ': preenchendo Dt Baixa Ate...');
    await waitForElement(source, (currentDoc) => findCommissionDateControl(currentDoc, COMMISSION_DATE_FIELDS.baixaAte), POLL_INTERVAL_MS, signal);
    if (!await fillCommissionDateReliably(source, COMMISSION_DATE_FIELDS.baixaAte, dates.baixaAte, signal)) {
      throw new Error('Grupo ' + groupValue + ': Dt Baixa Ate não manteve a data ' + formatDateBR(dates.baixaAte) + '.');
    }

    onStatus('Grupo ' + groupValue + ': preenchendo Data Pagto...');
    await waitForElement(source, (currentDoc) => findCommissionDateControl(currentDoc, COMMISSION_DATE_FIELDS.dataPagto), POLL_INTERVAL_MS, signal);
    if (!await fillCommissionDateReliably(source, COMMISSION_DATE_FIELDS.dataPagto, dates.dataPagto, signal)) {
      throw new Error('Grupo ' + groupValue + ': Data Pagto não manteve a data ' + formatDateBR(dates.dataPagto) + '.');
    }

    onStatus('Grupo ' + groupValue + ': aguardando 1 segundo antes de Avançar...');
    await abortableSleep(POLL_INTERVAL_MS, signal);
    if (!await performConfirmedClick(source, {
      label: 'Avançar — finalização — grupo ' + groupValue,
      findTarget: findAvancarButton,
      isSuccess: (currentDoc) => !!findCalculateNowMarker(currentDoc),
      onStatus, onLog, signal
    })) throw new Error('Grupo ' + groupValue + ': a tela Final da Inclusão não apareceu.');

    onStatus('Grupo ' + groupValue + ': Final da Inclusão confirmada. Finalizando...');
    if (!await performConfirmedClick(source, {
      label: 'Finalizar — grupo ' + groupValue,
      findTarget: findFinalizarButton,
      isSuccess: (currentDoc) => !findCalculateNowMarker(currentDoc) || !!findProcessingWindowMarker(currentDoc),
      onStatus, onLog, signal
    })) throw new Error('Grupo ' + groupValue + ': o Protheus não confirmou o início do processamento.');

    emitDiagnostic(onLog, 'PROCESS', 'Monitoramento do processamento iniciado.', { group: groupValue });
    await monitorCommissionProcessing(source, { onStatus, onLog, signal });
    emitDiagnostic(onLog, 'PROCESS', 'Monitoramento do processamento concluído.', { group: groupValue });

    onStatus('Grupo ' + groupValue + ': aguardando retorno à lista de comissões...');
    await waitForElement(
      source,
      (currentDoc) => isCommissionPanelReady(currentDoc) ? true : null,
      POLL_INTERVAL_MS,
      signal
    );

    return { ok: true, generated: true };
  }

  function formatCentsBR(cents) {
    const value = Number(cents) || 0;
    const negative = value < 0;
    const absolute = Math.abs(Math.trunc(value));
    const integer = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const decimal = String(absolute % 100).padStart(2, '0');
    return (negative ? '-' : '') + integer + ',' + decimal;
  }

  async function waitForGeneratedCommissionLot(source, groupValue, context) {
    const onStatus = context && typeof context.onStatus === 'function' ? context.onStatus : function () {};
    const onLog = context && typeof context.onLog === 'function' ? context.onLog : function () {};
    const signal = context && context.signal;
    const timeoutMs = context && Number.isFinite(Number(context.timeoutMs)) ? Math.max(0, Number(context.timeoutMs)) : POST_GENERATION_VERIFY_TIMEOUT_MS;
    const pollMs = context && Number.isFinite(Number(context.pollMs)) ? Math.max(1, Number(context.pollMs)) : 500;
    onStatus('Grupo ' + groupValue + ': validando o lote na tabela antes de continuar...');

    let finalInfo = null;
    const confirmed = await waitForCondition(() => {
      finalInfo = getExistingCommissionLotInfo(source, groupValue);
      return !!(finalInfo && finalInfo.alreadyGenerated && finalInfo.quantity > 0);
    }, timeoutMs, pollMs, signal);

    if (!confirmed) {
      emitDiagnostic(onLog, 'GROUP_VERIFY_MISS', 'Nenhum lote apareceu para o grupo após o processamento; seguindo sem bloquear a rotina.', { group: groupValue, timeoutMs });
      onStatus('Grupo ' + groupValue + ': nenhum lote apareceu após o processamento. Seguindo...');
      return null;
    }

    emitDiagnostic(onLog, 'GROUP_VERIFY', 'Lote confirmado na tabela após a geração.', {
      group: groupValue,
      quantity: finalInfo.quantity
    });
    return finalInfo;
  }

  function shouldSkipLotGeneration(options) {
    return !!(options && options.skipLotGeneration === true);
  }

  function shouldSkipLotApproval(options) {
    return !!(options && options.skipLotApproval === true);
  }

  function shouldSkipPayments(options) {
    return !!(options && options.skipPayments === true);
  }

  function requiresCommissionPanel(options) {
    return !shouldSkipLotGeneration(options) || !shouldSkipLotApproval(options);
  }

  function findActiveElementByExactId(doc, id, expectedTag, predicate) {
    const source = doc || document;
    const wantedId = String(id || '');
    const wantedTag = String(expectedTag || '').toUpperCase();
    if (!wantedId) return null;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('*')); } catch (_) {}
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (String(node.id || '') !== wantedId) continue;
        if (wantedTag && String(node.tagName || '').toUpperCase() !== wantedTag) continue;
        if (!isElementStateActive(node) || isControlLocked(node)) continue;
        if (typeof predicate === 'function') {
          let ok = false;
          try { ok = !!predicate(node); } catch (_) {}
          if (!ok) continue;
        }
        matches.push(node);
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function findCommissionCalculationTab(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const matches = [];
    const seen = new Set();
    const wanted = normalizeText('Calendário/Cálculo de Comissão');

    for (const root of roots) {
      let tabs = [];
      try { tabs = Array.from(root.querySelectorAll('wa-tab-button')); } catch (_) {}
      for (const tab of tabs) {
        if (!tab || seen.has(tab)) continue;
        seen.add(tab);
        if (!isElementStateActive(tab) || isControlLocked(tab)) continue;
        const data = getElementTextData(tab);
        const candidates = [data.text, data.caption, data.title, data.ariaLabel].map(normalizeText).filter(Boolean);
        if (candidates.some((value) => value === wanted)) matches.push(tab);
      }
    }

    return matches.length === 1 ? matches[0] : null;
  }

  function findResumoPorVendedorTab(doc) {
    return findActiveElementByExactId(doc || document, 'BUTTON-COMP6010', 'WA-TAB-BUTTON');
  }

  function findVendorSummaryTables(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const candidates = [];
    const seen = new Set();
    for (const root of roots) {
      let tables = [];
      try { tables = Array.from(root.querySelectorAll('table')); } catch (_) {}
      for (const table of tables) {
        if (!table || seen.has(table)) continue;
        seen.add(table);
        const map = getTableHeaderMap(table);
        if (!map) continue;
        const codeIndex = map.indexOf(['código', 'codigo']);
        const nameIndex = map.indexOf(['nome']);
        const groupIndex = map.indexOf(['grupo comissão', 'grupo comissao']);
        const commissionIndex = map.indexOf(['vl.comissão', 'vl.comissao']);
        const approvedIndex = map.indexOf(['vl.aprovado']);
        const sentPaymentIndex = map.indexOf(['vl.env.pagto']);
        const paidIndex = map.indexOf(['vl.pago']);
        const groupIdIndex = map.indexOf(['id grp comissão', 'id grp comissao']);
        if ([codeIndex, nameIndex, groupIndex, sentPaymentIndex, paidIndex].some((index) => index < 0)) continue;
        if (!isElementStateActive(table)) continue;
        candidates.push({ table, map, codeIndex, nameIndex, groupIndex, commissionIndex, approvedIndex, sentPaymentIndex, paidIndex, groupIdIndex });
      }
    }
    return candidates;
  }

  function findVendorSummaryTable(doc) {
    const tables = findVendorSummaryTables(doc || document);
    return tables.length ? tables[0] : null;
  }

  function makeVendorPaymentIdentity(info) {
    if (!info) return null;
    return {
      code: String(info.code || ''),
      name: String(info.name || ''),
      group: String(info.group || ''),
      groupId: String(info.groupId || '')
    };
  }

  function getVendorPaymentRows(doc) {
    const tables = findVendorSummaryTables(doc || document);
    const rowsOut = [];
    for (const tableInfo of tables) {
      let rows = [];
      try { rows = Array.from(tableInfo.table.querySelectorAll('tbody tr')); } catch (_) {}
      for (const row of rows) {
        let cells = [];
        try { cells = Array.from(row.querySelectorAll('td')); } catch (_) {}
        const maxIndex = Math.max(tableInfo.codeIndex, tableInfo.nameIndex, tableInfo.groupIndex, tableInfo.sentPaymentIndex, tableInfo.paidIndex, Math.max(0, tableInfo.groupIdIndex), Math.max(0, tableInfo.commissionIndex), Math.max(0, tableInfo.approvedIndex));
        if (cells.length <= maxIndex) continue;
        const info = {
          found: true,
          code: String(getNodeText(cells[tableInfo.codeIndex]) || '').trim(),
          name: String(getNodeText(cells[tableInfo.nameIndex]) || '').trim(),
          group: String(getNodeText(cells[tableInfo.groupIndex]) || '').trim(),
          groupId: tableInfo.groupIdIndex >= 0 ? String(getNodeText(cells[tableInfo.groupIdIndex]) || '').trim() : '',
          commissionCents: tableInfo.commissionIndex >= 0 ? parseProtheusMoneyToCents(getNodeText(cells[tableInfo.commissionIndex])) : 0,
          approvedCents: tableInfo.approvedIndex >= 0 ? parseProtheusMoneyToCents(getNodeText(cells[tableInfo.approvedIndex])) : 0,
          sentPaymentCents: parseProtheusMoneyToCents(getNodeText(cells[tableInfo.sentPaymentIndex])),
          paidCents: parseProtheusMoneyToCents(getNodeText(cells[tableInfo.paidIndex])),
          selected: isTableRowSelected(row),
          row,
          selectCell: cells[tableInfo.groupIndex] || cells[tableInfo.sentPaymentIndex] || row
        };
        rowsOut.push(info);
      }
    }
    return rowsOut;
  }

  function isEligibleVendorPaymentGroup(groupName) {
    const normalized = normalizeText(groupName);
    return TARGET_VENDOR_PAYMENT_GROUPS.some((group) => normalizeText(group) === normalized);
  }

  function getPendingExternalCommissionPaymentRows(doc) {
    return getVendorPaymentRows(doc || document).filter((info) => isEligibleVendorPaymentGroup(info.group) && info.sentPaymentCents > 0);
  }

  function getVendorPaymentRowInfo(doc, identity) {
    if (!identity) return null;
    const code = normalizeText(identity.code);
    const name = normalizeText(identity.name);
    const group = normalizeText(identity.group);
    const groupId = normalizeText(identity.groupId);
    const rows = getVendorPaymentRows(doc || document);
    const match = rows.find((info) =>
      normalizeText(info.code) === code &&
      normalizeText(info.name) === name &&
      normalizeText(info.group) === group &&
      (!groupId || normalizeText(info.groupId) === groupId)
    );
    return match || { found: false, code: identity.code, name: identity.name, group: identity.group, groupId: identity.groupId };
  }

  function classifyInternalCommissionExportGroup(groupName) {
    const normalized = normalizeText(groupName);
    for (const column of ['primary', 'sdr', 'additional', 'additional2']) {
      const groups = INTERNAL_COMMISSION_EXPORT_GROUPS[column] || [];
      if (groups.some((group) => normalizeText(group) === normalized)) return column;
    }
    return null;
  }

  function applyInternalCommissionExcelReplications(rows) {
    const list = Array.isArray(rows) ? rows : [];
    for (const rule of INTERNAL_COMMISSION_EXCEL_REPLICATIONS) {
      const source = list.find((row) => normalizeText(row && row.name) === normalizeText(rule.sourceName));
      const target = list.find((row) => normalizeText(row && row.name) === normalizeText(rule.targetName));
      if (!source || !target) continue;
      const sourceValue = Number(source[rule.field] || 0);
      if (!Number.isFinite(sourceValue) || sourceValue === 0) continue;
      const targetValue = Number(target[rule.field] || 0);
      target[rule.field] = (Number.isFinite(targetValue) ? targetValue : 0) + sourceValue;
    }
    return list;
  }

  function getInternalCommissionExportData(doc, referenceDate) {
    const current = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime()) ? referenceDate : new Date();
    const date15 = new Date(current.getFullYear(), current.getMonth(), 15);
    const sourceRows = getVendorPaymentRows(doc || document);
    const aggregated = new Map();

    for (const info of sourceRows) {
      const column = classifyInternalCommissionExportGroup(info.group);
      if (!column) continue;
      const name = String(info.name || '').trim();
      if (!name) continue;
      const cents = Number.isFinite(Number(info.approvedCents)) && Number(info.approvedCents) !== 0
        ? Number(info.approvedCents)
        : Number(info.sentPaymentCents || 0);
      if (!Number.isFinite(cents) || cents === 0) continue;

      const key = normalizeText(name);
      let entry = aggregated.get(key);
      if (!entry) {
        entry = {
          name,
          codes: [],
          primaryCents: 0,
          sdrCents: 0,
          additionalCents: 0,
          additional2Cents: 0,
          sourceGroups: []
        };
        aggregated.set(key, entry);
      }
      if (info.code && !entry.codes.includes(String(info.code))) entry.codes.push(String(info.code));
      if (info.group && !entry.sourceGroups.includes(String(info.group))) entry.sourceGroups.push(String(info.group));
      if (column === 'primary') entry.primaryCents += cents;
      else if (column === 'sdr') entry.sdrCents += cents;
      else if (column === 'additional') entry.additionalCents += cents;
      else if (column === 'additional2') entry.additional2Cents += cents;
    }

    const rows = Array.from(aggregated.values()).map((entry) => {
      const hasPrimary = entry.primaryCents !== 0;
      if (!hasPrimary && entry.sdrCents !== 0) {
        entry.primaryCents = entry.sdrCents;
      } else if (hasPrimary && entry.sdrCents !== 0) {
        entry.additionalCents += entry.sdrCents;
      }
      delete entry.sdrCents;
      return entry;
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    applyInternalCommissionExcelReplications(rows);
    return {
      date: formatDateBR({ day: 15, month: current.getMonth() + 1, year: current.getFullYear() }),
      rows,
      mapping: {
        primary: INTERNAL_COMMISSION_EXPORT_GROUPS.primary.concat(INTERNAL_COMMISSION_EXPORT_GROUPS.sdr),
        additional: INTERNAL_COMMISSION_EXPORT_GROUPS.sdr.concat(INTERNAL_COMMISSION_EXPORT_GROUPS.additional),
        additional2: INTERNAL_COMMISSION_EXPORT_GROUPS.additional2.slice()
      }
    };
  }

  async function runInternalCommissionExcelExport(source, options) {
    const onStatus = options && typeof options.onStatus === 'function' ? options.onStatus : function () {};
    const onLog = options && typeof options.onLog === 'function' ? options.onLog : function () {};
    const signal = options && options.signal;
    const onExport = options && typeof options.onExport === 'function' ? options.onExport : null;
    throwIfAborted(signal);

    onStatus('EXCEL — abrindo Resumo por Vendedor...');
    if (!findVendorSummaryTable(source)) {
      const tab = findResumoPorVendedorTab(source);
      if (!tab) throw new Error('A aba Resumo por Vendedor não foi encontrada para gerar o Excel.');
      emitDiagnostic(onLog, 'EXCEL_TAB', 'Abrindo Resumo por Vendedor para extrair as comissões internas.', { target: describeActionTarget(tab) });
      if (!dispatchWaButtonGesture(tab)) throw new Error('Não foi possível abrir Resumo por Vendedor para gerar o Excel.');
    }

    const tableReady = await waitForCondition(() => !!findVendorSummaryTable(source), 15000, 250, signal);
    if (!tableReady) throw new Error('A tabela Resumo por Vendedor não ficou disponível para gerar o Excel.');

    const data = getInternalCommissionExportData(source, new Date());
    if (!data.rows.length) throw new Error('Nenhuma comissão interna elegível foi encontrada no Resumo por Vendedor.');
    emitDiagnostic(onLog, 'EXCEL_EXTRACT', 'Dados de comissões internas extraídos do Protheus.', {
      date: data.date,
      collaborators: data.rows.length,
      rows: data.rows.map((row) => ({ name: row.name, primaryCents: row.primaryCents, additionalCents: row.additionalCents, additional2Cents: row.additional2Cents }))
    });

    if (!onExport) return { ok: true, data };
    onStatus('EXCEL — atualizando arquivo de comissões internas...');
    const response = await onExport(data);
    throwIfAborted(signal); // não interrompe o Excel no meio de um Save; cancela assim que a operação nativa termina com segurança.
    if (!response || response.ok !== true) throw new Error((response && response.error) || 'O helper do Excel não confirmou a atualização.');
    emitDiagnostic(onLog, 'EXCEL_SYNC_COMPLETE', 'Excel de comissões internas atualizado.', response);
    return {
      ok: true,
      data,
      response,
      detail: 'Excel atualizado: ' + Number(response.updated || 0) + ' colaborador(es).'
    };
  }


  function findPaymentsTab(doc) {
    return findActiveElementByExactId(doc || document, 'BUTTON-COMP6011', 'WA-TAB-BUTTON');
  }

  function isPaymentExtractEmailEmpty(value) {
    const compact = String(value == null ? '' : value).replace(/\s+/g, '').trim();
    if (!compact) return true;
    return /^[\/_\.\-]*$/.test(compact);
  }

  function findPaymentEmailTables(doc) {
    const source = doc || document;
    const roots = collectRoots(source);
    const candidates = [];
    const seen = new Set();

    for (const root of roots) {
      let tables = [];
      try { tables = Array.from(root.querySelectorAll('table')); } catch (_) {}
      for (const table of tables) {
        if (!table || seen.has(table)) continue;
        seen.add(table);
        const map = getTableHeaderMap(table);
        if (!map) continue;
        const codeIndex = map.indexOf(['código', 'codigo']);
        const nameIndex = map.indexOf(['nome']);
        const dueDateIndex = map.indexOf(['vencimento']);
        const amountIndex = map.indexOf(['valor']);
        const extractCodeIndex = map.indexOf(['cod.extrato', 'cod extrato']);
        const extractEmailIndex = map.indexOf(['extrato e-mail', 'extrato email']);
        const recipientIndex = map.indexOf(['e-mail destinatario', 'e-mail destinatário', 'email destinatario', 'email destinatário']);
        if ([codeIndex, nameIndex, dueDateIndex, extractCodeIndex, extractEmailIndex].some((index) => index < 0)) continue;
        if (!isElementStateActive(table)) continue;
        candidates.push({ table, map, codeIndex, nameIndex, dueDateIndex, amountIndex, extractCodeIndex, extractEmailIndex, recipientIndex });
      }
    }
    return candidates;
  }

  function findPaymentEmailTable(doc) {
    const tables = findPaymentEmailTables(doc || document);
    return tables.length ? tables[0] : null;
  }

  function getPaymentEmailRows(doc) {
    const tables = findPaymentEmailTables(doc || document);
    const out = [];
    for (const tableInfo of tables) {
      let rows = [];
      try { rows = Array.from(tableInfo.table.querySelectorAll('tbody tr')); } catch (_) {}
      for (const row of rows) {
        let cells = [];
        try { cells = Array.from(row.querySelectorAll('td')); } catch (_) {}
        const maxIndex = Math.max(
          tableInfo.codeIndex,
          tableInfo.nameIndex,
          tableInfo.dueDateIndex,
          tableInfo.extractCodeIndex,
          tableInfo.extractEmailIndex,
          Math.max(0, tableInfo.amountIndex),
          Math.max(0, tableInfo.recipientIndex)
        );
        if (cells.length <= maxIndex) continue;
        out.push({
          found: true,
          code: String(getNodeText(cells[tableInfo.codeIndex]) || '').trim(),
          name: String(getNodeText(cells[tableInfo.nameIndex]) || '').trim(),
          dueDate: String(getNodeText(cells[tableInfo.dueDateIndex]) || '').trim(),
          amountCents: tableInfo.amountIndex >= 0 ? parseProtheusMoneyToCents(getNodeText(cells[tableInfo.amountIndex])) : 0,
          extractCode: String(getNodeText(cells[tableInfo.extractCodeIndex]) || '').trim(),
          extractEmail: String(getNodeText(cells[tableInfo.extractEmailIndex]) || '').trim(),
          recipient: tableInfo.recipientIndex >= 0 ? String(getNodeText(cells[tableInfo.recipientIndex]) || '').trim() : '',
          selected: isTableRowSelected(row),
          row,
          selectCell: cells[tableInfo.nameIndex] || cells[tableInfo.extractCodeIndex] || row
        });
      }
    }
    return out;
  }

  function makePaymentEmailIdentity(info) {
    if (!info) return null;
    return {
      code: String(info.code || ''),
      name: String(info.name || ''),
      dueDate: String(info.dueDate || ''),
      extractCode: String(info.extractCode || ''),
      recipient: String(info.recipient || '')
    };
  }

  function paymentEmailIdentityMatches(info, identity) {
    if (!info || !identity) return false;
    const fields = ['code', 'name', 'dueDate', 'extractCode', 'recipient'];
    for (const field of fields) {
      const expected = normalizeText(identity[field]);
      if (!expected) continue;
      if (normalizeText(info[field]) !== expected) return false;
    }
    return true;
  }

  function getPaymentEmailRowInfo(doc, identity) {
    const rows = getPaymentEmailRows(doc || document);
    const match = rows.find((info) => paymentEmailIdentityMatches(info, identity));
    return match || Object.assign({ found: false }, identity || {});
  }

  function getPendingPaymentEmailRows(doc) {
    return getPaymentEmailRows(doc || document).filter((info) =>
      !!normalizeText(info.code) &&
      !!normalizeText(info.name) &&
      !!normalizeText(info.extractCode) &&
      isPaymentExtractEmailEmpty(info.extractEmail)
    );
  }

  function findPaymentEmailMenuButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP6123', '');
  }

  function findPositionedExtractMenuItem(doc) {
    return findActiveElementByExactId(doc || document, 'COMP6108', '');
  }

  function findPaymentEmailOkButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP7507', '');
  }

  function findPaymentEmailCloseButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP7512', '');
  }

  async function selectPaymentEmailRow(source, beforeInfo, context) {
    const onStatus = context.onStatus;
    const onLog = context.onLog;
    const signal = context.signal;
    const identity = makePaymentEmailIdentity(beforeInfo);
    const existing = getPaymentEmailRowInfo(source, identity);
    if (existing && existing.found && existing.selected) return existing;

    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfAborted(signal);
      const info = getPaymentEmailRowInfo(source, identity);
      if (!info || !info.found || !info.selectCell) throw new Error('Extrato ' + (beforeInfo.extractCode || beforeInfo.code) + ': a linha deixou de estar disponível durante a seleção.');
      onStatus('E-MAIL — ' + beforeInfo.code + ': selecionando ' + beforeInfo.name + '...');
      emitDiagnostic(onLog, 'EMAIL_ROW_GESTURE', 'Selecionando linha na aba Pagamentos.', {
        code: beforeInfo.code,
        name: beforeInfo.name,
        extractCode: beforeInfo.extractCode,
        attempt,
        target: describeActionTarget(info.selectCell)
      });
      const originalRow = info.row;
      if (dispatchBrowseSelectionGesture(info.selectCell)) {
        const confirmed = await waitForCondition(() => {
          if (originalRow && isTableRowSelected(originalRow)) return true;
          const current = getPaymentEmailRowInfo(source, identity);
          return !!(current && current.found && current.selected);
        }, 1500, 50, signal);
        if (confirmed) return getPaymentEmailRowInfo(source, identity);
      }
      await abortableSleep(250, signal);
    }
    throw new Error('Extrato ' + (beforeInfo.extractCode || beforeInfo.code) + ': não foi possível selecionar a linha com segurança.');
  }

  async function sendPaymentExtractEmail(source, beforeInfo, context) {
    const onStatus = context.onStatus;
    const onLog = context.onLog;
    const signal = context.signal;
    const onTrustedClick = context && typeof context.onTrustedClick === 'function' ? context.onTrustedClick : null;
    const identity = makePaymentEmailIdentity(beforeInfo);
    throwIfAborted(signal);

    const currentBefore = getPaymentEmailRowInfo(source, identity);
    if (currentBefore && currentBefore.found && !isPaymentExtractEmailEmpty(currentBefore.extractEmail)) {
      emitDiagnostic(onLog, 'EMAIL_ALREADY_SENT', 'A linha já recebeu data de Extrato E-mail antes da ação; envio ignorado.', {
        code: currentBefore.code,
        extractCode: currentBefore.extractCode,
        extractEmail: currentBefore.extractEmail
      });
      return { ok: true, skipped: true, before: beforeInfo, after: currentBefore };
    }

    await selectPaymentEmailRow(source, beforeInfo, { onStatus, onLog, signal });
    emitDiagnostic(onLog, 'EMAIL_ROW_SELECTED', 'Linha selecionada para envio do extrato.', {
      code: beforeInfo.code,
      name: beforeInfo.name,
      extractCode: beforeInfo.extractCode,
      recipient: beforeInfo.recipient
    });

    onStatus('E-MAIL — ' + beforeInfo.code + ': abrindo menu E-mail...');
    if (!await performConfirmedClick(source, {
      label: 'E-mail — extrato ' + beforeInfo.extractCode,
      findTarget: findPaymentEmailMenuButton,
      isSuccess: (currentDoc) => !!findPositionedExtractMenuItem(currentDoc),
      triggerTarget: (target) => dispatchWaButtonGesture(target) || clickElement(target),
      onStatus, onLog, signal
    })) throw new Error('Extrato ' + beforeInfo.extractCode + ': o menu E-mail não abriu Extrato (Posicionado).');

    if (!await performConfirmedClick(source, {
      label: 'Extrato (Posicionado) — ' + beforeInfo.extractCode,
      findTarget: findPositionedExtractMenuItem,
      isSuccess: (currentDoc) => !!findPaymentEmailOkButton(currentDoc),
      triggerTarget: (target) => dispatchWaButtonGesture(target) || clickElement(target),
      onStatus, onLog, signal
    })) throw new Error('Extrato ' + beforeInfo.extractCode + ': Extrato (Posicionado) não abriu a confirmação.');

    const okButton = findPaymentEmailOkButton(source);
    if (!okButton) throw new Error('Extrato ' + beforeInfo.extractCode + ': o botão OK da geração do extrato não foi encontrado.');
    onStatus('E-MAIL — ' + beforeInfo.code + ': enviando extrato e aguardando confirmação...');
    emitDiagnostic(onLog, 'EMAIL_SEND_CONFIRM', 'Confirmando o envio do extrato no botão OK.', {
      code: beforeInfo.code,
      name: beforeInfo.name,
      extractCode: beforeInfo.extractCode,
      recipient: beforeInfo.recipient,
      target: describeActionTarget(okButton)
    });

    const triggerEmailOk = async (button, reason) => {
      if (!button) return false;
      if (onTrustedClick) {
        const trusted = await Promise.resolve(onTrustedClick(button));
        emitDiagnostic(onLog, 'EMAIL_SEND_TRUSTED_CLICK', 'OK do envio acionado via Edge/CDP.', {
          code: beforeInfo.code,
          extractCode: beforeInfo.extractCode,
          reason: reason || 'initial',
          trusted: !!trusted,
          target: describeActionTarget(button)
        });
        if (trusted) return true;
      }
      const fallback = dispatchWaButtonGesture(button) || clickElement(button);
      emitDiagnostic(onLog, 'EMAIL_SEND_FALLBACK_CLICK', 'Fallback DOM usado para o OK do envio.', {
        code: beforeInfo.code,
        extractCode: beforeInfo.extractCode,
        reason: reason || 'initial',
        fallback: !!fallback
      });
      return !!fallback;
    };

    // O OK é uma ação com side effect. O clique inicial usa CDP confiável quando
    // disponível. Só permitimos UMA recuperação e apenas quando a MESMA janela
    // de parâmetros continua visível depois do stall, prova de que o Protheus
    // não consumiu o clique anterior.
    if (!await triggerEmailOk(okButton, 'initial')) {
      throw new Error('Extrato ' + beforeInfo.extractCode + ': não foi possível acionar o OK do envio.');
    }

    const resultReady = await waitForConditionWithStateWatchdog(
      () => !!findPaymentEmailCloseButton(source),
      PAYMENT_EMAIL_SEND_TIMEOUT_MS,
      250,
      signal,
      {
        label: 'Envio do extrato ' + beforeInfo.extractCode,
        onLog,
        maxRecoveries: 1,
        inspect: () => {
          if (findPaymentEmailCloseButton(source)) return { action: 'ambiguous', reason: 'resultado-ja-visivel', nextCheckMs: 250 };
          const stillOpen = findPaymentEmailOkButton(source);
          if (stillOpen) return { action: 'recover', reason: 'janela-de-parametros-ainda-visivel', nextCheckMs: 1000 };
          return { action: 'ambiguous', reason: 'processamento-do-email-em-andamento', nextCheckMs: 2000 };
        },
        recover: async () => {
          const currentOk = findPaymentEmailOkButton(source);
          if (!currentOk || findPaymentEmailCloseButton(source)) return false;
          emitDiagnostic(onLog, 'EMAIL_SEND_RECOVERY', 'Janela de parâmetros permaneceu aberta; repetindo o OK uma única vez via clique confiável.', {
            code: beforeInfo.code,
            name: beforeInfo.name,
            extractCode: beforeInfo.extractCode,
            recipient: beforeInfo.recipient,
            target: describeActionTarget(currentOk)
          });
          return await triggerEmailOk(currentOk, 'watchdog-recovery');
        }
      }
    );
    if (!resultReady.matched) throw new Error('Extrato ' + beforeInfo.extractCode + ': o Protheus não exibiu a confirmação Extrato de Comissão dentro do prazo.');

    emitDiagnostic(onLog, 'EMAIL_SEND_RESULT_READY', 'Mensagem Extrato de Comissão disponível para fechamento.', {
      code: beforeInfo.code,
      extractCode: beforeInfo.extractCode
    });

    if (!await performConfirmedClick(source, {
      label: 'Fechar Extrato de Comissão — ' + beforeInfo.extractCode,
      findTarget: findPaymentEmailCloseButton,
      isSuccess: (currentDoc) => !findPaymentEmailCloseButton(currentDoc),
      triggerTarget: (target) => dispatchWaButtonGesture(target) || clickElement(target),
      onStatus, onLog, signal,
      maxAttempts: 3,
      effectTimeoutMs: 5000,
      effectPollMs: 100
    })) throw new Error('Extrato ' + beforeInfo.extractCode + ': a mensagem Extrato de Comissão não fechou.');

    onStatus('E-MAIL — ' + beforeInfo.code + ': aguardando a listagem confirmar o envio...');
    const updated = await waitForConditionWithStateWatchdog(
      () => {
        const info = getPaymentEmailRowInfo(source, identity);
        return !!(info && info.found && !isPaymentExtractEmailEmpty(info.extractEmail));
      },
      PAYMENT_EMAIL_UPDATE_TIMEOUT_MS,
      250,
      signal,
      {
        label: 'Atualização de Extrato E-mail ' + beforeInfo.extractCode,
        onLog,
        maxRecoveries: 0,
        inspect: () => {
          const info = getPaymentEmailRowInfo(source, identity);
          if (!info || !info.found) return { action: 'ambiguous', reason: 'listagem-atualizando-ou-linha-ainda-ausente', nextCheckMs: 1000 };
          if (isPaymentExtractEmailEmpty(info.extractEmail)) return { action: 'ambiguous', reason: 'linha-reapareceu-mas-extrato-email-ainda-vazio', nextCheckMs: 1000 };
          return { action: 'ambiguous', reason: 'data-ja-preenchida', nextCheckMs: 250 };
        }
      }
    );
    if (!updated.matched) throw new Error('Extrato ' + beforeInfo.extractCode + ': o envio terminou, mas Extrato E-mail continuou vazio na listagem.');

    await abortableSleep(PAYMENT_EMAIL_POST_REFRESH_DELAY_MS, signal);
    const afterInfo = getPaymentEmailRowInfo(source, identity);
    if (!afterInfo || !afterInfo.found || isPaymentExtractEmailEmpty(afterInfo.extractEmail)) {
      throw new Error('Extrato ' + beforeInfo.extractCode + ': a dupla verificação não confirmou a data de Extrato E-mail.');
    }

    emitDiagnostic(onLog, 'EMAIL_SEND_COMPLETE', 'Envio confirmado pela data de Extrato E-mail na mesma linha.', {
      code: afterInfo.code,
      name: afterInfo.name,
      extractCode: afterInfo.extractCode,
      extractEmail: afterInfo.extractEmail,
      recipient: afterInfo.recipient
    });
    return { ok: true, skipped: false, before: beforeInfo, after: afterInfo };
  }

  async function runPaymentExtractEmails(source, options) {
    const onStatus = options && typeof options.onStatus === 'function' ? options.onStatus : function () {};
    const onLog = options && typeof options.onLog === 'function' ? options.onLog : function () {};
    const signal = options && options.signal;
    const onTrustedClick = options && typeof options.onTrustedClick === 'function' ? options.onTrustedClick : null;
    throwIfAborted(signal);

    onStatus('E-MAILS — abrindo Pagamentos...');
    if (!findPaymentEmailTable(source)) {
      const tab = findPaymentsTab(source);
      if (!tab) throw new Error('A aba Pagamentos não foi encontrada.');
      emitDiagnostic(onLog, 'EMAIL_TAB', 'Abrindo a aba Pagamentos.', { target: describeActionTarget(tab) });
      if (!dispatchWaButtonGesture(tab)) throw new Error('Não foi possível acionar a aba Pagamentos.');
    } else {
      emitDiagnostic(onLog, 'EMAIL_TAB_READY', 'A aba Pagamentos já estava ativa; navegação desnecessária.');
    }

    const tableReady = await waitForCondition(() => !!findPaymentEmailTable(source), 15000, 250, signal);
    if (!tableReady) throw new Error('A tabela da aba Pagamentos não ficou disponível.');

    const initialPending = getPendingPaymentEmailRows(source);
    emitDiagnostic(onLog, 'EMAIL_SCAN', 'Linhas sem data em Extrato E-mail encontradas.', {
      total: initialPending.length,
      pending: initialPending.map((item) => ({
        code: item.code,
        name: item.name,
        extractCode: item.extractCode,
        recipient: item.recipient,
        extractEmail: item.extractEmail
      }))
    });

    const results = [];
    const total = initialPending.length;
    let index = 0;
    while (true) {
      throwIfAborted(signal);
      const pending = getPendingPaymentEmailRows(source);
      if (!pending.length) break;
      const info = pending[0];
      index += 1;
      onStatus('E-MAIL — ' + index + '/' + total + ': ' + info.code + ' - ' + info.name + '...');
      emitDiagnostic(onLog, 'EMAIL_CANDIDATE', 'Linha elegível para envio do Extrato (Posicionado).', {
        index,
        total,
        code: info.code,
        name: info.name,
        extractCode: info.extractCode,
        recipient: info.recipient
      });
      results.push(await sendPaymentExtractEmail(source, info, { onStatus, onLog, signal, onTrustedClick }));
      if (index > Math.max(2000, total + 50)) throw new Error('A sequência de envio de extratos excedeu o limite de segurança.');
    }

    const remaining = getPendingPaymentEmailRows(source);
    if (remaining.length) throw new Error('O envio de extratos terminou com ' + remaining.length + ' linha(s) ainda sem Extrato E-mail.');
    const sent = results.filter((item) => item && !item.skipped).length;
    emitDiagnostic(onLog, 'EMAIL_SEQUENCE_COMPLETE', 'Envio dos extratos por e-mail concluído.', { sent, total: results.length });
    onStatus('E-MAILS — ' + sent + ' extrato(s) enviado(s) e confirmado(s).');
    return { results, sent };
  }

  function findGeneratePaymentButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP6085', 'WA-BUTTON', (button) => {
      const caption = normalizeText(button.getAttribute && button.getAttribute('caption'));
      return !caption || caption === 'gera pagto';
    });
  }

  function findPaymentDateControl(doc) {
    return findActiveElementByExactId(doc || document, 'COMP7503', 'WA-TEXT-INPUT', (control) => {
      const name = String(control.getAttribute && control.getAttribute('name') || '').toUpperCase();
      const type = normalizeText(control.getAttribute && control.getAttribute('type'));
      return name === 'MV_PAR01' && type === 'date';
    });
  }

  function findPaymentFirstOkButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP7505', 'WA-BUTTON', (button) => {
      return normalizeText(button.getAttribute && button.getAttribute('data-advpl')) === 'sbutton' && normalizeText(button.getAttribute && button.getAttribute('caption')) === 'ok';
    });
  }

  function findPaymentSecondOkButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP7507', 'WA-BUTTON', (button) => {
      return normalizeText(button.getAttribute && button.getAttribute('data-advpl')) === 'sbutton' && normalizeText(button.getAttribute && button.getAttribute('caption')) === 'ok';
    });
  }

  function findPaymentYesButton(doc) {
    return findActiveElementByExactId(doc || document, 'COMP9012', 'WA-BUTTON', (button) => {
      return normalizeText(button.getAttribute && button.getAttribute('data-advpl')) === 'tbrowsebutton';
    });
  }

  function findPaymentProcessingMarker(doc) {
    const source = doc || document;
    const markers = [
      findActiveTextMarker(source, 'processando...', { preferLeaf: true }),
      findActiveTextMarker(source, 'aguarde...', { preferLeaf: true })
    ].filter(Boolean);
    for (const marker of markers) {
      let current = marker;
      let isExtensionUi = false;
      for (let depth = 0; current && depth < 20; depth++) {
        try {
          const id = String(current.id || '');
          if (id.indexOf('positiva-protheus-') === 0) { isExtensionUi = true; break; }
        } catch (_) {}
        current = getComposedParentForState(current);
      }
      if (!isExtensionUi) return marker;
    }
    return null;
  }

  function classifyVendorPaymentStage(signals) {
    const state = signals || {};
    if (state.complete) return 'complete';
    if (state.processingVisible) return 'processing';
    if (state.yesVisible) return 'yes';
    if (state.secondOkVisible) return 'second-confirmation';
    if (state.dateVisible) return 'date';
    if (state.summaryVisible) return 'summary';
    return 'unknown';
  }

  function detectVendorPaymentStage(doc, beforeInfo) {
    const source = doc || document;
    const identity = makeVendorPaymentIdentity(beforeInfo);
    const afterInfo = identity ? getVendorPaymentRowInfo(source, identity) : null;
    return {
      stage: classifyVendorPaymentStage({
        complete: !!(beforeInfo && isVendorPaymentTransitionComplete(beforeInfo, afterInfo)),
        processingVisible: !!findPaymentProcessingMarker(source),
        yesVisible: !!findPaymentYesButton(source),
        secondOkVisible: !!findPaymentSecondOkButton(source),
        dateVisible: !!findPaymentDateControl(source),
        summaryVisible: !!findVendorSummaryTable(source)
      }),
      afterInfo
    };
  }

  function setPaymentDateControlValue(control, parts) {
    if (!control || String(control.id || '') !== 'COMP7503') return false;
    const name = String(control.getAttribute && control.getAttribute('name') || '').toUpperCase();
    if (name !== 'MV_PAR01') return false;
    const inner = getInnerEditable(control);
    if (!inner || isControlLocked(inner)) return false;
    const text = expectedDateInputValue(inner, parts);
    let inputType = '';
    try { inputType = String(inner.type || inner.getAttribute?.('type') || '').toLowerCase(); } catch (_) {}
    try { if (typeof inner.focus === 'function') inner.focus(); } catch (_) {}
    try { if (typeof inner.select === 'function') inner.select(); } catch (_) {}

    if (inputType === 'date') {
      if (!setNativeEditableValue(inner, text)) return false;
      dispatchSyntheticEvent(inner, 'input', { data: text, inputType: 'insertText' });
    } else {
      if (!setNativeEditableValue(inner, '')) return false;
      let current = '';
      for (const char of text) {
        dispatchSyntheticEvent(inner, 'keydown', { key: char, data: char });
        dispatchSyntheticEvent(inner, 'beforeinput', { data: char, inputType: 'insertText' });
        current += char;
        if (!setNativeEditableValue(inner, current)) return false;
        dispatchSyntheticEvent(inner, 'input', { data: char, inputType: 'insertText' });
        dispatchSyntheticEvent(inner, 'keyup', { key: char, data: char });
      }
    }

    dispatchSyntheticEvent(inner, 'change');
    try { if (typeof inner.blur === 'function') inner.blur(); } catch (_) {}
    return String(inner.value == null ? '' : inner.value) === text;
  }

  async function fillPaymentDateReliably(doc, parts, signal) {
    const source = doc || document;
    for (let attempt = 1; attempt <= 5; attempt++) {
      throwIfAborted(signal);
      const control = findPaymentDateControl(source);
      if (control && setPaymentDateControlValue(control, parts)) {
        await abortableSleep(200, signal);
        const verify = findPaymentDateControl(source);
        const inner = getInnerEditable(verify);
        if (verify && inner && String(inner.value == null ? '' : inner.value) === expectedDateInputValue(inner, parts)) return true;
      }
      await abortableSleep(300, signal);
    }
    return false;
  }

  function isVendorPaymentTransitionComplete(before, after) {
    if (!before || !after || !after.found) return false;
    if (before.sentPaymentCents <= 0) return after.sentPaymentCents === 0;
    return after.sentPaymentCents === 0 && after.paidCents === before.paidCents + before.sentPaymentCents;
  }

  async function selectVendorPaymentRow(source, beforeInfo, context) {
    const onStatus = context.onStatus;
    const onLog = context.onLog;
    const signal = context.signal;
    const identity = makeVendorPaymentIdentity(beforeInfo);
    const current = getVendorPaymentRowInfo(source, identity);
    if (current && current.found && current.selected) return current;

    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfAborted(signal);
      const info = getVendorPaymentRowInfo(source, identity);
      if (!info || !info.found || !info.selectCell) throw new Error('Vendedor ' + beforeInfo.code + ': a linha deixou de estar disponível para geração do pagamento.');
      onStatus('PAGAMENTO — ' + beforeInfo.code + ': selecionando ' + beforeInfo.name + '...');
      emitDiagnostic(onLog, 'PAYMENT_ROW_GESTURE', 'Selecionando comissão externa no Resumo por Vendedor.', {
        code: beforeInfo.code,
        name: beforeInfo.name,
        attempt,
        target: describeActionTarget(info.selectCell)
      });
      const originalRow = info.row;
      if (dispatchBrowseSelectionGesture(info.selectCell)) {
        const confirmed = await waitForCondition(() => {
          if (originalRow && isTableRowSelected(originalRow)) return true;
          const refreshed = getVendorPaymentRowInfo(source, identity);
          return !!(refreshed && refreshed.found && refreshed.selected);
        }, 1800, 60, signal);
        if (confirmed) return getVendorPaymentRowInfo(source, identity) || info;
      }
      if (attempt < 3) await abortableSleep(250, signal);
    }
    throw new Error('Vendedor ' + beforeInfo.code + ': o Protheus não confirmou a seleção da linha para pagamento.');
  }

  async function recoverVendorPaymentFromStage(source, beforeInfo, stage, context) {
    const opts = context || {};
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const signal = opts.signal;
    const code = beforeInfo && beforeInfo.code ? String(beforeInfo.code) : '';
    let currentStage = String(stage || 'unknown');

    for (let hop = 0; hop < 4; hop++) {
      throwIfAborted(signal);
      if (currentStage === 'complete' || currentStage === 'processing') return true;

      if (currentStage === 'date') {
        const paymentDate = calculateCommissionDates(new Date()).dataPagto;
        onStatus('WATCHDOG — ' + code + ': a janela de data ainda está aberta; reconciliando esta etapa...');
        if (!await fillPaymentDateReliably(source, paymentDate, signal)) return false;
        if (!await performConfirmedClick(source, {
          label: 'Watchdog — OK da data — vendedor ' + code,
          findTarget: findPaymentFirstOkButton,
          isSuccess: (currentDoc) => !!findPaymentSecondOkButton(currentDoc) || !!findPaymentYesButton(currentDoc),
          onStatus, onLog, signal,
          maxAttempts: 1,
          successStabilityMs: 250
        })) return false;
      } else if (currentStage === 'second-confirmation') {
        onStatus('WATCHDOG — ' + code + ': a confirmação anterior ainda está aberta; reconciliando esta etapa...');
        if (!await performConfirmedClick(source, {
          label: 'Watchdog — OK da confirmação — vendedor ' + code,
          findTarget: findPaymentSecondOkButton,
          isSuccess: (currentDoc) => !!findPaymentYesButton(currentDoc),
          onStatus, onLog, signal,
          maxAttempts: 1,
          successStabilityMs: 250
        })) return false;
      } else if (currentStage === 'yes') {
        const identity = makeVendorPaymentIdentity(beforeInfo);
        const currentInfo = getVendorPaymentRowInfo(source, identity);
        if (!currentInfo || !currentInfo.found || currentInfo.sentPaymentCents !== beforeInfo.sentPaymentCents || currentInfo.paidCents !== beforeInfo.paidCents) {
          emitDiagnostic(onLog, 'STATE_WATCHDOG_FINANCIAL_RETRY_BLOCKED', 'O estado financeiro mudou durante a reconciliação; o botão Sim não será repetido.', { code });
          return false;
        }
        if (findPaymentProcessingMarker(source)) {
          emitDiagnostic(onLog, 'STATE_WATCHDOG_FINANCIAL_RETRY_BLOCKED', 'Processamento já visível; o botão Sim não será repetido.', { code });
          return true;
        }
        const yesStable = await waitForStableCondition(() => !!findPaymentYesButton(source), 700, 75, 450, signal);
        if (!yesStable) {
          emitDiagnostic(onLog, 'STATE_WATCHDOG_FINANCIAL_RETRY_BLOCKED', 'A confirmação Sim não permaneceu estável o bastante para uma repetição segura.', { code });
          return false;
        }
        onStatus('WATCHDOG — ' + code + ': a confirmação Sim continua aberta; realizando uma única recuperação segura...');
        return confirmVendorPaymentYes(source, beforeInfo, { onStatus, onLog, signal, maxAttempts: 1, successStabilityMs: 500 });
      } else {
        return false;
      }

      const detected = detectVendorPaymentStage(source, beforeInfo);
      currentStage = detected && detected.stage ? detected.stage : 'unknown';
    }

    return false;
  }

  async function waitForVendorPaymentUpdateWithWatchdog(source, beforeInfo, context) {
    const opts = context || {};
    const signal = opts.signal;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const timeoutMs = Math.max(100, Number(opts.timeoutMs) || VENDOR_PAYMENT_UPDATE_TIMEOUT_MS);
    const pollMs = Math.max(25, Number(opts.pollMs) || 500);
    const watchdogStallMs = Math.max(25, Number(opts.watchdogStallMs) || STATE_WATCHDOG_STALL_MS);
    const watchdogRecheckMs = Math.max(25, Number(opts.watchdogRecheckMs) || STATE_WATCHDOG_RECHECK_MS);
    const identity = makeVendorPaymentIdentity(beforeInfo);
    const readAfter = typeof opts.readAfter === 'function' ? opts.readAfter : () => getVendorPaymentRowInfo(source, identity);
    const detectStage = typeof opts.detectStage === 'function' ? opts.detectStage : () => detectVendorPaymentStage(source, beforeInfo);
    const recoverStage = typeof opts.recoverStage === 'function'
      ? opts.recoverStage
      : (stage) => recoverVendorPaymentFromStage(source, beforeInfo, stage, opts);
    let afterInfo = null;

    const watched = await waitForConditionWithStateWatchdog(() => {
      afterInfo = readAfter();
      return isVendorPaymentTransitionComplete(beforeInfo, afterInfo);
    }, timeoutMs, pollMs, signal, {
      label: 'Pagamento ' + String(beforeInfo && beforeInfo.code || ''),
      stallMs: watchdogStallMs,
      recheckMs: watchdogRecheckMs,
      maxRecoveries: 1,
      onLog,
      inspect: async () => {
        const detected = await Promise.resolve(detectStage());
        const stage = typeof detected === 'string' ? detected : String(detected && detected.stage || 'unknown');
        if (stage === 'complete') return { action: 'continue', reason: stage, stage, nextCheckMs: 2000 };
        if (stage === 'processing') return { action: 'continue', reason: stage, stage, nextCheckMs: 5000 };
        if (stage === 'date' || stage === 'second-confirmation' || stage === 'yes') {
          return { action: 'recover', reason: 'previous-stage-still-active', stage };
        }
        return { action: 'ambiguous', reason: stage || 'unknown', stage };
      },
      recover: async (report) => recoverStage(report && report.stage ? report.stage : 'unknown')
    });

    afterInfo = readAfter();
    return { updated: !!watched.matched && isVendorPaymentTransitionComplete(beforeInfo, afterInfo), afterInfo, watchdog: watched };
  }

  async function waitForVendorPaymentUpdate(source, beforeInfo, context) {
    return waitForVendorPaymentUpdateWithWatchdog(source, beforeInfo, context || {});
  }

  async function confirmVendorPaymentYes(source, beforeInfo, context) {
    const opts = context || {};
    const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    const signal = opts.signal;
    const effectTimeoutMs = Math.max(100, Number(opts.effectTimeoutMs) || 5000);
    const effectPollMs = Math.max(25, Number(opts.effectPollMs) || 100);
    const successStabilityMs = Math.max(100, Number(opts.successStabilityMs) || 500);
    const maxAttempts = Math.max(1, Number(opts.maxAttempts) || 3);
    const code = beforeInfo && beforeInfo.code ? String(beforeInfo.code) : '';

    const confirmed = await performConfirmedClick(source, {
      label: 'Sim da confirmação final — vendedor ' + code,
      findTarget: findPaymentYesButton,
      isSuccess: (currentDoc) => !findPaymentYesButton(currentDoc),
      triggerTarget: (target) => dispatchWaButtonGesture(target) || clickElement(target),
      onStatus,
      onLog,
      signal,
      maxAttempts,
      effectTimeoutMs,
      effectPollMs,
      successStabilityMs,
      retryDelayMs: 300
    });

    if (confirmed) {
      emitDiagnostic(onLog, 'PAYMENT_CONFIRM_YES_CONFIRMED', 'O Protheus confirmou o clique no botão Sim com transição estável.', {
        code,
        name: beforeInfo && beforeInfo.name ? beforeInfo.name : '',
        sentPaymentCents: beforeInfo && Number(beforeInfo.sentPaymentCents) || 0,
        stabilityMs: successStabilityMs
      });
    }
    return confirmed;
  }

  async function payExternalCommissionVendor(source, beforeInfo, context) {
    const onStatus = context.onStatus;
    const onLog = context.onLog;
    const signal = context.signal;
    throwIfAborted(signal);
    await selectVendorPaymentRow(source, beforeInfo, { onStatus, onLog, signal });
    emitDiagnostic(onLog, 'PAYMENT_ROW_SELECTED', 'Linha selecionada para geração de pagamento.', {
      code: beforeInfo.code,
      name: beforeInfo.name,
      sentPaymentCents: beforeInfo.sentPaymentCents
    });

    onStatus('PAGAMENTO — ' + beforeInfo.code + ': abrindo Gera Pagto...');
    if (!await performConfirmedClick(source, {
      label: 'Gera Pagto — vendedor ' + beforeInfo.code,
      findTarget: findGeneratePaymentButton,
      isSuccess: (currentDoc) => !!findPaymentDateControl(currentDoc),
      onStatus, onLog, signal
    })) throw new Error('Vendedor ' + beforeInfo.code + ': o botão Gera Pagto foi acionado, mas a janela da data não abriu.');

    const paymentDate = calculateCommissionDates(new Date()).dataPagto;
    onStatus('PAGAMENTO — ' + beforeInfo.code + ': preenchendo Data de Pagamento ' + formatDateBR(paymentDate) + '...');
    if (!await fillPaymentDateReliably(source, paymentDate, signal)) throw new Error('Vendedor ' + beforeInfo.code + ': a Data de Pagamento não permaneceu em ' + formatDateBR(paymentDate) + '.');
    emitDiagnostic(onLog, 'PAYMENT_DATE', 'Data de pagamento preenchida.', { code: beforeInfo.code, date: formatDateBR(paymentDate) });

    if (!await performConfirmedClick(source, {
      label: 'OK da data — vendedor ' + beforeInfo.code,
      findTarget: findPaymentFirstOkButton,
      isSuccess: (currentDoc) => !!findPaymentSecondOkButton(currentDoc),
      onStatus, onLog, signal
    })) throw new Error('Vendedor ' + beforeInfo.code + ': o primeiro OK não abriu a confirmação do pagamento.');

    if (!await performConfirmedClick(source, {
      label: 'OK da confirmação — vendedor ' + beforeInfo.code,
      findTarget: findPaymentSecondOkButton,
      isSuccess: (currentDoc) => !!findPaymentYesButton(currentDoc),
      onStatus, onLog, signal
    })) throw new Error('Vendedor ' + beforeInfo.code + ': o segundo OK não abriu a confirmação de valor.');

    const yesButton = findPaymentYesButton(source);
    if (!yesButton) throw new Error('Vendedor ' + beforeInfo.code + ': o botão Sim da confirmação final não foi encontrado.');
    onStatus('PAGAMENTO — ' + beforeInfo.code + ': confirmando valor...');
    emitDiagnostic(onLog, 'PAYMENT_CONFIRM_YES', 'Confirmando geração do pagamento no botão Sim.', {
      code: beforeInfo.code,
      name: beforeInfo.name,
      sentPaymentCents: beforeInfo.sentPaymentCents,
      target: describeActionTarget(yesButton)
    });
    if (!await confirmVendorPaymentYes(source, beforeInfo, { onStatus, onLog, signal })) {
      throw new Error('Vendedor ' + beforeInfo.code + ': o botão Sim foi acionado, mas a confirmação de valor permaneceu aberta.');
    }

    onStatus('PAGAMENTO — ' + beforeInfo.code + ': aguardando o processamento e a atualização dos valores...');
    const result = await waitForVendorPaymentUpdate(source, beforeInfo, { onStatus, onLog, signal });
    if (!result.updated) {
      emitDiagnostic(onLog, 'PAYMENT_VALIDATION_ERROR', 'O valor não migrou de Vl.Env.Pagto para Vl.Pago no prazo esperado.', {
        code: beforeInfo.code,
        name: beforeInfo.name,
        observed: result.afterInfo && result.afterInfo.found ? { sentPaymentCents: result.afterInfo.sentPaymentCents, paidCents: result.afterInfo.paidCents } : null
      });
      throw new Error('Vendedor ' + beforeInfo.code + ': o pagamento foi confirmado, mas Vl.Env.Pagto/Vl.Pago não atualizaram como esperado.');
    }

    emitDiagnostic(onLog, 'PAYMENT_COMPLETE', 'Pagamento confirmado pelos valores do Resumo por Vendedor.', {
      code: beforeInfo.code,
      name: beforeInfo.name,
      beforeSentPaymentCents: beforeInfo.sentPaymentCents,
      afterSentPaymentCents: result.afterInfo.sentPaymentCents,
      paidCents: result.afterInfo.paidCents
    });
    return { ok: true, before: beforeInfo, after: result.afterInfo };
  }

  async function runExternalCommissionPayments(source, options) {
    const onStatus = options && typeof options.onStatus === 'function' ? options.onStatus : function () {};
    const onLog = options && typeof options.onLog === 'function' ? options.onLog : function () {};
    const signal = options && options.signal;
    throwIfAborted(signal);

    onStatus('PAGAMENTOS — abrindo Resumo por Vendedor...');
    if (!findVendorSummaryTable(source)) {
      const tab = findResumoPorVendedorTab(source);
      if (!tab) throw new Error('A aba Resumo por Vendedor não foi encontrada.');
      emitDiagnostic(onLog, 'PAYMENT_TAB', 'Abrindo a aba Resumo por Vendedor.', { target: describeActionTarget(tab) });
      if (!dispatchWaButtonGesture(tab)) throw new Error('Não foi possível acionar a aba Resumo por Vendedor.');
    }

    const tableReady = await waitForCondition(() => !!findVendorSummaryTable(source), 15000, 250, signal);
    if (!tableReady) throw new Error('A tabela Resumo por Vendedor não ficou disponível.');

    const initialPending = getPendingExternalCommissionPaymentRows(source);
    emitDiagnostic(onLog, 'PAYMENT_SCAN', 'Comissões elegíveis com Vl.Env.Pagto pendente encontradas.', {
      total: initialPending.length,
      pending: initialPending.map((item) => ({ code: item.code, name: item.name, sentPaymentCents: item.sentPaymentCents }))
    });

    const results = [];
    const total = initialPending.length;
    let index = 0;
    while (true) {
      throwIfAborted(signal);
      const pending = getPendingExternalCommissionPaymentRows(source);
      if (!pending.length) break;
      const info = pending[0];
      index += 1;
      onStatus('PAGAMENTO — ' + index + '/' + total + ': ' + info.code + ' - ' + info.name + ' (R$ ' + formatCentsBR(info.sentPaymentCents) + ')...');
      emitDiagnostic(onLog, 'PAYMENT_CANDIDATE', 'Comissão elegível para geração de pagamento.', {
        index,
        total,
        code: info.code,
        name: info.name,
        group: info.group,
        sentPaymentCents: info.sentPaymentCents
      });
      results.push(await payExternalCommissionVendor(source, info, { onStatus, onLog, signal }));
      if (index > Math.max(1000, total + 20)) throw new Error('A sequência de pagamentos excedeu o limite de segurança.');
    }

    const remaining = getPendingExternalCommissionPaymentRows(source);
    if (remaining.length) throw new Error('A geração de pagamentos terminou com ' + remaining.length + ' comissão(ões) elegível(is) ainda em Vl.Env.Pagto.');
    emitDiagnostic(onLog, 'PAYMENT_SEQUENCE_COMPLETE', 'Geração de pagamentos elegíveis concluída.', { processed: results.length });
    onStatus('PAGAMENTOS — ' + results.length + ' pagamento(s) elegível(is) processado(s).');
    return { results, processed: results.length };
  }

  async function waitForApprovalGroupInfo(source, groupValue, signal) {
    let info = null;
    const available = await waitForCondition(() => {
      info = getCommissionApprovalRowInfo(source, groupValue);
      return !!info;
    }, 10000, 250, signal);
    if (!available || !info) throw new Error('Grupo ' + groupValue + ': a tabela principal não ficou disponível para aprovação.');
    return info;
  }

  async function selectCommissionGroupForApproval(source, groupValue, context) {
    const onStatus = context.onStatus;
    const onLog = context.onLog;
    const signal = context.signal;
    const existing = getCommissionApprovalRowInfo(source, groupValue);
    if (existing && existing.found && existing.selected) return existing;

    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfAborted(signal);
      const info = getCommissionApprovalRowInfo(source, groupValue);
      if (!info || !info.found || !info.selectCell) {
        throw new Error('Grupo ' + groupValue + ': a linha deixou de estar disponível durante a seleção.');
      }

      onStatus('Selecionar grupo ' + groupValue + ' para aprovação: acionando (tentativa ' + attempt + '/3)...');
      emitDiagnostic(onLog, 'APPROVAL_ROW_GESTURE', 'Enviando gesto completo de seleção ao browse do Protheus.', {
        group: groupValue,
        attempt,
        target: describeActionTarget(info.selectCell)
      });

      const originalRow = info.row;
      if (!dispatchBrowseSelectionGesture(info.selectCell)) {
        emitDiagnostic(onLog, 'APPROVAL_ROW_GESTURE_FAIL', 'Não foi possível enviar o gesto de seleção ao browse.', { group: groupValue, attempt });
      } else {
        const confirmed = await waitForCondition(() => {
          if (originalRow && isTableRowSelected(originalRow)) return true;
          const current = getCommissionApprovalRowInfo(source, groupValue);
          return !!(current && current.found && current.selected);
        }, 1500, 50, signal);

        if (confirmed) {
          const selectedInfo = getCommissionApprovalRowInfo(source, groupValue);
          emitDiagnostic(onLog, 'APPROVAL_ROW_SELECTION_CONFIRMED', 'Seleção da linha confirmada pelo estado do browse.', {
            group: groupValue,
            attempt,
            rowClass: selectedInfo && selectedInfo.row ? String(selectedInfo.row.getAttribute && selectedInfo.row.getAttribute('class') || selectedInfo.row.className || '') : ''
          });
          return selectedInfo || info;
        }
      }

      emitDiagnostic(onLog, 'APPROVAL_ROW_SELECTION_RETRY', 'O browse não marcou a linha como selecionada; preparando nova tentativa.', { group: groupValue, attempt });
      if (attempt < 3) await abortableSleep(250, signal);
    }

    throw new Error('Grupo ' + groupValue + ': o browse do Protheus não marcou a linha como selecionada após o gesto de mouse.');
  }

  async function approveCommissionGroup(source, groupValue, beforeInfo, context) {
    const onStatus = context.onStatus;
    const onLog = context.onLog;
    const signal = context.signal;
    throwIfAborted(signal);

    if (findApprovalLotTable(source)) {
      throw new Error('Grupo ' + groupValue + ': já existe uma janela de Encerramento de lotes aberta antes da seleção.');
    }

    onStatus('APROVAÇÃO — Grupo ' + groupValue + ': selecionando R$ ' + formatCentsBR(beforeInfo.openCents) + ' em aberto...');
    await selectCommissionGroupForApproval(source, groupValue, { onStatus, onLog, signal });
    emitDiagnostic(onLog, 'APPROVAL_ROW_SELECTED', 'Linha do grupo selecionada para aprovação.', {
      group: groupValue,
      openCents: beforeInfo.openCents
    });

    onStatus('APROVAÇÃO — Grupo ' + groupValue + ': abrindo Encerramento de lotes...');
    if (!await performConfirmedClick(source, {
      label: 'Aprovar — grupo ' + groupValue,
      findTarget: findCommissionApproveButton,
      isSuccess: (currentDoc) => !!findApprovalLotTable(currentDoc),
      onStatus,
      onLog,
      signal
    })) throw new Error('Grupo ' + groupValue + ': o botão Aprovar foi acionado, mas a janela de Encerramento de lotes não abriu.');

    const lotRows = getApprovalLotRows(source);
    if (!lotRows.length) throw new Error('Grupo ' + groupValue + ': nenhum lote apareceu na janela de aprovação.');
    emitDiagnostic(onLog, 'APPROVAL_LOTS_FOUND', 'Lotes encontrados na janela de aprovação.', {
      group: groupValue,
      lots: lotRows.length,
      expectedQuantity: beforeInfo.quantity
    });

    onStatus('APROVAÇÃO — Grupo ' + groupValue + ': marcando todos os ' + lotRows.length + ' lote(s)...');
    const selection = await markAllApprovalLots(source, { onLog, signal, pollMs: 100, timeoutMs: 3000 });
    const uncheckedAfter = getUncheckedApprovalLotCheckboxes(source);
    if (uncheckedAfter.length) throw new Error('Grupo ' + groupValue + ': ainda existem ' + uncheckedAfter.length + ' lote(s) desmarcado(s).');
    emitDiagnostic(onLog, 'APPROVAL_SELECTION_CONFIRMED', 'Todos os lotes ficaram marcados.', {
      group: groupValue,
      total: selection.total,
      selected: selection.selected
    });

    onStatus('APROVAÇÃO — Grupo ' + groupValue + ': confirmando ' + selection.total + ' lote(s)...');
    if (!await performConfirmedClick(source, {
      label: 'Confirmar aprovação — grupo ' + groupValue,
      findTarget: findApprovalConfirmButton,
      isSuccess: (currentDoc) => !findApprovalLotTable(currentDoc),
      maxAttempts: 1,
      effectTimeoutMs: 15000,
      effectPollMs: 250,
      retryDelayMs: 0,
      onStatus,
      onLog,
      signal
    })) throw new Error('Grupo ' + groupValue + ': o Protheus não confirmou o fechamento da janela após Confirmar.');

    emitDiagnostic(onLog, 'APPROVAL_CONFIRM', 'Confirmação de aprovação enviada; aguardando reflexo financeiro.', {
      group: groupValue,
      before: {
        openCents: beforeInfo.openCents,
        approvedCents: beforeInfo.approvedCents,
        sentPaymentCents: beforeInfo.sentPaymentCents
      }
    });

    onStatus('APROVAÇÃO — Grupo ' + groupValue + ': aguardando atualização dos valores...');
    const financialResult = await waitForApprovalFinancialUpdate(source, groupValue, beforeInfo, {
      onStatus,
      onLog,
      signal,
      timeoutMs: APPROVAL_UPDATE_TIMEOUT_MS,
      pollMs: 500
    });
    const afterInfo = financialResult.afterInfo;

    if (!financialResult.updated) {
      const observed = afterInfo && afterInfo.found ? {
        openCents: afterInfo.openCents,
        approvedCents: afterInfo.approvedCents,
        sentPaymentCents: afterInfo.sentPaymentCents
      } : null;
      emitDiagnostic(onLog, 'APPROVAL_VALIDATION_ERROR', 'Os valores não refletiram a aprovação esperada.', {
        group: groupValue,
        observed
      });
      throw new Error('Grupo ' + groupValue + ': a aprovação foi confirmada, mas Vl.Aberto/Vl.Aprovado/Vl.Env.Pagto não atualizaram como esperado.');
    }

    emitDiagnostic(onLog, 'APPROVAL_COMPLETE', 'Aprovação do grupo confirmada pelos valores da tabela.', {
      group: groupValue,
      beforeOpenCents: beforeInfo.openCents,
      afterOpenCents: afterInfo.openCents,
      approvedCents: afterInfo.approvedCents,
      sentPaymentCents: afterInfo.sentPaymentCents
    });
    onStatus('APROVAÇÃO — Grupo ' + groupValue + ': concluído.');
    return { ok: true, after: afterInfo, lots: selection.total };
  }

  async function runCommissionApprovals(source, options) {
    const onStatus = options && typeof options.onStatus === 'function' ? options.onStatus : function () {};
    const onLog = options && typeof options.onLog === 'function' ? options.onLog : function () {};
    const signal = options && options.signal;

    onStatus('APROVAÇÃO — analisando valores em aberto...');
    const tableReady = await waitForCondition(() => !!findCommissionMainTable(source), 10000, 250, signal);
    if (!tableReady) throw new Error('A tabela de comissões não ficou disponível para iniciar as aprovações.');

    const initialPending = getPendingCommissionApprovalGroups(source, COMMISSION_GROUP_VALUES);
    emitDiagnostic(onLog, 'APPROVAL_SCAN', 'Varredura inicial de grupos com Vl.Aberto.', {
      pending: initialPending.map((item) => ({ group: item.group, openCents: item.openCents }))
    });

    const results = await processCommissionApprovalSequence(COMMISSION_GROUP_VALUES, {
      onGroupStart: async (groupValue, index, total) => {
        throwIfAborted(signal);
        onStatus('APROVAÇÃO — Grupo ' + groupValue + ' (' + (index + 1) + '/' + total + '): verificando Vl.Aberto...');
      },
      readGroup: async (groupValue) => waitForApprovalGroupInfo(source, groupValue, signal),
      onSkip: async (groupValue, info) => {
        const found = !!(info && info.found);
        emitDiagnostic(onLog, 'APPROVAL_SKIP', found ? 'Grupo sem valor em aberto; aprovação ignorada.' : 'Grupo não possui linha/lote na tabela; aprovação ignorada.', {
          group: groupValue,
          found,
          openCents: info && Number.isFinite(Number(info.openCents)) ? Number(info.openCents) : 0
        });
      },
      approveGroup: async (groupValue, info) => {
        emitDiagnostic(onLog, 'APPROVAL_CANDIDATE', 'Grupo elegível para aprovação.', {
          group: groupValue,
          openCents: info.openCents,
          quantity: info.quantity
        });
        return approveCommissionGroup(source, groupValue, info, { onStatus, onLog, signal });
      }
    });

    const finalPending = getPendingCommissionApprovalGroups(source, COMMISSION_GROUP_VALUES);
    if (finalPending.length) {
      emitDiagnostic(onLog, 'APPROVAL_FINAL_CHECK_FAIL', 'Ainda existem grupos com Vl.Aberto após a sequência.', {
        pending: finalPending.map((item) => ({ group: item.group, openCents: item.openCents }))
      });
      throw new Error('A aprovação terminou com ' + finalPending.length + ' grupo(s) ainda possuindo Vl.Aberto.');
    }

    const approved = results.filter((item) => item.approved).length;
    const skipped = results.filter((item) => item.skipped).length;
    emitDiagnostic(onLog, 'APPROVAL_SEQUENCE_COMPLETE', 'Sequência de aprovação concluída.', { approved, skipped });
    return { results, approved, skipped };
  }

  async function runEmissaoComissoes(doc, options) {
    options = options || {};
    const source = doc || document;
    const onStatus = options && typeof options.onStatus === 'function' ? options.onStatus : function () {};
    const onLog = options && typeof options.onLog === 'function' ? options.onLog : function () {};
    const signal = options && options.signal;
    throwIfAborted(signal);

    if (options && typeof options.ensureBackgroundProtection === 'function') {
      onStatus('Preparando execução segura em segundo plano...');
      emitDiagnostic(onLog, 'BACKGROUND', 'Solicitando proteção de segundo plano antes da primeira ação.');
      await options.ensureBackgroundProtection();
      emitDiagnostic(onLog, 'BACKGROUND', 'Proteção de segundo plano confirmada antes da primeira ação.');
    }

    const skipLotGeneration = shouldSkipLotGeneration(options);
    const skipLotApproval = shouldSkipLotApproval(options);
    const skipPayments = shouldSkipPayments(options);

    if (requiresCommissionPanel(options)) {
      onStatus('Preparando a etapa de lotes no Painel Comissões a Pagar...');

      if (!isCommissionPanelReady(source)) {
        const calculationTab = findCommissionCalculationTab(source);
        if (calculationTab) {
          emitDiagnostic(onLog, 'SMART_PHASE_NAVIGATION', 'A rotina estava em outra aba; retornando para Calendário/Cálculo de Comissão.', {
            target: describeActionTarget(calculationTab)
          });
          dispatchWaButtonGesture(calculationTab);
          await waitForCondition(() => isCommissionPanelReady(source), 5000, 150, signal);
        }
      }

      if (!isCommissionPanelReady(source)) {
        if (!await performConfirmedClick(source, {
          label: 'Painel Comissões a Pagar',
          findTarget: findPainelComissoesPagar,
          isSuccess: isCommissionPanelReady,
          onStatus, onLog, signal
        })) throw new Error('Painel Comissões a Pagar foi acionado, mas o Protheus não confirmou a abertura da tela.');
      } else {
        emitDiagnostic(onLog, 'SMART_PHASE_READY', 'Painel de comissões já está pronto para a etapa necessária.');
      }
    } else {
      emitDiagnostic(onLog, 'SMART_PHASE_ENTRY', 'Geração e aprovação foram puladas; a rotina não exigirá o Painel Comissões a Pagar antes dos pagamentos.');
    }

    let results = [];
    let generatedCount = 0;
    let skippedCount = 0;

    if (skipLotGeneration) {
      onStatus(skipLotApproval
        ? (skipPayments
          ? 'Geração e aprovação puladas. Gera Pagto e Excel serão ignorados; envio de extratos seguirá no final...'
          : 'Geração e aprovação puladas. Indo direto para os pagamentos...')
        : 'Geração de lotes pulada. Indo direto para a aprovação...');
      emitDiagnostic(onLog, 'GENERATION_SKIP_REQUESTED', 'Usuário optou por pular a geração de lotes e iniciar diretamente a aprovação.');
    } else {
      const dates = calculateCommissionDates(new Date());
      emitDiagnostic(onLog, 'DATES', 'Datas calculadas para toda a sequência.', {
        baixaDe: formatDateBR(dates.baixaDe),
        baixaAte: formatDateBR(dates.baixaAte),
        dataPagto: formatDateBR(dates.dataPagto),
        groups: COMMISSION_GROUP_VALUES.slice()
      });

      results = await processCommissionGroupSequence(COMMISSION_GROUP_VALUES, {
        onGroupStart: async (groupValue, index, total) => {
          throwIfAborted(signal);
          onStatus('Grupo ' + groupValue + ' (' + (index + 1) + '/' + total + '): verificando se já possui lote gerado...');
          emitDiagnostic(onLog, 'GROUP_START', 'Iniciando verificação do grupo.', { group: groupValue, index: index + 1, total });
        },
        checkGroup: async (groupValue, index, total) => {
          emitDiagnostic(onLog, 'CHECK', 'Verificando lote pré-existente.', { group: groupValue, index: index + 1, total });
          const existingLot = await waitForElement(
            source,
            (currentDoc) => getExistingCommissionLotInfo(currentDoc, groupValue),
            POLL_INTERVAL_MS,
            signal
          );
          emitDiagnostic(onLog, 'CHECK_RESULT', 'Resultado da verificação de lote pré-existente.', Object.assign({ group: groupValue, index: index + 1, total }, existingLot));
          return existingLot;
        },
        onSkip: async (groupValue, existingLot, index, total) => {
          onStatus('Grupo ' + groupValue + ' (' + (index + 1) + '/' + total + '): já possui ' + existingLot.quantity + ' lote(s). Pulando...');
          emitDiagnostic(onLog, 'GROUP_SKIP', 'Grupo já possui lote. Geração ignorada.', { group: groupValue, quantity: existingLot.quantity, index: index + 1, total });
        },
        generateGroup: async (groupValue, index, total) => {
          onStatus('Grupo ' + groupValue + ' (' + (index + 1) + '/' + total + '): sem lote. Iniciando geração...');
          emitDiagnostic(onLog, 'GROUP_GENERATE', 'Grupo sem lote. Iniciando geração.', { group: groupValue, index: index + 1, total });
          const result = await generateCommissionGroup(source, groupValue, dates, { onStatus, onLog, signal });
          const verifiedLot = await waitForGeneratedCommissionLot(source, groupValue, { onStatus, onLog, signal });
          if (verifiedLot) {
            emitDiagnostic(onLog, 'GROUP_COMPLETE', 'Geração do grupo concluída e confirmada na tabela.', {
              group: groupValue,
              quantity: verifiedLot.quantity,
              index: index + 1,
              total
            });
          } else {
            emitDiagnostic(onLog, 'GROUP_COMPLETE_NO_LOT', 'Processamento do grupo terminou sem linha de lote visível; rotina continuará.', {
              group: groupValue,
              index: index + 1,
              total
            });
          }
          return Object.assign({}, result || {}, {
            verifiedQuantity: verifiedLot ? verifiedLot.quantity : 0,
            noLotAfterProcessing: !verifiedLot
          });
        }
      });

      generatedCount = results.filter((item) => !item.skipped).length;
      skippedCount = results.filter((item) => item.skipped).length;
      onStatus('Sequência concluída: ' + generatedCount + ' grupo(s) processado(s) e ' + skippedCount + ' já existente(s).');
      emitDiagnostic(onLog, 'SEQUENCE_COMPLETE', 'Sequência de grupos concluída.', {
        total: results.length,
        generated: generatedCount,
        skipped: skippedCount,
        groups: results
      });
    }

    let approval = { results: [], approved: 0, skipped: 0 };
    if (skipLotApproval) {
      onStatus(skipPayments
        ? 'Aprovação de lotes pulada. Gera Pagto e Excel serão ignorados; envio de extratos seguirá no final...'
        : 'Aprovação de lotes pulada. Indo direto para os pagamentos...');
      emitDiagnostic(onLog, 'APPROVAL_SKIP_REQUESTED', 'Usuário optou por pular a aprovação dos lotes e iniciar a etapa de pagamentos.');
    } else {
      approval = await runCommissionApprovals(source, { onStatus, onLog, signal });
    }

    let payments = { results: [], processed: 0 };
    let excelSync = null;
    let emailDispatch = { results: [], sent: 0 };
    let finalDetail = CONTINUATION_MESSAGE;

    if (skipPayments) {
      onStatus('Gera Pagto e atualização do Excel pulados. Indo direto ao envio dos extratos por e-mail...');
      emitDiagnostic(onLog, 'PAYMENT_SKIP_REQUESTED', 'Usuário optou por pular Gera Pagto; a atualização do Excel também será ignorada, mas o envio de extratos continuará como etapa separada.');
      finalDetail = 'Rotina concluída. Gera Pagto e atualização do Excel foram pulados; o envio de extratos por e-mail foi executado separadamente.';
    } else {
      payments = await runExternalCommissionPayments(source, { onStatus, onLog, signal });
      try {
        excelSync = await runInternalCommissionExcelExport(source, {
          onStatus,
          onLog,
          signal,
          onExport: options.onExcelSync
        });
      } catch (error) {
        const message = error && error.message ? error.message : 'falha desconhecida';
        emitDiagnostic(onLog, 'EXCEL_SYNC_FAIL', 'Pagamentos concluídos, mas a atualização do Excel falhou.', { message });
        throw new Error('Pagamentos concluídos, mas a atualização do Excel falhou: ' + message);
      }
    }

    try {
      emailDispatch = await runPaymentExtractEmails(source, { onStatus, onLog, signal, onTrustedClick: options.onTrustedClick });
    } catch (error) {
      const message = error && error.message ? error.message : 'falha desconhecida';
      emitDiagnostic(onLog, 'EMAIL_SEQUENCE_FAIL', skipPayments ? 'Gera Pagto/Excel foram pulados, mas o envio dos extratos por e-mail falhou.' : 'Excel atualizado, mas o envio dos extratos por e-mail falhou.', { message });
      throw new Error((skipPayments ? 'Gera Pagto e Excel foram pulados, mas o envio dos extratos por e-mail falhou: ' : 'Excel atualizado, mas o envio dos extratos por e-mail falhou: ') + message);
    }

    onStatus(skipPayments
      ? 'Rotina concluída: envio de extratos por e-mail processado (Gera Pagto e Excel pulados).'
      : 'Rotina concluída: pagamentos, Excel e extratos por e-mail processados.');

    if (options && typeof options.onContinuePoint === 'function') {
      options.onContinuePoint(finalDetail);
    }

    return {
      ok: true,
      detail: finalDetail,
      groups: results,
      generated: generatedCount,
      skipped: skippedCount,
      approvals: approval.results,
      approved: approval.approved,
      approvalSkipped: approval.skipped,
      generationSkipped: skipLotGeneration,
      lotApprovalSkipped: skipLotApproval,
      paymentSkipped: skipPayments,
      excelSkipped: skipPayments,
      paymentEmailSkipped: false,
      payments: payments.results,
      paymentsProcessed: payments.processed,
      excelSync,
      paymentEmails: emailDispatch.results,
      paymentEmailsSent: emailDispatch.sent
    };
  }

  return {
    POLL_INTERVAL_MS,
    INTENSIVE_POLL_INTERVAL_MS,
    STATE_WATCH_FALLBACK_MS,
    POST_UPDATE_DELAY_MS,
    POST_PROCESSING_SAFETY_TIMEOUT_MS,
    ACTION_EFFECT_TIMEOUT_MS,
    ACTION_EFFECT_POLL_MS,
    ACTION_RETRY_DELAY_MS,
    ACTION_MAX_ATTEMPTS,
    POST_GENERATION_VERIFY_TIMEOUT_MS,
    APPROVAL_UPDATE_TIMEOUT_MS,
    VENDOR_PAYMENT_UPDATE_TIMEOUT_MS,
    PAYMENT_EMAIL_SEND_TIMEOUT_MS,
    PAYMENT_EMAIL_UPDATE_TIMEOUT_MS,
    PAYMENT_EMAIL_POST_REFRESH_DELAY_MS,
    STATE_WATCHDOG_STALL_MS,
    STATE_WATCHDOG_RECHECK_MS,
    STATE_WATCHDOG_MAX_RECOVERIES,
    ACTION_SUCCESS_STABILITY_MS,
    SOOMAR_STEP_DELAY_DEFAULT_MS,
    SOOMAR_STEP_DELAY_MIN_MS,
    SOOMAR_STEP_DELAY_MAX_MS,
    TARGET_VENDOR_PAYMENT_GROUPS,
    TARGET_EXTERNAL_VENDOR_COMMISSION,
    INTERNAL_COMMISSION_EXPORT_GROUPS,
    INTERNAL_COMMISSION_EXCEL_REPLICATIONS,
    CONTINUATION_MESSAGE,
    PROCESSING_WINDOW_TEXT,
    LOG_WINDOW_TEXT,
    UPDATING_WINDOW_TEXT,
    COMMISSION_GROUP_VALUES,
    normalizeText,
    normalizeSoomarStepDelayMs,
    matchesAnyText,
    getMenuDefinition,
    resolveProtheusEnvironment,
    getRoutineDefinitions,
    normalizeSoomarHistory,
    getSoomarPeriodInfo,
    extractJorgeReimbursementFromPdfBase64,
    buildJorgeReimbursementPreview,
    extractIssGuideNumberFromText,
    getIssCorretoraCompetenceFromFileName,
    getIssCorretoraConferenceFields,
    getIssCorretoraCsvFileNames,
    parseIssCorretoraCsvRecords,
    analyzeIssCorretoraCsvSources,
    extractIssGuideNumberFromDamspBarcode,
    extractIssGuideFromPdfBase64,
    findSoomarExpenseMapping,
    buildSoomarExpensePreview,
    findSoomarEntryOpenButton,
    findSoomarParametersDialog,
    findSoomarParameterCodeControl,
    findSoomarParameterConfirmButton,
    getSoomarParameterEditable,
    readSoomarParameterCode,
    setSoomarParameterCode,
    fillSoomarParameterCodeReliably,
    runSoomarEntryPreparation,
    findIssCorretoraAccountsPayableOption,
    findIssCorretoraUpdatesButton,
    runIssCorretoraAccountsPayableNavigation,
    findIssCorretoraAccountsPayableMarker,
    findIssCorretoraAccountsPayableGrid,
    findIssCorretoraFilterButton,
    getIssCorretoraAccountsPayableReadiness,
    waitForIssCorretoraAccountsPayableReady,
    findIssCorretoraRemoveAppliedFiltersButton,
    findIssFilterNameControl,
    normalizeIssFilterTextValue,
    dispatchIssFilterTextControl,
    dispatchIssFilterDateControl,
    findIssFilterFieldControl,
    findIssFilterOperatorControl,
    findIssFilterExpressionControl,
    setIssFilterComboboxByText,
    readIssFilterComboboxText,
    formatIssDayTenOfCurrentMonth,
    formatIssFilterConditionCaption,
    activateIssFilterManagerCreateButton,
    shouldProceedAfterIssFilterSelectionClick,
    activateIssSavedFilterCheckbox,
    findIssFilterLogicalConnectorButton,
    countIssFilterButtonsByCaption,
    isIssGridFilteredByRules,
    runIssCorretoraDynamicFilter,
    findSoomarUpdatesButton,
    findSoomarUpdatesOption,
    isSoomarUpdatesMenuReady,
    findSoomarExpenseEntryOption,
    findSoomarCollaboratorCodeControl,
    getSoomarCollaboratorEditable,
    readSoomarCollaboratorCode,
    setSoomarCollaboratorCode,
    fillSoomarCollaboratorCodeReliably,
    runSoomarPostParameterNavigation,
    formatSoomarExpenseMoneyInput,
    buildSoomarFirstExpenseCellPlan,
    formatSoomarGridItem,
    getSoomarGridRowItem,
    isSoomarExpectedGridRow,
    findSoomarExpenseGrid,
    findSoomarGridCell,
    getSoomarGridCellText,
    findSoomarNamedGridControl,
    shouldUseSoomarCodeKeyboardFallback,
    typeSoomarCodeWithTrustedKeys,
    findSoomarGridCellEditor,
    getSoomarGridEditorInputValue,
    waitForSoomarGridCellEditor,
    dispatchSoomarGridCellEditGesture,
    setSoomarGridEditableValue,
    isSoomarGridCellCommitted,
    fillSoomarGridCell,
    runSoomarFirstExpenseRow,
    runSoomarExpenseRows,
    normalizeSoomarApprovalDate,
    classifySoomarApprovalContext,
    getSoomarApprovalContext,
    findSoomarFinalConfirmButton,
    findSoomarFinalYesButton,
    findSoomarPostSubmitCloseButton,
    findSoomarEntryWindowCloseButton,
    findSoomarDepartmentApprovalOption,
    findSoomarApprovalBottomButton,
    findSoomarApprovalAnalyzeButton,
    findSoomarApprovalDialog,
    findSoomarApprovalBrowse,
    getSoomarApprovalRowInfo,
    getSoomarApprovalRowsFromBrowse,
    getSoomarApprovalRows,
    waitForSoomarApprovalRows,
    isSoomarApprovalCheckboxChecked,
    didSoomarApprovalCheckboxToggle,
    validateSoomarApprovalRows,
    runSoomarApprovalSelection,
    runSoomarSubmissionAndApprovalSelection,
    collectRoots,
    getElementTextData,
    findElementByText,
    parseProtheusNumber,
    parseProtheusMoneyToCents,
    getCommissionApprovalRowInfo,
    getPendingCommissionApprovalGroups,
    getBrowseSelectionActionTarget,
    dispatchBrowseSelectionGesture,
    findCommissionApproveButton,
    findApprovalLotTable,
    getUncheckedApprovalLotCheckboxes,
    findApprovalMarkAllButton,
    markAllApprovalLots,
    findApprovalConfirmButton,
    findApprovalProcessingDialog,
    findApprovalProcessingConfirmButton,
    waitForApprovalFinancialUpdate,
    isCommissionApprovalTransitionComplete,
    processCommissionApprovalSequence,
    getExistingCommissionLotInfo,
    processCommissionGroupSequence,
    findPainelComissoesPagar,
    findProtheusButtonByCaption,
    describeActionTarget,
    findLoteManualButton,
    isCommissionPanelReady,
    findAvancarButton,
    getRenderedText,
    isElementActive,
    isElementStateActive,
    findActiveTextMarker,
    findTextMarkerAnyState,
    findBestTextMarker,
    findProcessingWindowMarker,
    findCommissionLogMarker,
    findUpdatingListMarker,
    nodeContainsText,
    nodeContainsRenderedText,
    findScopedButtonByText,
    findLogCancelButton,
    createElementStateWatcher,
    findCompletedActiveCycle,
    monitorCommissionProcessing,
    findCalculateNowMarker,
    findFinalizarButton,
    findGrpComissaoControl,
    isExactGrpComissaoControl,
    isControlLocked,
    isExactCommissionDateControl,
    findCommissionDateControl,
    calculateCommissionDates,
    formatDateBR,
    formatDateISO,
    setCommissionDateControlValue,
    readCommissionDateControlValue,
    fillCommissionDateReliably,
    getNativeActionTarget,
    clickElement,
    dispatchWaButtonGesture,
    waitForCondition,
    waitForStableCondition,
    waitForConditionWithStateWatchdog,
    VERIFIED_ACTION_RETRY_POLICIES,
    performVerifiedAction,
    performConfirmedClick,
    makeAbortError,
    throwIfAborted,
    abortableSleep,
    waitForElement,
    setControlValue,
    readControlValue,
    fillGrpComissaoReliably,
    runFirstStep,
    generateCommissionGroup,
    waitForGeneratedCommissionLot,
    shouldSkipLotGeneration,
    shouldSkipLotApproval,
    shouldSkipPayments,
    requiresCommissionPanel,
    findCommissionCalculationTab,
    findResumoPorVendedorTab,
    findPaymentsTab,
    findVendorSummaryTable,
    getVendorPaymentRows,
    classifyInternalCommissionExportGroup,
    applyInternalCommissionExcelReplications,
    getInternalCommissionExportData,
    isEligibleVendorPaymentGroup,
    getPendingExternalCommissionPaymentRows,
    getVendorPaymentRowInfo,
    findGeneratePaymentButton,
    findPaymentDateControl,
    findPaymentFirstOkButton,
    findPaymentSecondOkButton,
    findPaymentYesButton,
    findPaymentProcessingMarker,
    classifyVendorPaymentStage,
    detectVendorPaymentStage,
    setPaymentDateControlValue,
    fillPaymentDateReliably,
    isVendorPaymentTransitionComplete,
    selectVendorPaymentRow,
    recoverVendorPaymentFromStage,
    waitForVendorPaymentUpdateWithWatchdog,
    waitForVendorPaymentUpdate,
    confirmVendorPaymentYes,
    payExternalCommissionVendor,
    runExternalCommissionPayments,
    runInternalCommissionExcelExport,
    isPaymentExtractEmailEmpty,
    findPaymentEmailTable,
    getPaymentEmailRows,
    makePaymentEmailIdentity,
    getPaymentEmailRowInfo,
    getPendingPaymentEmailRows,
    findPaymentEmailMenuButton,
    findPositionedExtractMenuItem,
    findPaymentEmailOkButton,
    findPaymentEmailCloseButton,
    selectPaymentEmailRow,
    sendPaymentExtractEmail,
    runPaymentExtractEmails,
    selectCommissionGroupForApproval,
    approveCommissionGroup,
    runCommissionApprovals,
    runEmissaoComissoes
  };
});
