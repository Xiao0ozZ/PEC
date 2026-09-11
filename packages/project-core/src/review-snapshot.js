import path from 'node:path';

import { createDocumentManifest } from './documents.js';
import { readJsonFile } from './filesystem.js';
import { scanHtmlPrototypePages } from './html-prototypes.js';
import { normalizePagePrdLinks, normalizePrdBindings } from './bindings.js';
import { resolveProjectDocsRoot, resolveProjectRoot } from './project-mounts.js';
import { scanProjectPackages } from './project-scanner.js';

export const REVIEW_SNAPSHOT_SCHEMA_VERSION = 1;
export const REVIEW_SNAPSHOT_ARTIFACT_TYPE = 'static-review-snapshot';
export const REVIEW_SNAPSHOT_FILE_NAME = 'review-manifest.json';

async function readProjectAssociations(projectRoot, projectId) {
  const platformRoot = path.join(projectRoot, '.platform');
  const [rawLinks, rawBindings] = await Promise.all([
    readJsonFile(path.join(platformRoot, 'page-prd-links.json'), { fallback: { links: {} } }).catch(
      () => ({ links: {} }),
    ),
    readJsonFile(path.join(platformRoot, 'prd-bindings.json'), { fallback: { bindings: [] } }).catch(
      () => ({ bindings: [] }),
    ),
  ]);

  let pageLinks = { links: {} };
  let bindings = { bindings: [] };
  try {
    pageLinks = normalizePagePrdLinks(projectId, rawLinks);
  } catch {
    // 关联配置无效时按空范围记录，评审包不应因源项目的既存错误而中断生成。
  }
  try {
    bindings = normalizePrdBindings(projectId, rawBindings);
  } catch {
    // 同上：组件级关联无效时记录为空，问题仍由项目健康检查负责报告。
  }
  return { pageLinks, bindings };
}

function collectPageLinks(pageLinks) {
  const entries = [];
  for (const [clientId, links] of Object.entries(pageLinks.links || {})) {
    for (const [pageName, documentPath] of Object.entries(links || {})) {
      if (!documentPath) continue;
      entries.push({ clientId, pageName, document: documentPath });
    }
  }
  return entries.sort(
    (left, right) =>
      left.clientId.localeCompare(right.clientId) || left.pageName.localeCompare(right.pageName),
  );
}

function collectBindings(bindings) {
  return (bindings.bindings || [])
    .map((binding) => ({
      id: binding.id || '',
      pagePath: binding.pagePath || '',
      targetTag: binding.target?.tag || '',
      document: binding.prd?.document || '',
      anchor: binding.prd?.anchor || '',
      label: binding.prd?.label || '',
    }))
    .filter((binding) => binding.pagePath && binding.document)
    .sort(
      (left, right) => left.pagePath.localeCompare(right.pagePath) || left.id.localeCompare(right.id),
    );
}

/**
 * 生成静态评审快照清单：固定快照时间，并明确项目、客户端、页面、PRD 文档与关联范围。
 * 只读取项目资料，不写入任何项目文件。
 */
export async function createReviewSnapshotManifest(
  projectsRoot,
  { mounts = {}, base = '/', generatedAt = new Date().toISOString() } = {},
) {
  const root = path.resolve(projectsRoot);
  const [scan, catalog] = await Promise.all([
    scanProjectPackages(root, { mounts }),
    scanHtmlPrototypePages(root, { mounts }),
  ]);

  const projects = [];
  for (const project of scan.projects) {
    const projectRoot = resolveProjectRoot(root, project.id, mounts);
    const clientPages = catalog.projects?.[project.id] ?? {};
    const { pageLinks, bindings } = await readProjectAssociations(projectRoot, project.id);

    let documents = [];
    if (project.docs?.enabled) {
      const docsRoot = resolveProjectDocsRoot(project, projectRoot, mounts);
      const manifest = await createDocumentManifest(docsRoot).catch(() => ({ documents: [] }));
      documents = manifest.documents.map((document) => ({
        path: document.path,
        title: document.title || '',
      }));
    }

    const clients = (project.clients || []).map((client) => {
      const pages = clientPages[client.id] ?? [];
      return {
        id: client.id,
        name: client.name,
        layout: client.layout?.type || 'sidebar',
        pageCount: pages.length,
        pages: pages.map((page) => ({
          name: page.name,
          path: page.path,
          title: page.title,
          source: page.source,
          route: `/p/${project.id}/${client.id}/${page.path}`,
        })),
      };
    });

    const pageLinkEntries = collectPageLinks(pageLinks);
    const bindingEntries = collectBindings(bindings);
    projects.push({
      id: project.id,
      name: project.name,
      version: project.version,
      docsEnabled: project.docs?.enabled !== false,
      clients,
      documents,
      associations: {
        pageLinks: pageLinkEntries,
        componentBindings: bindingEntries,
      },
      counts: {
        clients: clients.length,
        pages: clients.reduce((total, client) => total + client.pageCount, 0),
        documents: documents.length,
        pageLinks: pageLinkEntries.length,
        componentBindings: bindingEntries.length,
      },
    });
  }

  return {
    schemaVersion: REVIEW_SNAPSHOT_SCHEMA_VERSION,
    artifactType: REVIEW_SNAPSHOT_ARTIFACT_TYPE,
    generatedAt,
    base,
    editable: false,
    scope: {
      projects: projects.length,
      clients: projects.reduce((total, project) => total + project.counts.clients, 0),
      pages: projects.reduce((total, project) => total + project.counts.pages, 0),
      documents: projects.reduce((total, project) => total + project.counts.documents, 0),
      pageLinks: projects.reduce((total, project) => total + project.counts.pageLinks, 0),
      componentBindings: projects.reduce((total, project) => total + project.counts.componentBindings, 0),
    },
    projects,
    invalidProjects: scan.invalidProjects.map((invalid) => ({
      id: invalid.id || '',
      errors: Array.isArray(invalid.errors) ? invalid.errors : [],
    })),
  };
}
