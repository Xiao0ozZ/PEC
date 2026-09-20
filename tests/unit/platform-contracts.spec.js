import { describe, expect, it, vi } from 'vitest';

import {
  PLATFORM_ERROR_CODES,
  PlatformApiError,
  assertSuccessPayload,
  createApiError,
  normalizeDocumentManifest,
  normalizeHtmlPageCatalog,
  normalizePagePrdLinks,
  normalizePrdBindings,
  normalizeProjectScanResult,
} from '../../packages/platform-contracts/src/index.js';
import { createPlatformClient } from '../../packages/platform-client/src/index.js';

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(payload, { status = 200 } = {}) {
  return new Response(payload, {
    status,
    headers: { 'Content-Type': 'text/markdown' },
  });
}

describe('platform contracts', () => {
  it('normalizes the two existing error payload formats', () => {
    expect(createApiError({ message: '项目读取失败' }, { status: 404 })).toMatchObject({
      message: '项目读取失败',
      code: PLATFORM_ERROR_CODES.NOT_FOUND,
      status: 404,
    });
    expect(createApiError({ error: '导入失败', details: ['格式错误'] }, { status: 400 })).toMatchObject({
      message: '导入失败',
      code: PLATFORM_ERROR_CODES.BAD_REQUEST,
      detail: ['格式错误'],
    });
    expect(() => assertSuccessPayload({ ok: false, error: '路由保存失败' })).toThrow('路由保存失败');
  });

  it('normalizes project, document and association payloads defensively', () => {
    expect(normalizeProjectScanResult({ projects: [{ id: 'demo' }], invalidProjects: null })).toMatchObject({
      projects: [{ id: 'demo' }],
      invalidProjects: [],
    });
    expect(normalizeDocumentManifest({ documents: [{ path: 'PRD.md' }, null, {}] }).documents).toEqual([
      { path: 'PRD.md' },
    ]);
    expect(
      normalizePagePrdLinks({
        links: { admin: { home: { path: '首页.md' }, removed: null, invalid: {} } },
      }),
    ).toEqual({ admin: { home: '首页.md', removed: null } });
    expect(
      normalizePrdBindings({
        bindings: [
          { pagePath: '/admin/home', target: { text: '统计' }, prd: { path: '首页.md' } },
          { pagePath: '/admin/invalid' },
        ],
      }).bindings,
    ).toHaveLength(1);
    expect(normalizeHtmlPageCatalog({ projects: { demo: { admin: [{ path: 'home' }] } } })).toMatchObject({
      projects: { demo: { admin: [{ path: 'home' }] } },
    });
  });
});

describe('platform client', () => {
  it('converts HTTP failures into a stable PlatformApiError', async () => {
    const client = createPlatformClient({
      development: true,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ error: '路由不存在' }, { status: 404 })),
    });

    await expect(client.listRoutes('demo')).rejects.toMatchObject({
      name: 'PlatformApiError',
      code: PLATFORM_ERROR_CODES.NOT_FOUND,
      status: 404,
      message: '路由不存在',
    });
  });

  it('keeps static deployments read-only before issuing a request', async () => {
    const fetchImpl = vi.fn();
    const client = createPlatformClient({ development: false, fetchImpl });

    await expect(client.savePagePrdLinks('demo', {})).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.STATIC_READ_ONLY,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('loads the generated project manifest from the configured production base path', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ projects: [{ id: 'demo' }], invalidProjects: [] }));
    const client = createPlatformClient({ fetchImpl, baseUrl: '/prototype/', development: false });

    await expect(client.loadProjectManifest()).resolves.toMatchObject({
      projects: [{ id: 'demo' }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/prototype/projects/manifest.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('uses the independent local service API while remaining read-only', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ projects: [], invalidProjects: [] }));
    const client = createPlatformClient({ fetchImpl, development: false, apiMode: 'local' });

    await expect(client.loadProjectManifest()).resolves.toMatchObject({ projects: [], invalidProjects: [] });
    expect(fetchImpl).toHaveBeenCalledWith('/__projects/manifest', expect.anything());
    expect(client.getHtmlPrototypeUrl('demo', 'admin', 'overview.html')).toBe(
      '/__projects/html-content/demo/admin/overview.html',
    );
    expect(client.getHtmlPrototypeSourceDownloadUrl('demo', 'admin', 'overview.html')).toContain(
      '?download=source',
    );
    await expect(client.savePagePrdLinks('demo', {})).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.STATIC_READ_ONLY,
    });
  });

  it('loads the framework-neutral HTML page catalog and resolves prototype URLs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ projects: { demo: { admin: [] } } }));
    const client = createPlatformClient({ fetchImpl, baseUrl: '/prototype/', development: false });

    await expect(client.loadHtmlPageCatalog()).resolves.toMatchObject({ projects: { demo: { admin: [] } } });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/prototype/projects/html-pages.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(client.getHtmlPrototypeUrl('demo', 'admin', '业务/首页.html')).toBe(
      '/prototype/projects/demo/prototype/admin/%E4%B8%9A%E5%8A%A1/%E9%A6%96%E9%A1%B5.html',
    );
    expect(client.getHtmlPrototypeSourceDownloadUrl('demo', 'admin', '业务/首页.html')).toBe('');

    const developmentClient = createPlatformClient({ fetchImpl, development: true });
    expect(developmentClient.getHtmlPrototypeSourceDownloadUrl('demo', 'admin', '业务/首页.html')).toBe(
      '/__projects/html-content/demo/admin/%E4%B8%9A%E5%8A%A1/%E9%A6%96%E9%A1%B5.html?download=source',
    );
  });

  it('keeps production document paths and missing bindings compatible', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: '不存在' }, { status: 404 }));
    const client = createPlatformClient({
      development: false,
      baseUrl: '/prototype',
      fetchImpl,
    });

    expect(client.getDocumentAssetUrl('demo', '业务/规则.md')).toBe(
      '/prototype/projects/demo/docs/content/%E4%B8%9A%E5%8A%A1/%E8%A7%84%E5%88%99.md',
    );
    await expect(client.loadPrdBindings('demo')).resolves.toEqual({ schemaVersion: 1, bindings: [] });
  });

  it('loads static PRD JSON artifacts and falls back to legacy markdown files', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ content: '# 规则' }));
    const client = createPlatformClient({
      development: false,
      baseUrl: '/prototype',
      fetchImpl,
    });

    await expect(client.loadDocument('demo', '业务/规则.md')).resolves.toBe('# 规则');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/prototype/projects/demo/docs/content/%E4%B8%9A%E5%8A%A1/%E8%A7%84%E5%88%99.json',
      expect.objectContaining({ cache: 'no-store' }),
    );

    const legacyFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: '不存在' }, { status: 404 }))
      .mockResolvedValueOnce(textResponse('# 旧格式'));
    const legacyClient = createPlatformClient({
      development: false,
      baseUrl: '/prototype',
      fetchImpl: legacyFetch,
    });

    await expect(legacyClient.loadDocument('demo', '业务/规则.md')).resolves.toBe('# 旧格式');
    expect(legacyFetch).toHaveBeenLastCalledWith(
      '/prototype/projects/demo/docs/content/%E4%B8%9A%E5%8A%A1/%E8%A7%84%E5%88%99.md',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('loads page-level PRD links from the generated production project package', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ links: { operation: { dashboard: '业务/Dashboard.md' } } }));
    const client = createPlatformClient({
      development: false,
      baseUrl: '/prototype/',
      fetchImpl,
    });

    await expect(client.loadPagePrdLinks('rimo-rental')).resolves.toEqual({
      operation: { dashboard: '业务/Dashboard.md' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/prototype/projects/rimo-rental/.platform/page-prd-links.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('falls back from development settings to the static settings file', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: '服务不可用' }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ developerMode: true }));
    const client = createPlatformClient({
      development: true,
      baseUrl: '/prototype/',
      fetchImpl,
    });

    await expect(client.loadPlatformSettings()).resolves.toEqual({ developerMode: true });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/__platform/settings',
      '/prototype/platform-settings.json',
    ]);
  });

  it('uses the same route mutation envelope expected by the current plugin', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: { backupId: '1' } }));
    const client = createPlatformClient({ development: true, fetchImpl });

    await expect(client.mutateRoute('order', { projectId: 'demo' })).resolves.toMatchObject({
      ok: true,
      result: { backupId: '1' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/__project-routes/route/order',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports network failures separately from HTTP failures', async () => {
    const client = createPlatformClient({
      development: true,
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('offline')),
    });

    await expect(client.loadProjectManifest()).rejects.toBeInstanceOf(PlatformApiError);
    await expect(client.loadProjectManifest()).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.NETWORK_ERROR,
      status: 0,
    });
  });
});
