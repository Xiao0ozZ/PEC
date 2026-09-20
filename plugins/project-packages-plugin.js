import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  PROJECT_ID_PATTERN,
  PROJECT_PUBLIC_DIRECTORIES as PUBLIC_DIRECTORIES,
  createProjectPackage,
  createProjectHealthReport,
  isInsideRoot,
  isSafeRelativePath,
  normalizePagePrdLinks,
  normalizeProjectInput,
  normalizeProjectMounts,
  normalizePrdBindings,
  readProjectManifest,
  resolveExistingPathInsideRoot,
  resolveProjectRoot as resolveMountedProjectRoot,
  resolveWritablePathInsideRoot,
  scanProjectPackages as scanProjectPackagesCore,
  toPublicProjectManifest,
  toWebPath,
  updateProjectPackage,
  validateProjectDefinitions,
  writeJsonAtomic,
} from '../packages/project-core/src/index.js';
import { selectLocalDirectory } from '../packages/platform-server/src/directory-picker.js';

const PUBLIC_EXTENSIONS = new Set([
  '.avif',
  '.css',
  '.gif',
  '.html',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.png',
  '.svg',
  '.webp',
  '.woff',
  '.woff2',
]);
const MIME_TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const MANAGEMENT_BODY_LIMIT = 8 * 1024 * 1024;

export { validateProjectDefinitions };

export async function scanProjectPackages(projectsRoot, { cache, mounts = {} } = {}) {
  return scanProjectPackagesCore(projectsRoot, { cache, mounts });
}

async function walkPublicFiles(projectRoot) {
  const files = [];
  for (const directoryName of PUBLIC_DIRECTORIES) {
    const directory = path.join(projectRoot, directoryName);
    const walk = async (currentDirectory) => {
      const entries = await fs.readdir(currentDirectory, { withFileTypes: true }).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const entry of entries) {
        const absolutePath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) await walk(absolutePath);
        else if (entry.isFile() && PUBLIC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          files.push(absolutePath);
        }
      }
    };
    await walk(directory);
  }
  return files;
}

async function resolveProjectFile(projectsRoot, projectId, relativePath, mounts = {}) {
  if (!PROJECT_ID_PATTERN.test(projectId || '') || !isSafeRelativePath(relativePath)) return null;
  const projectRoot = resolveMountedProjectRoot(projectsRoot, projectId, mounts);
  const normalized = String(relativePath).replaceAll('\\', '/');
  if (!PUBLIC_DIRECTORIES.has(normalized.split('/')[0])) return null;
  return resolveExistingPathInsideRoot(projectRoot, normalized, {
    allowedExtensions: PUBLIC_EXTENSIONS,
  });
}

function sendJson(res, payload, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function isLocalRequest(req) {
  const address = String(req.socket?.remoteAddress || '').replace('::ffff:', '');
  return address === '' || address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MANAGEMENT_BODY_LIMIT) {
        rejected = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) {
        reject(new Error('请求内容过大，项目 Logo 请控制在 2 MB 以内。'));
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('请求内容不是有效的 JSON。'));
      }
    });
    req.on('error', reject);
  });
}

function normalizePrdBindingsPayload(projectId, payload) {
  return normalizePrdBindings(projectId, payload);
}

function normalizePagePrdLinksPayload(projectId, payload) {
  return normalizePagePrdLinks(projectId, payload);
}

async function readPagePrdLinksFile(projectRoot, projectId) {
  const filePath = await resolveExistingPathInsideRoot(projectRoot, '.platform/page-prd-links.json', {
    allowedExtensions: new Set(['.json']),
  });
  if (!filePath) return normalizePagePrdLinksPayload(projectId, {});
  try {
    return normalizePagePrdLinksPayload(projectId, JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizePagePrdLinksPayload(projectId, {});
    throw error;
  }
}

async function readPrdBindingsFile(projectRoot, projectId) {
  const filePath = await resolveExistingPathInsideRoot(projectRoot, '.platform/prd-bindings.json', {
    allowedExtensions: new Set(['.json']),
  });
  if (!filePath) return normalizePrdBindingsPayload(projectId, {});
  try {
    return normalizePrdBindingsPayload(projectId, JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizePrdBindingsPayload(projectId, {});
    throw error;
  }
}

export { createProjectPackage, normalizeProjectInput, updateProjectPackage };
export const readManifest = readProjectManifest;

export function projectPackagesPlugin({
  projectsRoot,
  mountsPath = '',
  loadMounts = async () => ({ projects: {} }),
}) {
  const root = path.resolve(projectsRoot);
  const workspaceRoot = path.dirname(root);
  const localMountsPath = mountsPath ? path.resolve(mountsPath) : '';
  let isBuild = false;
  let refreshTimer;
  const scanCache = new Map();

  const loadScanResult = async () =>
    scanProjectPackages(root, { cache: scanCache, mounts: await loadMounts() });

  const inspectMountCandidate = async (candidateRoot) => {
    const rawRoot = String(candidateRoot || '').trim();
    if (!rawRoot || !path.isAbsolute(rawRoot)) throw new Error('项目目录必须是本机绝对路径。');
    const selectedRoot = path.resolve(rawRoot);
    const manifestPath = await resolveExistingPathInsideRoot(selectedRoot, 'project.json', {
      allowedExtensions: new Set(['.json']),
    });
    if (!manifestPath) throw new Error('所选目录不包含可读取的 project.json。');
    const manifest = await readProjectManifest(selectedRoot);
    if (!PROJECT_ID_PATTERN.test(manifest.id || '')) throw new Error('project.json 中的项目 ID 无效。');
    const current = await loadMounts();
    const proposed = normalizeProjectMounts({
      schemaVersion: 1,
      projects: {
        ...current.projects,
        [manifest.id]: { ...(current.projects[manifest.id] || {}), root: selectedRoot },
      },
    });
    const scan = await scanProjectPackages(root, { mounts: proposed });
    const invalid = scan.invalidProjects.find((item) => item.folder === manifest.id);
    if (invalid) throw new Error(`项目目录校验失败：${invalid.errors.join('；')}`);
    const project = scan.projects.find((item) => item.id === manifest.id);
    if (!project) throw new Error('所选目录没有形成可用项目。');
    return { root: selectedRoot, project, mounts: proposed };
  };

  return {
    name: 'project-packages',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    configureServer(server) {
      server.watcher.add(root);
      if (localMountsPath) server.watcher.add(localMountsPath);
      server.watcher.on('all', (_eventName, changedPath) => {
        const absolutePath = path.resolve(changedPath);
        const mountChange = Boolean(localMountsPath && absolutePath === localMountsPath);
        if (!mountChange && absolutePath !== root && !isInsideRoot(root, absolutePath)) return;
        const relativePath = toWebPath(path.relative(root, absolutePath));
        const projectEntryChange = absolutePath === root || /^[a-z][a-z0-9-]*$/i.test(relativePath);
        const bindingChange = /^([a-z][a-z0-9-]*)\/\.platform\/prd-bindings\.json$/i.exec(relativePath);
        const manifestChange =
          /^([a-z][a-z0-9-]*)\/(?:project\.json|page-definitions\.js|\.platform\/(?:page-prd-links|route-order)\.json)$/i.test(
            relativePath,
          );
        if (!projectEntryChange && !manifestChange && !bindingChange && !mountChange) return;
        if (projectEntryChange || manifestChange || mountChange) scanCache.delete(root);
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          if (projectEntryChange || manifestChange || mountChange) {
            server.ws.send({ type: 'custom', event: 'project-packages:changed' });
          }
          if (bindingChange) {
            server.ws.send({
              type: 'custom',
              event: 'prd-bindings:changed',
              data: { projectId: bindingChange[1] },
            });
          }
          if (projectEntryChange || manifestChange) {
            server.ws.send({ type: 'full-reload' });
          }
        }, 120);
      });

      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        if (requestUrl.pathname === '/__platform/bootstrap') {
          const scan = await loadScanResult();
          const mounts = await loadMounts();
          sendJson(res, {
            ok: true,
            runtime: { local: isLocalRequest(req), writeEnabled: isLocalRequest(req), readOnly: !isLocalRequest(req) },
            workspace: {
              projectsDirectoryReady: true,
              mountsConfigured: Object.keys(mounts.projects || {}).length,
              projects: scan.projects.length,
              invalidProjects: scan.invalidProjects.length,
              needsOnboarding: scan.projects.length === 0,
            },
          });
          return;
        }
        if (requestUrl.pathname === '/__projects/health') {
          try {
            sendJson(res, await createProjectHealthReport(root, { mounts: await loadMounts() }));
          } catch (error) {
            sendJson(res, { message: '项目健康检查失败。', detail: error.message }, 500);
          }
          return;
        }
        if (requestUrl.pathname === '/__projects/mounts' && req.method === 'GET') {
          sendJson(res, isLocalRequest(req) ? await loadMounts() : normalizeProjectMounts({}));
          return;
        }
        if (
          [
            '/__platform/select-directory',
            '/__projects/mount/inspect',
            '/__projects/mount',
            '/__projects/unmount',
            '/__projects/install-example',
          ].includes(requestUrl.pathname)
        ) {
          if (!isLocalRequest(req)) {
            sendJson(res, { message: '工作区配置仅允许在服务主机上执行。' }, 403);
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, { message: '该接口只支持 POST。' }, 405);
            return;
          }
          try {
            if (requestUrl.pathname === '/__platform/select-directory') {
              const selected = await selectLocalDirectory();
              sendJson(res, { ok: true, cancelled: !selected, path: selected || '' });
              return;
            }
            if (requestUrl.pathname === '/__projects/install-example') {
              const source = path.join(workspaceRoot, 'examples', 'sample-project');
              const target = path.join(root, 'sample-project');
              if (await fs.stat(target).catch(() => null)) throw Object.assign(new Error('示例项目已经存在。'), { statusCode: 409 });
              await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
              scanCache.delete(root);
              sendJson(res, { ok: true, projectId: 'sample-project', message: '示例项目已创建。' });
              return;
            }
            const body = await readJsonBody(req);
            if (requestUrl.pathname === '/__projects/mount/inspect') {
              const result = await inspectMountCandidate(body.root);
              sendJson(res, { ok: true, root: result.root, project: result.project });
              return;
            }
            if (requestUrl.pathname === '/__projects/mount') {
              if (!localMountsPath) throw new Error('开发服务未配置挂载文件。');
              const result = await inspectMountCandidate(body.root);
              await writeJsonAtomic(localMountsPath, result.mounts);
              scanCache.delete(root);
              sendJson(res, { ok: true, project: result.project, message: '项目已挂载，源文件保持在原目录。' });
              return;
            }
            const projectId = String(body.projectId || '').trim();
            const mounts = await loadMounts();
            if (!PROJECT_ID_PATTERN.test(projectId) || !mounts.projects?.[projectId]?.root) {
              throw Object.assign(new Error('找不到外部项目挂载。'), { statusCode: 404 });
            }
            const projects = { ...mounts.projects };
            delete projects[projectId];
            await writeJsonAtomic(localMountsPath, normalizeProjectMounts({ schemaVersion: 1, projects }));
            scanCache.delete(root);
            sendJson(res, { ok: true, projectId, message: '挂载已取消，源项目文件未被修改。' });
          } catch (error) {
            sendJson(res, { ok: false, message: error.message }, error.statusCode || 400);
          }
          return;
        }
        if (requestUrl.pathname === '/__projects/prd-bindings') {
          const projectId = requestUrl.searchParams.get('project') || '';
          if (!PROJECT_ID_PATTERN.test(projectId)) {
            sendJson(res, { message: '项目 ID 无效。' }, 400);
            return;
          }
          const projectRoot = resolveMountedProjectRoot(root, projectId, await loadMounts());
          if (req.method === 'GET') {
            try {
              sendJson(res, await readPrdBindingsFile(projectRoot, projectId));
            } catch (error) {
              sendJson(res, { message: 'PRD 关联配置读取失败。', detail: error.message }, 500);
            }
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Allow', 'GET, POST');
            sendJson(res, { message: 'PRD 关联配置只支持 GET 或 POST。' }, 405);
            return;
          }
          if (!isLocalRequest(req)) {
            sendJson(res, { message: 'PRD 关联编辑仅允许本机开发环境使用。' }, 403);
            return;
          }
          try {
            const body = await readJsonBody(req);
            const payload = normalizePrdBindingsPayload(projectId, body);
            const filePath = await resolveWritablePathInsideRoot(projectRoot, '.platform/prd-bindings.json', {
              allowedExtensions: new Set(['.json']),
            });
            if (!filePath) throw new Error('PRD 关联配置写入路径不安全。');
            await writeJsonAtomic(filePath, payload);
            server.ws.send({ type: 'custom', event: 'prd-bindings:changed', data: { projectId } });
            sendJson(res, payload);
          } catch (error) {
            sendJson(res, { message: 'PRD 关联配置保存失败。', detail: error.message }, 400);
          }
          return;
        }
        if (requestUrl.pathname === '/__projects/page-prd-links') {
          const projectId = requestUrl.searchParams.get('project') || '';
          if (!PROJECT_ID_PATTERN.test(projectId)) {
            sendJson(res, { message: '项目 ID 无效。' }, 400);
            return;
          }
          const projectRoot = resolveMountedProjectRoot(root, projectId, await loadMounts());
          if (req.method === 'GET') {
            try {
              sendJson(res, await readPagePrdLinksFile(projectRoot, projectId));
            } catch (error) {
              sendJson(res, { message: '页面 PRD 关联配置读取失败。', detail: error.message }, 500);
            }
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Allow', 'GET, POST');
            sendJson(res, { message: '页面 PRD 关联配置只支持 GET 或 POST。' }, 405);
            return;
          }
          if (!isLocalRequest(req)) {
            sendJson(res, { message: '页面 PRD 关联编辑仅允许本机开发环境使用。' }, 403);
            return;
          }
          try {
            const body = await readJsonBody(req);
            const payload = normalizePagePrdLinksPayload(projectId, body);
            const filePath = await resolveWritablePathInsideRoot(
              projectRoot,
              '.platform/page-prd-links.json',
              { allowedExtensions: new Set(['.json']) },
            );
            if (!filePath) throw new Error('页面 PRD 关联配置写入路径不安全。');
            await writeJsonAtomic(filePath, payload);
            server.ws.send({ type: 'custom', event: 'page-prd-links:changed', data: { projectId } });
            sendJson(res, payload);
          } catch (error) {
            sendJson(res, { message: '页面 PRD 关联配置保存失败。', detail: error.message }, 400);
          }
          return;
        }
        if (requestUrl.pathname === '/__projects/create' || requestUrl.pathname === '/__projects/update') {
          if (!isLocalRequest(req)) {
            sendJson(res, { message: '项目管理接口仅允许本机访问。' }, 403);
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Allow', 'POST');
            sendJson(res, { message: '项目管理接口只支持 POST。' }, 405);
            return;
          }
          try {
            const body = await readJsonBody(req);
            const editing = requestUrl.pathname.endsWith('/update');
            const projectId = String(body.id || '').trim();
            if (editing && !PROJECT_ID_PATTERN.test(projectId)) {
              throw new Error('项目 ID 必须使用小写 kebab-case。');
            }
            const projectRoot = resolveMountedProjectRoot(root, projectId, await loadMounts());
            const existingManifest = editing ? await readProjectManifest(projectRoot) : null;
            const input = normalizeProjectInput(body, { editing, existingManifest });
            const manifest = requestUrl.pathname.endsWith('/create')
              ? await createProjectPackage(root, input)
              : await updateProjectPackage(root, input, { projectRoot });
            scanCache.delete(root);
            sendJson(res, {
              ok: true,
              project: toPublicProjectManifest(manifest),
              message: requestUrl.pathname.endsWith('/create') ? '项目初始化包已生成。' : '项目配置已保存。',
            });
          } catch (error) {
            sendJson(res, { ok: false, message: error.message }, error.statusCode || 400);
          }
          return;
        }
        if (requestUrl.pathname === '/__projects/manifest') {
          try {
            sendJson(res, await loadScanResult());
          } catch (error) {
            sendJson(res, { message: '项目包扫描失败', detail: error.message }, 500);
          }
          return;
        }
        if (requestUrl.pathname === '/__projects/file') {
          const target = await resolveProjectFile(
            root,
            requestUrl.searchParams.get('project'),
            requestUrl.searchParams.get('path'),
            await loadMounts(),
          );
          if (!target) {
            sendJson(res, { message: '项目资源路径无效' }, 400);
            return;
          }
          try {
            const content = await fs.readFile(target);
            res.statusCode = 200;
            res.setHeader(
              'Content-Type',
              MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
            );
            res.setHeader('Cache-Control', 'no-store');
            res.end(content);
          } catch (error) {
            sendJson(
              res,
              { message: '项目资源读取失败', detail: error.message },
              error.code === 'ENOENT' ? 404 : 500,
            );
          }
          return;
        }
        next();
      });
    },
    async buildStart() {
      if (!isBuild) return;
      const manifest = await scanProjectPackages(root, { mounts: await loadMounts() });
      if (manifest.invalidProjects.length) {
        const details = manifest.invalidProjects
          .flatMap((project) => project.errors.map((error) => `${project.folder}: ${error}`))
          .join('\n');
        this.error(`存在无效项目包，已停止构建：\n${details}`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'projects/manifest.json',
        source: JSON.stringify(manifest, null, 2),
      });
      for (const project of manifest.projects) {
        const projectRoot = resolveMountedProjectRoot(root, project.id, await loadMounts());
        for (const absolutePath of await walkPublicFiles(projectRoot)) {
          const relativePath = toWebPath(path.relative(projectRoot, absolutePath));
          this.emitFile({
            type: 'asset',
            fileName: `projects/${project.id}/${relativePath}`,
            source: await fs.readFile(absolutePath),
          });
        }
      }
    },
  };
}
