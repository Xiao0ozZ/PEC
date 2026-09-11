import { promises as fs } from 'node:fs';
import path from 'node:path';

import { normalizePagePrdLinks, normalizePrdBindings } from './bindings.js';
import { createProjectContext } from './ai-context.js';
import { createDocumentManifest } from './documents.js';
import { importJavaScriptFile, readJsonFile, resolveExistingPathInsideRoot } from './filesystem.js';
import { scanHtmlPrototypePages } from './html-prototypes.js';
import { resolveProjectDocsRoot, resolveProjectRoot } from './project-mounts.js';

function mergeClientPages(definitions, htmlPages = {}) {
  return Object.fromEntries(
    Object.entries(definitions || {}).map(([clientId, definition]) => {
      const pages = [...(definition.pages || [])];
      const existingPaths = new Set(pages.map((page) => page.path));
      for (const page of htmlPages[clientId] || []) {
        if (!existingPaths.has(page.path)) pages.push(page);
      }
      return [clientId, { ...definition, pages }];
    }),
  );
}

function mergePageLinks(baseLinks, overrideLinks) {
  const merged = Object.fromEntries(
    Object.entries(baseLinks || {}).map(([clientId, pages]) => [clientId, { ...(pages || {}) }]),
  );
  for (const [clientId, pages] of Object.entries(overrideLinks || {})) {
    merged[clientId] ||= {};
    for (const [pageName, documentPath] of Object.entries(pages || {})) {
      if (documentPath === null || documentPath === '') delete merged[clientId][pageName];
      else merged[clientId][pageName] = documentPath;
    }
  }
  return merged;
}

async function readDefinitions(projectRoot, manifest) {
  const definitionsPath = path.resolve(projectRoot, manifest.pageDefinitions || 'page-definitions.js');
  const module = await importJavaScriptFile(definitionsPath, { cacheKey: `context-${Date.now()}` });
  return module.clientPageDefinitions || module.default;
}

async function readLegacyPageLinks(projectRoot) {
  const filePath = path.join(projectRoot, 'page-prd-links.js');
  const exists = await fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);
  if (!exists) return {};
  const module = await importJavaScriptFile(filePath, { cacheKey: `legacy-links-${Date.now()}` });
  return module.default || module.pagePrdLinks || {};
}

async function resolvePageSourceAvailability(projectRoot, manifest, client, page, htmlCatalog) {
  const sourceType = page.sourceType || (page.view ? 'vue' : '');
  if (sourceType === 'vue' && page.view) {
    const packageView = await resolveExistingPathInsideRoot(path.resolve(projectRoot, 'views'), page.view, {
      allowedExtensions: new Set(['.vue']),
    });
    if (packageView) return true;
    const compatibilityRoot = manifest.compatibility?.legacyViewRoot
      ? path.resolve(projectRoot, '..', '..', manifest.compatibility.legacyViewRoot)
      : '';
    const compatibilityView = compatibilityRoot
      ? await resolveExistingPathInsideRoot(compatibilityRoot, page.view, {
          allowedExtensions: new Set(['.vue']),
        })
      : null;
    return Boolean(compatibilityView);
  }
  const source = String(page.source || '').replaceAll('\\', '/');
  if (!source) return undefined;
  // HTML 来源目录与扫描器保持同一套解析：优先按页面登记的 sourceRoot 匹配，
  // 再退回同客户端唯一来源；模板托管页面固定在包内 html-pages/{clientId}。
  const catalogRoots = htmlCatalog?.roots?.[manifest.id] || [];
  const htmlRoot =
    catalogRoots.find((item) => item.sourceId && item.sourceId === page.sourceRoot)?.root ||
    (sourceType === 'html-template'
      ? path.join(projectRoot, 'html-pages', client.id)
      : catalogRoots.find((item) => item.clientId === client.id)?.root) ||
    '';
  if (!htmlRoot) return undefined;
  const resolved = await resolveExistingPathInsideRoot(htmlRoot, source, {
    allowedExtensions: new Set(['.html', '.htm']),
  });
  return Boolean(resolved);
}

async function resolveSourceAvailability(projectRoot, manifest, definitions, htmlCatalog) {
  const sourceAvailability = {};
  for (const client of manifest.clients || []) {
    for (const page of definitions[client.id]?.pages || []) {
      const availability = await resolvePageSourceAvailability(
        projectRoot,
        manifest,
        client,
        page,
        htmlCatalog,
      );
      if (availability !== undefined) sourceAvailability[`${client.id}:${page.name}`] = availability;
    }
  }
  return sourceAvailability;
}

/**
 * 装载单个项目包的完整 AI 交付上下文。
 * CLI、MCP 等自动化入口共用此装载器，不得各自解析项目文件。
 */
export async function loadProjectAiContext(projectsRoot, projectId, { mounts = {} } = {}) {
  const resolvedRoot = path.resolve(projectsRoot);
  const projectRoot = resolveProjectRoot(resolvedRoot, projectId, mounts);
  const manifest = await readJsonFile(path.join(projectRoot, 'project.json'));
  const htmlCatalog = await scanHtmlPrototypePages(resolvedRoot, { mounts });
  const definitions = mergeClientPages(
    await readDefinitions(projectRoot, manifest),
    htmlCatalog.projects[projectId],
  );
  const docsRoot = manifest.docs?.enabled ? resolveProjectDocsRoot(manifest, projectRoot, mounts) : '';
  const documentManifest = docsRoot
    ? await createDocumentManifest(docsRoot)
    : { generatedAt: new Date().toISOString(), documents: [] };
  const documentSources = {};
  for (const document of documentManifest.documents) {
    documentSources[document.path] = await fs.readFile(
      path.join(docsRoot, ...document.path.split('/')),
      'utf8',
    );
  }
  const platformRoot = path.join(projectRoot, '.platform');
  const linksPayload = normalizePagePrdLinks(
    projectId,
    await readJsonFile(path.join(platformRoot, 'page-prd-links.json'), { fallback: {} }),
  );
  const pagePrdLinks = mergePageLinks(await readLegacyPageLinks(projectRoot), linksPayload.links);
  const bindingsPayload = normalizePrdBindings(
    projectId,
    await readJsonFile(path.join(platformRoot, 'prd-bindings.json'), { fallback: {} }),
  );
  const sourceAvailability = await resolveSourceAvailability(projectRoot, manifest, definitions, htmlCatalog);
  return createProjectContext({
    project: {
      ...manifest,
      clients: (manifest.clients || []).map((client) => ({ ...client, definition: definitions[client.id] })),
      pagePrdLinks,
    },
    documentManifest,
    documentSources,
    bindings: bindingsPayload.bindings,
    sourceAvailability,
  });
}
