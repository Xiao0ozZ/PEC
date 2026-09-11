import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

import {
  LOOPBACK_HOST,
  formatPlatformServerAddresses,
  isSharedHost,
  listLanAddresses,
} from './addresses.js';
import {
  DOCUMENT_PUBLIC_EXTENSIONS,
  PROJECT_PUBLIC_DIRECTORIES,
  applyContentOnlyMode,
  createDocumentManifest,
  createProjectHealthReport,
  createProjectPackage,
  isSafeRelativePath,
  loadProjectDocumentRoots,
  loadProjectMounts,
  normalizeProjectMounts,
  normalizePagePrdLinks as normalizeProjectPagePrdLinks,
  normalizeProjectInput,
  normalizePrdBindings as normalizeProjectPrdBindings,
  readProjectManifest,
  resolveProjectRoot as resolveMountedProjectRoot,
  resolveExistingPathInsideRoot,
  resolveWritablePathInsideRoot,
  scanProjectPackages,
  scanHtmlPrototypePages,
  toPublicProjectManifest,
  updateProjectPackage,
  writeJsonAtomic,
} from '../../project-core/src/index.js';
import {
  isRecord,
  normalizePagePrdLinks,
  normalizePlatformSettings,
  normalizePrdBindings,
} from '../../platform-contracts/src/index.js';
import { selectLocalDirectory } from './directory-picker.js';

const DEFAULT_MIME_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
});

const PROJECT_ASSET_EXTENSIONS = new Set(Object.keys(DEFAULT_MIME_TYPES));
const LOCAL_RUNTIME_BOOTSTRAP = "<script>window.__PLATFORM_RUNTIME__={mode:'local'};</script>";
const SETTINGS_BODY_LIMIT = 16 * 1024;
const SHARE_BODY_LIMIT = 4 * 1024;
const ASSOCIATION_BODY_LIMIT = 8 * 1024 * 1024;
const MANAGEMENT_BODY_LIMIT = 8 * 1024 * 1024;
const TRANSFER_BODY_LIMIT = 12 * 1024 * 1024;
const LOCAL_SERVER_READ_ONLY_CODE = 'LOCAL_SERVER_READ_ONLY';
let pageTransferModulePromise;

function mimeTypeFor(filePath) {
  return DEFAULT_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sendJson(response, payload, statusCode = 200) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function sendBytes(response, content, filePath, extraHeaders = {}) {
  response.statusCode = 200;
  response.setHeader('Content-Type', mimeTypeFor(filePath));
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(content);
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function splitSafePath(value) {
  const normalized = String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  if (!isSafeRelativePath(normalized)) return null;
  return normalized.split('/').filter(Boolean);
}

async function resolveExistingFile(root, relativePath, allowedExtensions = null) {
  return resolveExistingPathInsideRoot(root, relativePath, { allowedExtensions });
}

function projectIdFrom(value) {
  const projectId = String(value || '').trim();
  return /^[a-z][a-z0-9-]*$/u.test(projectId) ? projectId : '';
}

function isLocalRequest(request, getClientAddress = (value) => value.socket?.remoteAddress) {
  const address = String(getClientAddress(request) || '').replace(/^::ffff:/iu, '');
  return address === '' || address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

function requestError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function readJsonBody(request, limit) {
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    request.resume();
    throw requestError('请求内容过大。', 413, 'PAYLOAD_TOO_LARGE');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      request.resume();
      reject(error);
    }

    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(requestError('请求内容过大。', 413, 'PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(requestError('请求内容不是有效的 JSON。', 400, 'BAD_REQUEST'));
      }
    });
    request.on('error', fail);
  });
}

function writeAccessError(request, response, writeEnabled, getClientAddress) {
  if (!writeEnabled) {
    sendJson(response, { code: LOCAL_SERVER_READ_ONLY_CODE, message: '独立本地服务当前为只读模式。' }, 403);
    return true;
  }
  if (!isLocalRequest(request, getClientAddress)) {
    sendJson(response, { code: 'FORBIDDEN', message: '配置写入仅允许在服务主机上执行。' }, 403);
    return true;
  }
  return false;
}

async function resolveWritableProjectFile(projectRoot, relativePath) {
  return resolveWritablePathInsideRoot(projectRoot, relativePath, {
    allowedExtensions: new Set(['.json']),
  });
}

async function resolveExportFile(platformRoot, requestPath) {
  const normalized = String(requestPath || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  if (!normalized.toLowerCase().startsWith('exports/')) return null;
  return resolveExistingFile(path.join(platformRoot, 'exports'), normalized.slice('exports/'.length));
}

function normalizedProjectConfig(projectId, payload, isBindings) {
  if (!isRecord(payload)) throw requestError('请求内容必须是 JSON 对象。', 400, 'BAD_REQUEST');
  const requestedProjectId = projectIdFrom(payload.projectId || projectId);
  if (requestedProjectId !== projectId) {
    throw requestError('请求中的项目 ID 与目标项目不一致。', 400, 'BAD_REQUEST');
  }
  return isBindings
    ? normalizeProjectPrdBindings(projectId, payload)
    : normalizeProjectPagePrdLinks(projectId, payload);
}

function loadPageTransferModule() {
  pageTransferModulePromise ||= import('../../platform-transfer/src/index.js');
  return pageTransferModulePromise;
}

async function readSettings(settingsPath) {
  try {
    return normalizePlatformSettings(JSON.parse(await fs.readFile(settingsPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizePlatformSettings({});
    throw error;
  }
}

function sourceContentDisposition(filePath) {
  const fileName = path.basename(filePath);
  const fallbackName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\\r\n]/g, '_');
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createPlatformServer({
  projectsRoot,
  mountsPath = '',
  settingsPath = '',
  staticRoot = '',
  platformRoot = '',
  host = '127.0.0.1',
  port = 5188,
  writeEnabled = false,
  getClientAddress = (request) => request.socket?.remoteAddress,
  selectDirectory = selectLocalDirectory,
} = {}) {
  const root = path.resolve(projectsRoot || path.resolve(process.cwd(), 'projects'));
  const workspaceRoot = path.resolve(platformRoot || path.dirname(root));
  const mountsFile = mountsPath ? path.resolve(mountsPath) : '';
  const settingsFile = settingsPath ? path.resolve(settingsPath) : '';
  const publicRoot = staticRoot ? path.resolve(staticRoot) : '';

  // 启动地址由命令行决定。分享开关只增删「额外的局域网监听」，不动主监听：
  // 在请求处理中关闭主监听会等待自身连接结束，导致 server.close() 永不回调。
  const startHost = host;
  const startedShared = isSharedHost(startHost);
  let boundPort = port;
  const shareListeners = new Map();

  function shareUrls() {
    if (startedShared) return formatPlatformServerAddresses(startHost, boundPort);
    const displayHost = startHost === '::1' ? `[${startHost}]` : startHost;
    return {
      local: `http://${displayHost}:${boundPort}`,
      lan: [...shareListeners.keys()].sort().map((address) => `http://${address}:${boundPort}`),
    };
  }

  function shareStatus(local) {
    return {
      sharing: startedShared || shareListeners.size > 0,
      managedByStartup: startedShared,
      host: startHost,
      port: boundPort,
      urls: shareUrls(),
      writeEnabled: writeEnabled && local,
      readOnly: !writeEnabled || !local,
      canControl: writeEnabled && local && !startedShared,
    };
  }

  async function closeShareListeners() {
    const listeners = [...shareListeners.values()];
    shareListeners.clear();
    await Promise.all(
      listeners.map(
        (listener) =>
          new Promise((resolve) => {
            listener.closeAllConnections?.();
            listener.close(() => resolve());
          }),
      ),
    );
  }

  async function setShareEnabled(enabled) {
    if (startedShared) {
      throw requestError(
        `服务以 ${startHost} 启动，分享状态由启动参数决定；改用 --host ${LOOPBACK_HOST} 后即可用界面开关控制。`,
        409,
        'SHARE_MANAGED_BY_STARTUP',
      );
    }
    if (!enabled) {
      await closeShareListeners();
      return;
    }
    const addresses = listLanAddresses();
    if (!addresses.length) {
      throw requestError('未检测到可用的局域网地址，无法开启分享。', 409, 'NO_LAN_ADDRESS');
    }
    for (const address of addresses) {
      if (shareListeners.has(address)) continue;
      const listener = createServer(requestListener);
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => reject(error);
          listener.once('error', onError);
          listener.listen(boundPort, address, () => {
            listener.removeListener('error', onError);
            resolve();
          });
        });
      } catch (cause) {
        await closeShareListeners();
        throw requestError(
          `无法在 ${address}:${boundPort} 开启分享监听：${cause.message}`,
          409,
          'SHARE_LISTEN_FAILED',
        );
      }
      shareListeners.set(address, listener);
    }
  }

  async function loadMounts() {
    if (!mountsFile) return { schemaVersion: 1, projects: {} };
    return loadProjectMounts(mountsFile);
  }

  // 项目与 HTML 扫描会遍历项目目录和外置原型目录，实测分别约 40ms 与 150ms。
  // 独立服务没有文件监听，因此只做很短的 TTL 合并：既能把一次页面加载里的
  // 重复扫描收敛成一次，也保证「项目文件是事实来源」在下一次刷新即生效。
  // 任何通过写权限校验的请求都会立即清空缓存，避免保存后仍读到旧数据。
  const SCAN_CACHE_TTL_MS = 1000;
  const scanCache = new Map();

  function invalidateScanCache() {
    scanCache.clear();
  }

  async function cachedScan(kind, mounts, load) {
    const key = `${kind}:${JSON.stringify(mounts?.projects || {})}`;
    const hit = scanCache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < SCAN_CACHE_TTL_MS) return hit.value;
    const value = await load();
    scanCache.set(key, { at: now, value });
    return value;
  }

  function scanProjects(mounts) {
    return cachedScan('projects', mounts, () => scanProjectPackages(root, { mounts }));
  }

  function scanHtmlPages(mounts) {
    return cachedScan('html', mounts, () => scanHtmlPrototypePages(root, { mounts }));
  }

  // 写请求一旦获得授权，扫描结果即视为过期。集中在这里失效，避免逐个写入分支遗漏。
  function denyWrite(request, response) {
    if (writeAccessError(request, response, writeEnabled, getClientAddress)) return true;
    invalidateScanCache();
    return false;
  }

  async function resolveProjectRoot(projectId) {
    const safeProjectId = projectIdFrom(projectId);
    if (!safeProjectId) return null;
    const projectRoot = resolveMountedProjectRoot(root, safeProjectId, await loadMounts());
    return resolveExistingFile(projectRoot, 'project.json').then((manifestPath) =>
      manifestPath ? path.dirname(manifestPath) : null,
    );
  }

  async function inspectMountCandidate(candidateRoot) {
    const rawRoot = String(candidateRoot || '').trim();
    if (!rawRoot || !path.isAbsolute(rawRoot)) {
      throw requestError('项目目录必须是本机绝对路径。', 400, 'INVALID_PROJECT_ROOT');
    }
    const selectedRoot = path.resolve(rawRoot);
    const manifestPath = await resolveExistingFile(selectedRoot, 'project.json', new Set(['.json']));
    if (!manifestPath)
      throw requestError('所选目录不包含可读取的 project.json。', 400, 'INVALID_PROJECT_ROOT');
    const manifest = await readProjectManifest(selectedRoot);
    const projectId = projectIdFrom(manifest.id);
    if (!projectId) throw requestError('project.json 中的项目 ID 无效。', 400, 'INVALID_PROJECT_ID');
    const current = await loadMounts();
    const proposed = normalizeProjectMounts({
      schemaVersion: 1,
      projects: {
        ...current.projects,
        [projectId]: { ...(current.projects[projectId] || {}), root: selectedRoot },
      },
    });
    const scan = await scanProjectPackages(root, { mounts: proposed });
    const invalid = scan.invalidProjects.find((item) => item.folder === projectId);
    if (invalid) {
      throw requestError(`项目目录校验失败：${invalid.errors.join('；')}`, 400, 'INVALID_PROJECT_PACKAGE');
    }
    const project = scan.projects.find((item) => item.id === projectId);
    if (!project) throw requestError('所选目录没有形成可用项目。', 400, 'INVALID_PROJECT_PACKAGE');
    return { root: selectedRoot, project, mounts: proposed };
  }

  async function handleWorkspaceManagement(request, requestUrl, response) {
    const supported = new Set([
      '/__platform/bootstrap',
      '/__platform/select-directory',
      '/__projects/mounts',
      '/__projects/mount/inspect',
      '/__projects/mount',
      '/__projects/unmount',
      '/__projects/install-example',
      '/__projects/health',
    ]);
    if (!supported.has(requestUrl.pathname)) return false;
    const mounts = await loadMounts();
    const local = isLocalRequest(request, getClientAddress);

    if (requestUrl.pathname === '/__platform/bootstrap') {
      const scan = await scanProjectPackages(root, { mounts });
      sendJson(response, {
        ok: true,
        runtime: {
          local,
          writeEnabled: writeEnabled && local,
          readOnly: !writeEnabled || !local,
          host: startHost,
          port: boundPort,
          share: shareStatus(local),
        },
        workspace: {
          projectsDirectoryReady: true,
          mountsConfigured: Object.keys(mounts.projects).length,
          projects: scan.projects.length,
          invalidProjects: scan.invalidProjects.length,
          needsOnboarding: scan.projects.length === 0,
        },
      });
      return true;
    }
    if (requestUrl.pathname === '/__projects/health') {
      const report = await createProjectHealthReport(root, { mounts });
      if (!local) {
        for (const item of report.projects) {
          if (item.mounts?.project)
            item.mounts.project.root = item.mounts.project.mounted ? '外部项目目录' : '本地项目目录';
          if (item.mounts?.docs)
            item.mounts.docs.root = item.mounts.docs.mounted ? '外部文档目录' : '项目内文档目录';
          for (const prototype of item.mounts?.prototypes || [])
            prototype.root = prototype.mounted ? '外部 HTML 目录' : '项目内 HTML 目录';
        }
      }
      sendJson(response, report);
      return true;
    }
    if (requestUrl.pathname === '/__projects/mounts' && request.method === 'GET') {
      sendJson(response, local ? mounts : normalizeProjectMounts({}));
      return true;
    }
    if (denyWrite(request, response)) return true;
    if (request.method !== 'POST') {
      sendJson(response, { code: 'METHOD_NOT_ALLOWED', message: '该接口只支持 POST。' }, 405);
      return true;
    }
    try {
      if (requestUrl.pathname === '/__platform/select-directory') {
        const selected = await selectDirectory();
        sendJson(response, { ok: true, cancelled: !selected, path: selected || '' });
        return true;
      }
      if (requestUrl.pathname === '/__projects/install-example') {
        const source = path.join(workspaceRoot, 'examples', 'sample-project');
        const target = path.join(root, 'sample-project');
        if (await fs.stat(target).catch(() => null))
          throw requestError('示例项目已经存在。', 409, 'CONFLICT');
        if (!(await fs.stat(path.join(source, 'project.json')).catch(() => null))) {
          throw requestError('仓库中缺少示例项目。', 503, 'SAMPLE_MISSING');
        }
        await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
        sendJson(response, { ok: true, projectId: 'sample-project', message: '示例项目已创建。' });
        return true;
      }
      const body = await readJsonBody(request, MANAGEMENT_BODY_LIMIT);
      if (requestUrl.pathname === '/__projects/mount/inspect') {
        const result = await inspectMountCandidate(body.root);
        sendJson(response, { ok: true, root: result.root, project: result.project });
        return true;
      }
      if (requestUrl.pathname === '/__projects/mount') {
        if (!mountsFile) throw requestError('独立服务未配置挂载文件。', 503, 'SERVER_CONFIG_ERROR');
        const result = await inspectMountCandidate(body.root);
        await writeJsonAtomic(mountsFile, result.mounts);
        sendJson(response, {
          ok: true,
          project: result.project,
          message: '项目已挂载，源文件保持在原目录。',
        });
        return true;
      }
      if (requestUrl.pathname === '/__projects/unmount') {
        if (!mountsFile) throw requestError('独立服务未配置挂载文件。', 503, 'SERVER_CONFIG_ERROR');
        const projectId = projectIdFrom(body.projectId);
        if (!projectId || !mounts.projects[projectId]?.root)
          throw requestError('找不到外部项目挂载。', 404, 'NOT_FOUND');
        const projects = { ...mounts.projects };
        delete projects[projectId];
        await writeJsonAtomic(mountsFile, normalizeProjectMounts({ schemaVersion: 1, projects }));
        sendJson(response, { ok: true, projectId, message: '挂载已取消，源项目文件未被修改。' });
        return true;
      }
    } catch (error) {
      sendJson(
        response,
        { ok: false, code: error.code || 'BAD_REQUEST', message: error.message },
        error.statusCode || 400,
      );
      return true;
    }
    return false;
  }

  async function handleProjectManagement(request, requestUrl, response) {
    if (!['/__projects/create', '/__projects/update'].includes(requestUrl.pathname)) return false;
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, { message: '项目管理接口只支持 POST。' }, 405);
      return true;
    }
    if (denyWrite(request, response)) return true;

    try {
      const body = await readJsonBody(request, MANAGEMENT_BODY_LIMIT);
      const editing = requestUrl.pathname.endsWith('/update');
      const projectId = projectIdFrom(body?.id);
      if (!projectId) throw requestError('项目 ID 必须使用小写 kebab-case。', 400, 'BAD_REQUEST');
      const existingProjectRoot = editing ? await resolveProjectRoot(projectId) : null;
      if (editing && !existingProjectRoot) {
        throw requestError(`找不到项目包：${projectId}。`, 404, 'NOT_FOUND');
      }
      const existingManifest = editing ? await readProjectManifest(existingProjectRoot) : null;
      const input = normalizeProjectInput(body, { editing, existingManifest });
      const manifest = editing
        ? await updateProjectPackage(root, input, { projectRoot: existingProjectRoot })
        : await createProjectPackage(root, input);
      sendJson(response, {
        ok: true,
        project: toPublicProjectManifest(manifest),
        message: editing ? '项目配置已保存。' : '项目初始化包已生成。',
      });
    } catch (error) {
      sendJson(
        response,
        { ok: false, code: error.code || 'BAD_REQUEST', message: error.message },
        error.statusCode || 400,
      );
    }
    return true;
  }

  async function handlePageTransfer(request, requestUrl, response) {
    const routePath = requestUrl.pathname;
    const supported = new Set([
      '/__page-transfer/inspect',
      '/__page-transfer/import',
      '/__page-transfer/routes',
      '/__page-transfer/route/create',
      '/__page-transfer/route/update',
      '/__page-transfer/section/update',
      '/__page-transfer/route/order',
      '/__page-transfer/route/delete',
      '/__page-transfer/route/restore',
      '/__page-transfer/section/restore',
      '/__page-transfer/export',
    ]);
    if (!supported.has(routePath)) return false;

    const isRead = routePath === '/__page-transfer/routes' && request.method === 'GET';
    if (!isRead && denyWrite(request, response)) return true;

    try {
      const {
        createExportPackage,
        createProjectRoute,
        deleteProjectRoute,
        importPage,
        inspectHtml,
        listProjectRoutes,
        restoreProjectRoute,
        restoreProjectSections,
        updateProjectRoute,
        updateProjectRouteOrder,
        updateProjectSections,
      } = await loadPageTransferModule();
      if (routePath === '/__page-transfer/inspect') {
        if (request.method !== 'POST')
          throw requestError('HTML 检查接口只支持 POST。', 405, 'METHOD_NOT_ALLOWED');
        const result = inspectHtml((await readJsonBody(request, TRANSFER_BODY_LIMIT)).html);
        sendJson(response, { ok: true, ...result });
        return true;
      }

      if (routePath === '/__page-transfer/import') {
        if (request.method !== 'POST')
          throw requestError('页面导入接口只支持 POST。', 405, 'METHOD_NOT_ALLOWED');
        const body = await readJsonBody(request, TRANSFER_BODY_LIMIT);
        const result = await importPage({
          projectRoot: workspaceRoot,
          source: body.html,
          target: body.target || {},
          mounts: await loadMounts(),
        });
        sendJson(response, { ok: true, result });
        return true;
      }

      if (routePath === '/__page-transfer/routes') {
        if (request.method !== 'GET')
          throw requestError('路由读取接口只支持 GET。', 405, 'METHOD_NOT_ALLOWED');
        const result = await listProjectRoutes({
          projectRoot: workspaceRoot,
          projectId: requestUrl.searchParams.get('projectId'),
          mounts: await loadMounts(),
        });
        sendJson(response, { ok: true, ...result });
        return true;
      }

      const body = await readJsonBody(request, TRANSFER_BODY_LIMIT);
      const routeActions = {
        '/__page-transfer/route/create': async () =>
          createProjectRoute({ projectRoot: workspaceRoot, target: body, mounts: await loadMounts() }),
        '/__page-transfer/route/update': async () =>
          updateProjectRoute({ projectRoot: workspaceRoot, target: body, mounts: await loadMounts() }),
        '/__page-transfer/section/update': async () =>
          updateProjectSections({ projectRoot: workspaceRoot, target: body, mounts: await loadMounts() }),
        '/__page-transfer/route/order': async () =>
          updateProjectRouteOrder({ projectRoot: workspaceRoot, target: body, mounts: await loadMounts() }),
        '/__page-transfer/route/delete': async () =>
          deleteProjectRoute({ projectRoot: workspaceRoot, target: body, mounts: await loadMounts() }),
        '/__page-transfer/route/restore': async () =>
          restoreProjectRoute({ projectRoot: workspaceRoot, target: body, mounts: await loadMounts() }),
        '/__page-transfer/section/restore': async () =>
          restoreProjectSections({ projectRoot: workspaceRoot, target: body, mounts: await loadMounts() }),
        '/__page-transfer/export': async () =>
          createExportPackage({
            projectRoot: workspaceRoot,
            projectId: body.projectId,
            selectedPaths: body.selectedPaths || [],
            packageName: body.packageName,
            mounts: await loadMounts(),
          }),
      };
      const action = routeActions[routePath];
      if (!action) throw requestError('未知页面传输接口。', 404, 'NOT_FOUND');
      if (request.method !== 'POST')
        throw requestError('页面传输接口只支持 POST。', 405, 'METHOD_NOT_ALLOWED');
      sendJson(response, { ok: true, result: await action() });
    } catch (error) {
      sendJson(
        response,
        {
          ok: false,
          code: error.code || 'BAD_REQUEST',
          error: error.message,
          message: error.message,
          details: error.details || null,
          rollback: error.rollback || null,
        },
        error.statusCode || 400,
      );
    }
    return true;
  }

  async function handleExportFile(request, requestUrl, response) {
    let requestPath = '';
    if (requestUrl.pathname === '/__page-transfer/download') {
      requestPath = requestUrl.searchParams.get('path') || '';
    } else if (requestUrl.pathname.startsWith('/exports/')) {
      requestPath = requestUrl.pathname.slice(1);
    } else {
      return false;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendJson(response, { message: '导出文件接口只支持 GET。' }, 405);
      return true;
    }
    const target = await resolveExportFile(workspaceRoot, requestPath);
    if (!target) {
      sendJson(response, { message: '导出文件不存在或路径无效。' }, 404);
      return true;
    }
    const download = requestUrl.pathname === '/__page-transfer/download';
    sendBytes(
      response,
      await fs.readFile(target),
      target,
      download ? { 'Content-Disposition': sourceContentDisposition(target) } : {},
    );
    return true;
  }

  async function handleProjectAsset(requestUrl, response) {
    const projectRoot = await resolveProjectRoot(requestUrl.searchParams.get('project'));
    if (!projectRoot) {
      sendJson(response, { message: '项目不存在或项目路径无效。' }, 404);
      return true;
    }
    const assetPath = requestUrl.searchParams.get('path') || '';
    const segments = splitSafePath(assetPath);
    if (!segments?.length || !PROJECT_PUBLIC_DIRECTORIES.has(segments[0])) {
      sendJson(response, { message: '项目资源路径无效。' }, 400);
      return true;
    }
    const target = await resolveExistingFile(projectRoot, assetPath, PROJECT_ASSET_EXTENSIONS);
    if (!target) {
      sendJson(response, { message: '项目资源不存在或路径无效。' }, 404);
      return true;
    }
    sendBytes(response, await fs.readFile(target), target);
    return true;
  }

  async function handleProjectPlatformConfig(request, requestUrl, response) {
    if (!['/__projects/page-prd-links', '/__projects/prd-bindings'].includes(requestUrl.pathname)) {
      return false;
    }
    const projectId = projectIdFrom(requestUrl.searchParams.get('project'));
    const projectRoot = await resolveProjectRoot(projectId);
    if (!projectRoot) {
      sendJson(response, { message: '项目不存在或项目 ID 无效。' }, 404);
      return true;
    }
    const isBindings = requestUrl.pathname === '/__projects/prd-bindings';
    const configPath = path.join(
      projectRoot,
      '.platform',
      isBindings ? 'prd-bindings.json' : 'page-prd-links.json',
    );

    if (request.method === 'POST') {
      if (denyWrite(request, response)) return true;
      try {
        const payload = normalizedProjectConfig(
          projectId,
          await readJsonBody(request, ASSOCIATION_BODY_LIMIT),
          isBindings,
        );
        const safeConfigPath = await resolveWritableProjectFile(
          projectRoot,
          `.platform/${isBindings ? 'prd-bindings.json' : 'page-prd-links.json'}`,
        );
        if (!safeConfigPath || path.resolve(safeConfigPath) !== path.resolve(configPath)) {
          throw requestError('项目关联配置路径无效。', 400, 'BAD_REQUEST');
        }
        await writeJsonAtomic(safeConfigPath, payload);
        sendJson(response, isBindings ? normalizePrdBindings(payload) : normalizePagePrdLinks(payload));
      } catch (error) {
        sendJson(
          response,
          { code: error.code || 'BAD_REQUEST', message: error.message },
          error.statusCode || 400,
        );
      }
      return true;
    }

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET, POST');
      sendJson(response, { message: '项目关联配置只支持 GET 或 POST。' }, 405);
      return true;
    }

    try {
      const safeConfigPath = await resolveExistingFile(
        projectRoot,
        `.platform/${isBindings ? 'prd-bindings.json' : 'page-prd-links.json'}`,
        new Set(['.json']),
      );
      if (!safeConfigPath) {
        if (!(await fs.stat(configPath).catch(() => null))) {
          sendJson(response, isBindings ? normalizePrdBindings({}) : normalizePagePrdLinks({}));
          return true;
        }
        throw new Error('项目关联配置路径越界或类型无效。');
      }
      const payload = JSON.parse(await fs.readFile(safeConfigPath, 'utf8'));
      sendJson(response, isBindings ? normalizePrdBindings(payload) : normalizePagePrdLinks(payload));
    } catch (error) {
      if (error.code === 'ENOENT') {
        sendJson(response, isBindings ? normalizePrdBindings({}) : normalizePagePrdLinks({}));
        return true;
      }
      sendJson(response, { message: '项目关联配置读取失败。', detail: error.message }, 500);
    }
    return true;
  }

  async function handleHtmlContent(request, requestUrl, response) {
    const prefix = '/__projects/html-content/';
    if (!requestUrl.pathname.startsWith(prefix)) return false;
    const pathParts = requestUrl.pathname.slice(prefix.length).split('/').filter(Boolean);
    const projectId = decodeSegment(pathParts.shift() || '');
    const sourceId = decodeSegment(pathParts.shift() || '_');
    const relativePath = pathParts.map(decodeSegment).join('/');
    const mounts = await loadMounts();
    const catalog = await scanHtmlPages(mounts);
    const source = (catalog.roots[projectId] || []).find(
      (item) => (item.sourceId || item.clientId || '_') === sourceId,
    );
    const target = source ? await resolveExistingFile(source.root, relativePath) : null;
    if (!target) {
      sendJson(response, { message: 'HTML 原型文件不存在或路径无效。' }, 404);
      return true;
    }

    const isHtml = /\.html?$/iu.test(target);
    const downloadSource = requestUrl.searchParams.get('download') === 'source';
    if (downloadSource && (!isHtml || !isLocalRequest(request, getClientAddress))) {
      sendJson(
        response,
        { message: isHtml ? '页面源文件下载仅允许本机使用。' : '当前文件不是 HTML 页面。' },
        isHtml ? 403 : 400,
      );
      return true;
    }
    const sourceText = isHtml ? await fs.readFile(target, 'utf8') : null;
    const content = isHtml
      ? Buffer.from(
          downloadSource || source.shellMode === 'full' ? sourceText : applyContentOnlyMode(sourceText),
          'utf8',
        )
      : await fs.readFile(target);
    sendBytes(
      response,
      content,
      target,
      downloadSource ? { 'Content-Disposition': sourceContentDisposition(target) } : {},
    );
    return true;
  }

  async function handlePrd(requestUrl, response) {
    if (!['/__prd/manifest', '/__prd/file'].includes(requestUrl.pathname)) return false;
    const projectId = projectIdFrom(requestUrl.searchParams.get('project'));
    if (!projectId) {
      sendJson(response, { message: '项目参数无效。' }, 400);
      return true;
    }
    const roots = await loadProjectDocumentRoots(root, { mounts: await loadMounts() });
    const docsRoot = roots.get(projectId);
    if (!docsRoot) {
      sendJson(response, { message: '项目文档目录不存在或项目不可用。' }, 404);
      return true;
    }
    if (requestUrl.pathname === '/__prd/manifest') {
      sendJson(response, await createDocumentManifest(docsRoot));
      return true;
    }
    const target = await resolveExistingFile(
      docsRoot,
      requestUrl.searchParams.get('path'),
      DOCUMENT_PUBLIC_EXTENSIONS,
    );
    if (!target) {
      sendJson(response, { message: '文档路径无效。' }, 400);
      return true;
    }
    sendBytes(response, await fs.readFile(target), target);
    return true;
  }

  async function serveStatic(requestUrl, response) {
    if (!publicRoot) return false;
    const decodedPath = decodeSegment(requestUrl.pathname);
    const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    const target = await resolveExistingFile(publicRoot, relativePath);
    if (target) {
      sendBytes(response, await readStaticFile(target), target);
      return true;
    }
    if (requestUrl.pathname.startsWith('/__')) return false;
    const fallback = await resolveExistingFile(publicRoot, 'index.html');
    if (!fallback) return false;
    sendBytes(response, await readStaticFile(fallback), fallback);
    return true;
  }

  async function readStaticFile(target) {
    const content = await fs.readFile(target);
    if (path.basename(target).toLowerCase() !== 'index.html') return content;
    const source = content.toString('utf8');
    const injected = /<\/head>/iu.test(source)
      ? source.replace(/<\/head>/iu, `${LOCAL_RUNTIME_BOOTSTRAP}</head>`)
      : `${LOCAL_RUNTIME_BOOTSTRAP}${source}`;
    return Buffer.from(injected, 'utf8');
  }

  async function handle(request, response) {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (requestUrl.pathname === '/__platform/health') {
      sendJson(response, {
        ok: true,
        service: 'platform-local-server',
        readOnly: !writeEnabled,
        writeEnabled,
        share: shareStatus(isLocalRequest(request, getClientAddress)),
      });
      return;
    }
    if (requestUrl.pathname === '/__platform/share') {
      const local = isLocalRequest(request, getClientAddress);
      if (request.method === 'GET') {
        sendJson(response, { ok: true, share: shareStatus(local) });
        return;
      }
      if (request.method === 'POST') {
        if (denyWrite(request, response)) return;
        try {
          const body = await readJsonBody(request, SHARE_BODY_LIMIT);
          if (typeof body?.enabled !== 'boolean') {
            throw requestError('enabled 必须是布尔值。', 400, 'INVALID_SHARE_STATE');
          }
          await setShareEnabled(body.enabled);          sendJson(response, {
            ok: true,
            share: shareStatus(local),
            message: body.enabled ? '已开启局域网只读分享。' : '已关闭局域网分享。',
          });
        } catch (error) {
          sendJson(
            response,
            { code: error.code || 'BAD_REQUEST', message: error.message },
            error.statusCode || 400,
          );
        }
        return;
      }
      sendJson(response, { message: '该接口仅支持 GET 与 POST。' }, 405);
      return;
    }
    if (requestUrl.pathname === '/__platform/settings' && request.method === 'POST') {
      if (denyWrite(request, response)) return;
      if (!settingsFile) {
        sendJson(response, { code: 'SERVER_CONFIG_ERROR', message: '独立服务未配置平台设置文件。' }, 503);
        return;
      }
      try {
        const settings = normalizePlatformSettings(await readJsonBody(request, SETTINGS_BODY_LIMIT));
        await writeJsonAtomic(settingsFile, settings);
        sendJson(response, { ok: true, settings, message: '平台配置已保存。' });
      } catch (error) {
        sendJson(
          response,
          { code: error.code || 'BAD_REQUEST', message: error.message },
          error.statusCode || 400,
        );
      }
      return;
    }
    if (await handleWorkspaceManagement(request, requestUrl, response)) return;
    if (await handleProjectManagement(request, requestUrl, response)) return;
    if (await handlePageTransfer(request, requestUrl, response)) return;
    if (await handleExportFile(request, requestUrl, response)) return;
    if (await handleProjectPlatformConfig(request, requestUrl, response)) return;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, { message: '独立本地服务暂不支持该写入接口。' }, 405);
      return;
    }
    if (requestUrl.pathname === '/__projects/manifest') {
      sendJson(response, await scanProjects(await loadMounts()));
      return;
    }
    if (requestUrl.pathname === '/__projects/html-pages') {
      const catalog = await scanHtmlPages(await loadMounts());
      sendJson(response, {
        generatedAt: new Date().toISOString(),
        projects: catalog.projects,
        sections: catalog.sections,
      });
      return;
    }
    if (requestUrl.pathname === '/__projects/file') {
      await handleProjectAsset(requestUrl, response);
      return;
    }
    if (await handleHtmlContent(request, requestUrl, response)) return;
    if (await handlePrd(requestUrl, response)) return;
    if (requestUrl.pathname === '/__platform/settings') {
      if (!settingsFile) {
        sendJson(response, normalizePlatformSettings({}));
        return;
      }
      sendJson(response, await readSettings(settingsFile));
      return;
    }
    if (await serveStatic(requestUrl, response)) return;
    sendJson(response, { message: '资源不存在。' }, 404);
  }

  function requestListener(request, response) {
    handle(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      sendJson(response, { message: '本地服务处理失败。', detail: error.message }, 500);
    });
  }

  const server = createServer(requestListener);

  return {
    server,
    options: {
      host: startHost,
      port,
      projectsRoot: root,
      platformRoot: workspaceRoot,
      staticRoot: publicRoot,
      writeEnabled,
    },
    shareStatus: () => shareStatus(true),
    setShareEnabled,
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, startHost, resolve);
      });
      const address = server.address();
      if (address && typeof address === 'object') boundPort = address.port;
      return address;
    },
    async close() {
      await closeShareListeners();
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
