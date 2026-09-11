export const PLATFORM_ERROR_CODES = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  SERVER_ERROR: 'SERVER_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  STATIC_READ_ONLY: 'STATIC_READ_ONLY',
  UNKNOWN: 'UNKNOWN',
});

const STATUS_ERROR_CODES = new Map([
  [400, PLATFORM_ERROR_CODES.BAD_REQUEST],
  [401, PLATFORM_ERROR_CODES.UNAUTHORIZED],
  [403, PLATFORM_ERROR_CODES.FORBIDDEN],
  [404, PLATFORM_ERROR_CODES.NOT_FOUND],
  [405, PLATFORM_ERROR_CODES.METHOD_NOT_ALLOWED],
  [409, PLATFORM_ERROR_CODES.CONFLICT],
  [413, PLATFORM_ERROR_CODES.PAYLOAD_TOO_LARGE],
]);

export class PlatformApiError extends Error {
  constructor(message, { code = PLATFORM_ERROR_CODES.UNKNOWN, status = 0, detail = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PlatformApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function errorCodeForStatus(status) {
  if (STATUS_ERROR_CODES.has(status)) return STATUS_ERROR_CODES.get(status);
  if (status >= 500) return PLATFORM_ERROR_CODES.SERVER_ERROR;
  return PLATFORM_ERROR_CODES.UNKNOWN;
}

export function createApiError(payload, { status = 0, fallbackMessage = '平台请求失败。', cause } = {}) {
  if (payload instanceof PlatformApiError) return payload;
  const source = isRecord(payload) ? payload : {};
  const message = source.message || source.error || fallbackMessage;
  const detail = source.detail ?? source.details ?? null;
  return new PlatformApiError(String(message), {
    code: String(source.code || errorCodeForStatus(status)),
    status,
    detail,
    cause,
  });
}

export function createStaticReadOnlyError(message) {
  return new PlatformApiError(message, { code: PLATFORM_ERROR_CODES.STATIC_READ_ONLY, status: 403 });
}

export function assertSuccessPayload(payload, fallbackMessage = '平台接口返回失败。') {
  if (!isRecord(payload)) {
    throw new PlatformApiError('平台接口返回了无效数据。', {
      code: PLATFORM_ERROR_CODES.INVALID_RESPONSE,
    });
  }
  if (payload.ok === false) throw createApiError(payload, { fallbackMessage });
  return payload;
}

export function normalizePagePrdLinks(payload) {
  const links = isRecord(payload?.links) ? payload.links : isRecord(payload) ? payload : {};
  const result = {};
  for (const [clientId, pages] of Object.entries(links)) {
    if (!isRecord(pages)) continue;
    result[clientId] = {};
    for (const [pageName, value] of Object.entries(pages)) {
      if (value === null || value === '') {
        result[clientId][pageName] = null;
        continue;
      }
      const path = typeof value === 'string' ? value : value?.path || value?.file || '';
      if (path) result[clientId][pageName] = String(path);
    }
  }
  return result;
}

export function normalizePrdBindings(payload) {
  const bindings = Array.isArray(payload?.bindings) ? payload.bindings : [];
  return {
    schemaVersion: 1,
    bindings: bindings.filter(
      (binding) => isRecord(binding) && binding.pagePath && binding.target && binding.prd,
    ),
  };
}

export function normalizeDocumentManifest(payload) {
  const source = isRecord(payload) ? payload : {};
  return {
    ...source,
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : '',
    documents: Array.isArray(source.documents)
      ? source.documents.filter((document) => isRecord(document) && document.path)
      : [],
  };
}

export function normalizeProjectScanResult(payload) {
  const source = isRecord(payload) ? payload : {};
  return {
    ...source,
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : '',
    projects: Array.isArray(source.projects) ? source.projects.filter(isRecord) : [],
    invalidProjects: Array.isArray(source.invalidProjects) ? source.invalidProjects.filter(isRecord) : [],
  };
}

export function normalizeHtmlPageCatalog(payload) {
  const source = isRecord(payload) ? payload : {};
  const projects = isRecord(source.projects) ? source.projects : {};
  const sections = isRecord(source.sections) ? source.sections : {};
  return {
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : '',
    projects,
    sections,
  };
}

export function normalizePlatformSettings(payload) {
  const source = isRecord(payload?.settings) ? payload.settings : isRecord(payload) ? payload : {};
  return { developerMode: Boolean(source.developerMode) };
}

export function normalizeRouteList(payload) {
  const source = assertSuccessPayload(payload, '路由读取失败。');
  return {
    ...source,
    clients: Array.isArray(source.clients) ? source.clients.filter(isRecord) : [],
    backups: Array.isArray(source.backups) ? source.backups.filter(isRecord) : [],
  };
}

export function normalizeBootstrapState(payload) {
  const source = assertSuccessPayload(payload, '工作区状态读取失败。');
  return {
    runtime: isRecord(source.runtime) ? source.runtime : {},
    workspace: isRecord(source.workspace) ? source.workspace : {},
  };
}

export function normalizeShareStatus(payload) {
  const source = assertSuccessPayload(payload, '分享状态读取失败。');
  const share = isRecord(source.share) ? source.share : {};
  const urls = isRecord(share.urls) ? share.urls : {};
  return {
    sharing: share.sharing === true,
    managedByStartup: share.managedByStartup === true,
    canControl: share.canControl === true,
    readOnly: share.readOnly !== false,
    writeEnabled: share.writeEnabled === true,
    host: typeof share.host === 'string' ? share.host : '',
    port: Number(share.port) || 0,
    urls: {
      local: typeof urls.local === 'string' ? urls.local : '',
      lan: Array.isArray(urls.lan) ? urls.lan.filter((item) => typeof item === 'string') : [],
    },
    message: typeof source.message === 'string' ? source.message : '',
  };
}

export function normalizeProjectHealthReport(payload) {
  const source = isRecord(payload) ? payload : {};
  return {
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : '',
    summary: isRecord(source.summary) ? source.summary : {},
    projects: Array.isArray(source.projects) ? source.projects.filter(isRecord) : [],
  };
}

export function normalizeProjectMountsPayload(payload) {
  const source = isRecord(payload) ? payload : {};
  return {
    schemaVersion: Number(source.schemaVersion) || 1,
    projects: isRecord(source.projects) ? source.projects : {},
  };
}
