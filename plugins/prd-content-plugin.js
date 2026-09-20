import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  DOCUMENT_PUBLIC_EXTENSIONS,
  createDocumentManifest,
  isInsideRoot,
  loadProjectDocumentRoots,
  toWebPath,
  walkFiles,
} from '../packages/project-core/src/index.js';

const MIME_TYPES = {
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function resolvePublicFile(root, relativePath) {
  const normalizedPath = String(relativePath || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  const target = path.resolve(root, ...normalizedPath.split('/'));
  if (!isInsideRoot(root, target) || !DOCUMENT_PUBLIC_EXTENSIONS.has(path.extname(target).toLowerCase())) {
    return null;
  }
  return target;
}

function sendJson(res, payload, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function prdContentPlugin({
  projectsRoot,
  mountsPath = '',
  loadMounts = async () => ({ projects: {} }),
}) {
  const root = path.resolve(projectsRoot);
  const localMountsPath = mountsPath ? path.resolve(mountsPath) : '';
  let isBuild = false;
  let documentRoots = new Map();
  let documentRootsLoading = null;

  async function refreshDocumentRoots() {
    if (!documentRootsLoading) {
      documentRootsLoading = loadMounts()
        .then((mounts) => loadProjectDocumentRoots(root, { mounts }))
        .then((nextRoots) => {
          documentRoots = nextRoots;
          return nextRoots;
        })
        .finally(() => {
          documentRootsLoading = null;
        });
    }
    return documentRootsLoading;
  }

  return {
    name: 'project-prd-content',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    async configureServer(server) {
      await refreshDocumentRoots();
      server.watcher.add(root);
      if (localMountsPath) server.watcher.add(localMountsPath);
      documentRoots.forEach((docsRoot) => server.watcher.add(docsRoot));
      server.watcher.on('all', async (_eventName, changedPath) => {
        try {
          const absolutePath = path.resolve(changedPath);
          const relativePath = toWebPath(path.relative(root, absolutePath));
          const isProjectConfigChange =
            absolutePath === root || /^([a-z][a-z0-9-]*)\/project\.json$/iu.test(relativePath);
          const isMountChange = Boolean(localMountsPath && absolutePath === localMountsPath);
          if (isProjectConfigChange || isMountChange) {
            await refreshDocumentRoots();
            documentRoots.forEach((docsRoot) => server.watcher.add(docsRoot));
          }
          for (const [projectId, docsRoot] of documentRoots) {
            if (isInsideRoot(docsRoot, absolutePath)) {
              server.ws.send({ type: 'custom', event: 'prd-docs:changed', data: { projectId } });
              break;
            }
          }
        } catch (error) {
          server.config.logger.error(`[prd-content] 文档目录刷新失败：${error.message}`);
        }
      });
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        if (!['/__prd/manifest', '/__prd/file'].includes(requestUrl.pathname)) return next();
        const projectId = requestUrl.searchParams.get('project');
        let docsRoot = documentRoots.get(projectId);
        if (!docsRoot) docsRoot = (await refreshDocumentRoots()).get(projectId);
        if (!docsRoot) {
          sendJson(res, { message: '项目文档目录不存在或项目不可用' }, 404);
          return;
        }
        if (requestUrl.pathname === '/__prd/manifest') {
          try {
            sendJson(res, await createDocumentManifest(docsRoot));
          } catch (error) {
            sendJson(res, { message: '文档清单读取失败', detail: error.message }, 500);
          }
          return;
        }
        const target = resolvePublicFile(docsRoot, requestUrl.searchParams.get('path'));
        if (!target) {
          sendJson(res, { message: '文档路径无效' }, 400);
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
            { message: '文档读取失败', detail: error.message },
            error.code === 'ENOENT' ? 404 : 500,
          );
        }
      });
    },
    async buildStart() {
      if (!isBuild) return;
      documentRoots = await loadProjectDocumentRoots(root, { mounts: await loadMounts() });
      for (const [projectId, docsRoot] of documentRoots) {
        const manifest = await createDocumentManifest(docsRoot);
        this.emitFile({
          type: 'asset',
          fileName: `projects/${projectId}/docs/manifest.json`,
          source: JSON.stringify(manifest, null, 2),
        });
        for (const absolutePath of await walkFiles(docsRoot, {
          extensions: DOCUMENT_PUBLIC_EXTENSIONS,
        })) {
          const relativePath = toWebPath(path.relative(docsRoot, absolutePath));
          const isMarkdown = path.extname(absolutePath).toLowerCase() === '.md';
          this.emitFile({
            type: 'asset',
            fileName: `projects/${projectId}/docs/content/${
              isMarkdown ? relativePath.replace(/\.md$/iu, '.json') : relativePath
            }`,
            source: isMarkdown
              ? JSON.stringify({ content: await fs.readFile(absolutePath, 'utf8') })
              : await fs.readFile(absolutePath),
          });
        }
      }
    },
  };
}
