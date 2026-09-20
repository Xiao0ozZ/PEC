import {
  PLATFORM_ERROR_CODES,
  PlatformApiError,
  assertSuccessPayload,
  createApiError,
  createStaticReadOnlyError,
  normalizeDocumentManifest,
  normalizeBootstrapState,
  normalizeHtmlPageCatalog,
  normalizePagePrdLinks,
  normalizePlatformSettings,
  normalizePrdBindings,
  normalizeProjectScanResult,
  normalizeProjectHealthReport,
  normalizeProjectMountsPayload,
  normalizeRouteList,
  normalizeShareStatus,
} from '../../platform-contracts/src/index.js';

const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' });

function normalizeBaseUrl(value) {
  const baseUrl = String(value || '/');
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function encodeFilePath(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createPlatformClient({
  fetchImpl = globalThis.fetch,
  baseUrl = '/',
  development = false,
  apiMode = development ? 'development' : 'static',
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createPlatformClient 需要可用的 fetch。');
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const useLocalApi = apiMode === 'development' || apiMode === 'local';

  async function requestJson(url, options = {}) {
    const { fallbackMessage = '平台请求失败。', normalize, ...requestOptions } = options;
    let response;
    try {
      response = await fetchImpl(url, { cache: 'no-store', ...requestOptions });
    } catch (cause) {
      throw new PlatformApiError('无法连接到平台服务。', {
        code: PLATFORM_ERROR_CODES.NETWORK_ERROR,
        cause,
      });
    }

    const payload = await parseJsonResponse(response);
    if (!response.ok) throw createApiError(payload, { status: response.status, fallbackMessage });
    if (payload === null) {
      throw new PlatformApiError('平台接口返回了无法解析的数据。', {
        code: PLATFORM_ERROR_CODES.INVALID_RESPONSE,
        status: response.status,
      });
    }
    return normalize ? normalize(payload) : payload;
  }

  async function requestText(url, options = {}) {
    const { fallbackMessage = '平台内容读取失败。', ...requestOptions } = options;
    let response;
    try {
      response = await fetchImpl(url, { cache: 'no-store', ...requestOptions });
    } catch (cause) {
      throw new PlatformApiError('无法连接到平台服务。', {
        code: PLATFORM_ERROR_CODES.NETWORK_ERROR,
        cause,
      });
    }
    if (!response.ok) {
      const payload = await parseJsonResponse(response);
      throw createApiError(payload, { status: response.status, fallbackMessage });
    }
    return response.text();
  }

  function requireDevelopment(message) {
    if (!development) throw createStaticReadOnlyError(message);
  }

  function documentAssetUrl(projectId, documentPath) {
    const encodedProjectId = encodeURIComponent(projectId);
    const encodedPath = encodeFilePath(documentPath);
    return useLocalApi
      ? `/__prd/file?project=${encodedProjectId}&path=${encodeURIComponent(documentPath)}`
      : `${normalizedBaseUrl}projects/${encodedProjectId}/docs/content/${encodedPath}`;
  }

  function documentContentUrl(projectId, documentPath) {
    const encodedProjectId = encodeURIComponent(projectId);
    const contentPath = /\.md$/iu.test(String(documentPath || ''))
      ? String(documentPath).replace(/\.md$/iu, '.json')
      : `${String(documentPath || '')}.json`;
    const encodedPath = encodeFilePath(contentPath);
    return `${normalizedBaseUrl}projects/${encodedProjectId}/docs/content/${encodedPath}`;
  }

  return Object.freeze({
    development,
    apiMode,
    baseUrl: normalizedBaseUrl,

    loadProjectManifest() {
      const url = useLocalApi ? '/__projects/manifest' : `${normalizedBaseUrl}projects/manifest.json`;
      return requestJson(url, {
        fallbackMessage: '项目包扫描失败。',
        normalize: normalizeProjectScanResult,
      });
    },

    loadBootstrapState() {
      requireDevelopment('静态部署不提供本机工作区状态。');
      return requestJson('/__platform/bootstrap', {
        fallbackMessage: '工作区状态读取失败。',
        normalize: normalizeBootstrapState,
      });
    },

    loadShareStatus() {
      requireDevelopment('静态部署不提供局域网分享状态。');
      return requestJson('/__platform/share', {
        fallbackMessage: '分享状态读取失败。',
        normalize: normalizeShareStatus,
      });
    },

    saveShareEnabled(enabled) {
      requireDevelopment('静态部署不支持切换局域网分享。');
      return requestJson('/__platform/share', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ enabled: Boolean(enabled) }),
        fallbackMessage: '分享状态切换失败。',
        normalize: normalizeShareStatus,
      });
    },

    loadProjectMounts() {
      requireDevelopment('静态部署不提供本机项目挂载。');
      return requestJson('/__projects/mounts', {
        fallbackMessage: '项目挂载读取失败。',
        normalize: normalizeProjectMountsPayload,
      });
    },

    loadProjectHealth() {
      requireDevelopment('静态部署不提供实时健康检查。');
      return requestJson('/__projects/health', {
        fallbackMessage: '项目健康检查失败。',
        normalize: normalizeProjectHealthReport,
      });
    },

    selectProjectDirectory() {
      requireDevelopment('静态部署不能打开本机文件夹选择器。');
      return requestJson('/__platform/select-directory', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{}',
        fallbackMessage: '文件夹选择器打开失败。',
        normalize: (payload) => assertSuccessPayload(payload, '文件夹选择器打开失败。'),
      });
    },

    inspectProjectMount(root) {
      requireDevelopment('静态部署不能检查本机项目目录。');
      return requestJson('/__projects/mount/inspect', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ root }),
        fallbackMessage: '项目目录检查失败。',
        normalize: (payload) => assertSuccessPayload(payload, '项目目录检查失败。'),
      });
    },

    mountProject(root) {
      requireDevelopment('静态部署不能挂载本机项目目录。');
      return requestJson('/__projects/mount', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ root }),
        fallbackMessage: '项目挂载失败。',
        normalize: (payload) => assertSuccessPayload(payload, '项目挂载失败。'),
      });
    },

    unmountProject(projectId) {
      requireDevelopment('静态部署不能取消本机项目挂载。');
      return requestJson('/__projects/unmount', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectId }),
        fallbackMessage: '取消项目挂载失败。',
        normalize: (payload) => assertSuccessPayload(payload, '取消项目挂载失败。'),
      });
    },

    installExampleProject() {
      requireDevelopment('静态部署不能创建示例项目。');
      return requestJson('/__projects/install-example', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{}',
        fallbackMessage: '示例项目创建失败。',
        normalize: (payload) => assertSuccessPayload(payload, '示例项目创建失败。'),
      });
    },

    loadHtmlPageCatalog() {
      const url = useLocalApi ? '/__projects/html-pages' : `${normalizedBaseUrl}projects/html-pages.json`;
      return requestJson(url, {
        fallbackMessage: 'HTML 页面目录读取失败。',
        normalize: normalizeHtmlPageCatalog,
      });
    },

    getHtmlPrototypeUrl(projectId, clientId, sourcePath) {
      const encodedProjectId = encodeURIComponent(projectId);
      const encodedClientId = encodeURIComponent(clientId || '_');
      const encodedPath = encodeFilePath(sourcePath);
      if (!encodedProjectId || !encodedPath) return '';
      const hasSourceRoot = clientId && clientId !== '_';
      return useLocalApi
        ? `/__projects/html-content/${encodedProjectId}/${encodedClientId}/${encodedPath}`
        : `${normalizedBaseUrl}projects/${encodedProjectId}/prototype/${hasSourceRoot ? `${encodedClientId}/` : ''}${encodedPath}`;
    },

    getHtmlPrototypeSourceDownloadUrl(projectId, clientId, sourcePath) {
      if (!development && apiMode !== 'local') return '';
      const encodedProjectId = encodeURIComponent(projectId);
      const encodedClientId = encodeURIComponent(clientId || '_');
      const encodedPath = encodeFilePath(sourcePath);
      if (!encodedProjectId || !encodedPath) return '';
      return `/__projects/html-content/${encodedProjectId}/${encodedClientId}/${encodedPath}?download=source`;
    },

    getProjectAssetUrl(projectId, assetPath) {
      const encodedProjectId = encodeURIComponent(projectId);
      const encodedPath = encodeFilePath(assetPath);
      if (!encodedProjectId || !encodedPath) return '';
      return useLocalApi
        ? `/__projects/file?project=${encodedProjectId}&path=${encodeURIComponent(assetPath)}`
        : `${normalizedBaseUrl}projects/${encodedProjectId}/${encodedPath}`;
    },

    async saveProject(project, { editing = false } = {}) {
      requireDevelopment('静态部署不支持修改项目配置。');
      return requestJson(editing ? '/__projects/update' : '/__projects/create', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(project),
        fallbackMessage: editing ? '项目配置保存失败。' : '项目创建失败。',
        normalize: (payload) => assertSuccessPayload(payload, '项目配置保存失败。'),
      });
    },

    async loadPagePrdLinks(projectId) {
      const encodedProjectId = encodeURIComponent(projectId);
      const url = useLocalApi
        ? `/__projects/page-prd-links?project=${encodedProjectId}`
        : `${normalizedBaseUrl}projects/${encodedProjectId}/.platform/page-prd-links.json`;
      try {
        return await requestJson(url, {
          fallbackMessage: '页面 PRD 关联配置读取失败。',
          normalize: normalizePagePrdLinks,
        });
      } catch (error) {
        if (error instanceof PlatformApiError && error.status === 404) return {};
        throw error;
      }
    },

    async savePagePrdLinks(projectId, links) {
      requireDevelopment('静态页面只能查看页面关联，请在本地开发环境中编辑。');
      const normalizedLinks = normalizePagePrdLinks(links);
      return requestJson(`/__projects/page-prd-links?project=${encodeURIComponent(projectId)}`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectId, links: normalizedLinks }),
        fallbackMessage: '页面 PRD 关联配置保存失败。',
        normalize: normalizePagePrdLinks,
      });
    },

    async loadPrdBindings(projectId) {
      const encodedProjectId = encodeURIComponent(projectId);
      const url = useLocalApi
        ? `/__projects/prd-bindings?project=${encodedProjectId}`
        : `${normalizedBaseUrl}projects/${encodedProjectId}/.platform/prd-bindings.json`;
      try {
        return await requestJson(url, {
          fallbackMessage: 'PRD 关联配置读取失败。',
          normalize: normalizePrdBindings,
        });
      } catch (error) {
        if (error instanceof PlatformApiError && error.status === 404) {
          return normalizePrdBindings({});
        }
        throw error;
      }
    },

    async savePrdBindings(projectId, bindings) {
      requireDevelopment('静态页面只能查看关联，请在本地开发环境中进入关联编辑模式。');
      return requestJson(`/__projects/prd-bindings?project=${encodeURIComponent(projectId)}`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectId, bindings }),
        fallbackMessage: 'PRD 关联配置保存失败。',
        normalize: normalizePrdBindings,
      });
    },

    getDocumentAssetUrl: documentAssetUrl,

    loadDocumentManifest(projectId) {
      const encodedProjectId = encodeURIComponent(projectId);
      const url = useLocalApi
        ? `/__prd/manifest?project=${encodedProjectId}`
        : `${normalizedBaseUrl}projects/${encodedProjectId}/docs/manifest.json`;
      return requestJson(url, {
        fallbackMessage: '项目文档目录读取失败。',
        normalize: normalizeDocumentManifest,
      });
    },

    async loadDocument(projectId, documentPath) {
      const fallbackMessage = 'PRD 文档读取失败。';
      if (useLocalApi) {
        return requestText(documentAssetUrl(projectId, documentPath), { fallbackMessage });
      }

      try {
        return await requestJson(documentContentUrl(projectId, documentPath), {
          fallbackMessage,
          normalize: (payload) => {
            if (typeof payload === 'string') return payload;
            if (payload && typeof payload.content === 'string') return payload.content;
            throw new PlatformApiError('PRD 文档格式无效。', {
              code: PLATFORM_ERROR_CODES.INVALID_RESPONSE,
            });
          },
        });
      } catch (error) {
        if (!(error instanceof PlatformApiError) || ![403, 404].includes(error.status)) throw error;
        return requestText(documentAssetUrl(projectId, documentPath), { fallbackMessage });
      }
    },

    async loadPlatformSettings() {
      const urls = useLocalApi
        ? ['/__platform/settings', `${normalizedBaseUrl}platform-settings.json`]
        : [`${normalizedBaseUrl}platform-settings.json`];
      for (const url of urls) {
        try {
          return await requestJson(url, {
            fallbackMessage: '平台设置读取失败。',
            normalize: normalizePlatformSettings,
          });
        } catch {
          // 开发接口不可用时回退到静态设置；离线场景使用关闭状态。
        }
      }
      return normalizePlatformSettings({});
    },

    async savePlatformSettings(settings) {
      requireDevelopment('静态部署不支持在线修改共享开发模式。');
      return requestJson('/__platform/settings', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(normalizePlatformSettings(settings)),
        fallbackMessage: '共享开发模式保存失败。',
        normalize: normalizePlatformSettings,
      });
    },

    async listRoutes(projectId) {
      requireDevelopment('静态部署不支持路由管理。');
      return requestJson(`/__project-routes?projectId=${encodeURIComponent(projectId)}`, {
        fallbackMessage: '路由读取失败。',
        normalize: normalizeRouteList,
      });
    },

    async mutateRoute(action, target) {
      requireDevelopment('静态部署不支持路由管理。');
      const endpoints = {
        create: '/__project-routes/route/create',
        update: '/__project-routes/route/update',
        delete: '/__project-routes/route/delete',
        restore: '/__project-routes/route/restore',
        order: '/__project-routes/route/order',
        'section-update': '/__project-routes/section/update',
        'section-restore': '/__project-routes/section/restore',
      };
      const endpoint = endpoints[action];
      if (!endpoint) throw new TypeError(`未知路由操作：${action}`);
      return requestJson(endpoint, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(target),
        fallbackMessage: '路由操作失败。',
        normalize: (payload) => assertSuccessPayload(payload, '路由操作失败。'),
      });
    },
  });
}
