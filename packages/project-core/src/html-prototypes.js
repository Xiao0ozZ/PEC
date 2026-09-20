import { promises as fs } from 'node:fs';
import path from 'node:path';

import { HTML_EXTENSIONS } from './constants.js';
import {
  fileExists,
  importJavaScriptFile,
  resolveExistingPathInsideRoot,
  toWebPath,
  walkFiles,
} from './filesystem.js';
import {
  isHtmlPrototypeContentSource,
  readPrototypeManifest,
} from './html-prototype-format.js';
import { listProjectLocations, resolveProjectPrototypeSources } from './project-mounts.js';
import { orderClientRouteData } from './route-order.js';

const PUBLIC_EXTENSIONS = new Set([
  '.avif',
  '.css',
  '.gif',
  '.html',
  '.htm',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.mjs',
  '.mp3',
  '.mp4',
  '.png',
  '.svg',
  '.ttf',
  '.wasm',
  '.webmanifest',
  '.webp',
  '.woff',
  '.woff2',
]);

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function readMetaValue(source, name) {
  const tags = source.match(/<meta\b[^>]*>/giu) || [];
  const expected = String(name).toLowerCase();
  for (const tag of tags) {
    const nameMatch = tag.match(/\bname\s*=\s*["']([^"']+)["']/iu);
    if (nameMatch?.[1].toLowerCase() !== expected) continue;
    const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/iu);
    if (contentMatch) return decodeHtmlEntities(contentMatch[1]);
  }
  return '';
}

function readHtmlTitle(source, filePath) {
  const explicitTitle = readMetaValue(source, 'prototype-title');
  if (explicitTitle) return explicitTitle;
  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  if (title) return decodeHtmlEntities(title.replace(/<[^>]+>/gu, ' '));
  const heading = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1];
  if (heading) return decodeHtmlEntities(heading.replace(/<[^>]+>/gu, ' '));
  return path.basename(filePath).replace(/\.(?:html?|HTML?)$/u, '');
}

function normalizeSlug(value) {
  const slug = String(value || '')
    .normalize('NFKC')
    .replace(/\.(?:html?|HTML?)$/u, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  return slug || 'page';
}

function shortHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 7);
}

function createRoutePath(relativePath, explicitPath = '') {
  const sourcePath = explicitPath || relativePath.replace(/\.(?:html?|HTML?)$/u, '');
  const routePath = sourcePath
    .split('/')
    .filter(Boolean)
    .map((segment) => normalizeSlug(segment))
    .filter(Boolean)
    .join('-');
  return routePath || `page-${shortHash(relativePath)}`;
}

function routePathFromPrototypeManifest(manifest) {
  const routePath =
    String(manifest?.routePath || '')
      .split('/')
      .filter(Boolean)
      .at(-1) || '';
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(routePath) ? routePath : '';
}

async function readProjectDefinition(projectRoot, manifest) {
  const definitionPath = await resolveExistingPathInsideRoot(
    projectRoot,
    manifest.pageDefinitions || 'page-definitions.js',
    { allowedExtensions: new Set(['.js']) },
  );
  if (!definitionPath) throw new Error('页面定义文件不存在、越界或类型无效。');
  const module = await importJavaScriptFile(definitionPath, { cacheKey: `html-${Date.now()}` });
  return module.clientPageDefinitions || module.default || {};
}

function normalizeClientKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function resolveClientId({ prototype, sourceClientId = '', manifestClientId = '', relativePath, clients }) {
  for (const candidate of [sourceClientId, manifestClientId, prototype.client]) {
    const clientId = String(candidate || '').trim();
    if (clientId && clients.some((client) => client.id === clientId)) return clientId;
  }

  const normalizedSegment = normalizeClientKey(relativePath.split('/')[0] || '');
  const matchedClient = clients.find((client) =>
    [client.id, client.name, client.shortName].some(
      (candidate) => normalizeClientKey(candidate) === normalizedSegment,
    ),
  );
  if (matchedClient) return matchedClient.id;
  if (clients.length === 1) return clients[0].id;
  return '';
}

function resolveSourceRelativePath(relativePath, clientId, clients) {
  const segments = relativePath.split('/').filter(Boolean);
  const firstSegment = segments[0] || '';
  const client = clients.find(
    (item) =>
      item.id === clientId &&
      [item.id, item.name, item.shortName].some(
        (candidate) => normalizeClientKey(candidate) === normalizeClientKey(firstSegment),
      ),
  );
  return client ? segments.slice(1).join('/') || segments.join('/') : relativePath;
}

async function readProjectManifests(projectsRoot, mounts = {}) {
  const manifests = [];
  for (const location of await listProjectLocations(projectsRoot, mounts)) {
    const projectRoot = location.root;
    try {
      const manifestPath = await resolveExistingPathInsideRoot(projectRoot, 'project.json', {
        allowedExtensions: new Set(['.json']),
      });
      if (!manifestPath) continue;
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (manifest.id !== location.projectId) continue;
      const sources = [];
      for (const source of resolveProjectPrototypeSources(manifest, projectRoot, mounts)) {
        if (await fileExists(source.root, 'directory')) {
          sources.push({ ...source, prototypeRoot: source.root });
        }
      }
      manifests.push({ projectId: location.projectId, projectRoot, manifest, sources });
    } catch {
      // 项目包完整性由项目包扫描器负责；这里只跳过无法读取的项目包。
    }
  }
  return manifests;
}

export async function scanHtmlPrototypePages(projectsRoot, { mounts = {} } = {}) {
  const projects = {};
  const roots = {};
  const sections = {};
  const manifests = await readProjectManifests(path.resolve(projectsRoot), mounts);

  for (const item of manifests) {
    const definitions = await readProjectDefinition(item.projectRoot, item.manifest).catch(() => ({}));
    const clients = item.manifest.clients || [];
    const pagesByClient = {};
    const managedSources = [];
    for (const client of clients) {
      const managedPages = (definitions[client.id]?.pages || []).filter(
        (page) => page?.sourceType === 'html-template' && String(page?.source || '').trim(),
      );
      if (!managedPages.length) continue;
      managedSources.push({
        clientId: client.id,
        sourceId: `managed-${client.id}`,
        root: path.join(item.projectRoot, 'html-pages', client.id),
        shellMode: 'auto',
        managed: true,
        pages: managedPages,
      });
    }
    const allSources = [...item.sources, ...managedSources];
    roots[item.projectId] = allSources.map((source) => ({
      clientId: source.clientId,
      sourceId: source.sourceId || source.clientId,
      root: source.prototypeRoot || source.root,
      shellMode: source.shellMode,
    }));

    for (const prototypeSource of allSources.filter((source) => !source.managed)) {
      const htmlFiles = await walkFiles(prototypeSource.prototypeRoot || prototypeSource.root, {
        extensions: PUBLIC_EXTENSIONS,
      });
      for (const absolutePath of htmlFiles) {
        if (!HTML_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) continue;
        const relativePath = toWebPath(path.relative(prototypeSource.prototypeRoot, absolutePath));
        const source = await fs.readFile(absolutePath, 'utf8');
        const prototypeManifest = readPrototypeManifest(source);
        const isContentOnlyHtml = isHtmlPrototypeContentSource(source);
        const clientId = resolveClientId({
          prototype: item.manifest.prototype,
          sourceClientId: prototypeSource.clientId,
          manifestClientId: prototypeManifest?.client,
          relativePath,
          clients,
        });
        if (!clientId || !definitions[clientId]) continue;
        const clientDefinition = definitions[clientId];
        const sourcePath = prototypeSource.clientId
          ? relativePath
          : resolveSourceRelativePath(relativePath, clientId, clients);
        const explicitPath = isContentOnlyHtml
          ? routePathFromPrototypeManifest(prototypeManifest)
          : readMetaValue(source, 'prototype-path');
        const pagePath = createRoutePath(sourcePath, explicitPath);
        const sourceIdentity = `${clientId}/${prototypeSource.sourceId || prototypeSource.configuredRoot || prototypeSource.root}/${relativePath}`;
        const manifestPageKey =
          isContentOnlyHtml && prototypeManifest?.pageKey ? normalizeSlug(prototypeManifest.pageKey) : '';
        const pageName = manifestPageKey
          ? `html-${manifestPageKey}-${shortHash(sourceIdentity)}`
          : `html-${shortHash(sourceIdentity)}`;
        const sectionCandidates = [
          readMetaValue(source, 'prototype-section'),
          isContentOnlyHtml ? String(prototypeManifest?.menuSection || '').trim() : '',
          prototypeSource.section,
          String(item.manifest.prototype.section || '').trim(),
        ];
        const section =
          sectionCandidates.find((candidate) =>
            clientDefinition.sections?.some((sectionItem) => sectionItem.id === candidate),
          ) ||
          clientDefinition.sections?.[0]?.id ||
          'workspace';
        pagesByClient[clientId] ||= [];
        pagesByClient[clientId].push({
          path: pagePath,
          name: pageName,
          title: isContentOnlyHtml
            ? prototypeManifest?.pageTitle || prototypeManifest?.menuTitle || readHtmlTitle(source, absolutePath)
            : readHtmlTitle(source, absolutePath),
          sourceType: 'html-direct',
          source: relativePath,
          sourceRoot: prototypeSource.sourceId || prototypeSource.clientId || '_',
          renderMode:
            prototypeSource.shellMode === 'full' ? 'full' : isContentOnlyHtml ? 'content-only' : 'full',
          section,
          icon:
            readMetaValue(source, 'prototype-icon') ||
            (isContentOnlyHtml ? prototypeManifest?.menuIcon : '') ||
            prototypeSource.icon ||
            'Document',
          menu:
            isContentOnlyHtml && typeof prototypeManifest?.menu === 'boolean'
              ? prototypeManifest.menu
              : readMetaValue(source, 'prototype-menu') !== 'false',
        });
      }
    }

    for (const source of managedSources) {
      for (const page of source.pages) {
        const relativePath = String(page.source || '')
          .replaceAll('\\', '/')
          .replace(/^\/+/, '');
        const sourcePath = await resolveExistingPathInsideRoot(source.root, relativePath, {
          allowedExtensions: HTML_EXTENSIONS,
        });
        if (!sourcePath) {
          continue;
        }
        pagesByClient[source.clientId] ||= [];
        pagesByClient[source.clientId].push({
          path: page.path,
          name: page.name,
          title: page.title,
          sourceType: 'html-template',
          source: relativePath,
          sourceRoot: source.sourceId,
          renderMode: 'content-only',
          section: page.section,
          icon: page.icon || 'Document',
          menu: page.menu !== false,
        });
      }
    }

    const routeOrderPath = await resolveExistingPathInsideRoot(
      item.projectRoot,
      '.platform/route-order.json',
      { allowedExtensions: new Set(['.json']) },
    );
    const routeOrder = routeOrderPath
      ? JSON.parse(await fs.readFile(routeOrderPath, 'utf8').catch(() => '{}'))
      : {};
    const sectionsByClient = {};
    for (const [clientId, definition] of Object.entries(definitions)) {
      const ordered = orderClientRouteData(
        definition.sections || [],
        pagesByClient[clientId] || [],
        routeOrder?.clients?.[clientId] || {},
      );
      pagesByClient[clientId] = ordered.pages;
      sectionsByClient[clientId] = ordered.sections;
    }
    projects[item.projectId] = pagesByClient;
    sections[item.projectId] = sectionsByClient;
  }

  return { projects, roots, sections };
}

const CONTENT_ONLY_STYLE = `
<style id="platform-html-content-only">
  html,
  body,
  #app {
    width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
    min-height: 100% !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
  }
  .app-shell {
    display: block !important;
    width: 100% !important;
    min-height: 100vh !important;
    height: auto !important;
    overflow: visible !important;
    background: transparent !important;
  }
  .app-sidebar,
  .topbar,
  .sidebar-scrim,
  .prototype-sidebar,
  .prototype-topbar {
    display: none !important;
  }
  .page-workspace {
    display: block !important;
    width: 100% !important;
    min-height: 100vh !important;
    height: auto !important;
    overflow: visible !important;
  }
  .page-container {
    width: 100% !important;
    min-height: 100vh !important;
    padding: 24px 28px 32px !important;
    overflow: visible !important;
  }
  .prototype-app {
    display: block !important;
    width: 100% !important;
    min-height: 100vh !important;
    height: auto !important;
    overflow: visible !important;
    background: transparent !important;
  }
  .prototype-workspace {
    display: block !important;
    width: 100% !important;
    min-height: 100vh !important;
    height: auto !important;
    overflow: visible !important;
  }
  .prototype-main {
    width: 100% !important;
    min-height: 100vh !important;
    padding: 24px 28px 32px !important;
    overflow: visible !important;
  }
</style>`;

export function applyContentOnlyMode(source) {
  if (!isHtmlPrototypeContentSource(source) || /id=["']platform-html-content-only["']/i.test(source)) {
    return source;
  }
  if (/<\/head>/i.test(source)) return source.replace(/<\/head>/i, `${CONTENT_ONLY_STYLE}</head>`);
  return `${CONTENT_ONLY_STYLE}${source}`;
}
