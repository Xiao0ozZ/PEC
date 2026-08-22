import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createDocumentManifest } from './documents.js';
import { inspectHtmlPrototype } from './html-preflight.js';
import { scanHtmlPrototypePages } from './html-prototypes.js';
import { importJavaScriptFile, readJsonFile, walkFiles } from './filesystem.js';
import { describeProjectMounts, resolveProjectDocsRoot, resolveProjectRoot } from './project-mounts.js';
import { scanProjectPackages } from './project-scanner.js';

function issue(category, severity, code, object, message, suggestion) {
  return { category, severity, code, object, message, suggestion };
}

function categoryForScanError(message) {
  if (/schemaVersion/iu.test(message)) return 'schema';
  if (/HTML|原型/iu.test(message)) return 'html';
  if (/文档|PRD/iu.test(message)) return 'documents';
  if (/页面|路由|菜单|客户端/iu.test(message)) return 'routes';
  if (/Logo|图标|背景|资源/iu.test(message)) return 'resources';
  return 'manifest';
}

async function readDefinitions(projectRoot, manifest) {
  const definitionsPath = path.join(projectRoot, manifest.pageDefinitions || 'page-definitions.js');
  const module = await importJavaScriptFile(definitionsPath, {
    cacheKey: `health-${Date.now()}-${Math.random()}`,
  });
  return module.clientPageDefinitions || module.default || {};
}

async function inspectProject(projectsRoot, project, mounts, htmlCatalog) {
  const projectRoot = resolveProjectRoot(projectsRoot, project.id, mounts);
  const manifest = await readJsonFile(path.join(projectRoot, 'project.json'));
  const definitions = await readDefinitions(projectRoot, manifest);
  const issues = [];
  const htmlResults = [];
  const roots = htmlCatalog.roots[project.id] || [];

  for (const source of roots) {
    for (const filePath of await walkFiles(source.root, { extensions: new Set(['.html', '.htm']) })) {
      const result = inspectHtmlPrototype(await fs.readFile(filePath, 'utf8'), {
        fileName: path.relative(source.root, filePath).split(path.sep).join('/'),
      });
      htmlResults.push(result);
      for (const item of result.errors) {
        issues.push(
          issue(
            'html',
            'error',
            item.code,
            result.fileName,
            item.message,
            '按 HTML 模板协议修复后重新扫描。',
          ),
        );
      }
      for (const item of result.warnings) {
        issues.push(
          issue(
            'html',
            'warning',
            item.code,
            result.fileName,
            item.message,
            '确认页面交互、主题和回导兼容性。',
          ),
        );
      }
    }
  }

  let documentCount = 0;
  const documentPaths = new Set();
  if (manifest.docs?.enabled) {
    const docsRoot = resolveProjectDocsRoot(manifest, projectRoot, mounts);
    const documentManifest = await createDocumentManifest(docsRoot);
    documentCount = documentManifest.documents.length;
    for (const document of documentManifest.documents) documentPaths.add(document.path);
    if (!documentCount) {
      issues.push(
        issue(
          'documents',
          'warning',
          'DOCS_EMPTY',
          'docs',
          '文档目录中没有 Markdown 文档。',
          '添加 PRD，或在项目配置中关闭文档入口。',
        ),
      );
    }
  }

  const platformRoot = path.join(projectRoot, '.platform');
  let pageLinks = { links: {} };
  let bindings = { bindings: [] };
  try {
    pageLinks = await readJsonFile(path.join(platformRoot, 'page-prd-links.json'), { fallback: pageLinks });
  } catch (error) {
    issues.push(
      issue(
        'associations',
        'error',
        'PAGE_PRD_LINKS_INVALID',
        '.platform/page-prd-links.json',
        error.message,
        '修复 JSON 语法后重新扫描。',
      ),
    );
  }
  try {
    bindings = await readJsonFile(path.join(platformRoot, 'prd-bindings.json'), { fallback: bindings });
  } catch (error) {
    issues.push(
      issue(
        'associations',
        'error',
        'PRD_BINDINGS_INVALID',
        '.platform/prd-bindings.json',
        error.message,
        '修复 JSON 语法后重新扫描。',
      ),
    );
  }
  let pageLinkCount = 0;
  for (const [clientId, links] of Object.entries(pageLinks.links || {})) {
    for (const [pageName, documentPath] of Object.entries(links || {})) {
      if (!documentPath) continue;
      pageLinkCount += 1;
      if (!documentPaths.has(documentPath)) {
        issues.push(
          issue(
            'associations',
            'error',
            'PRD_LINK_MISSING',
            `${clientId}/${pageName}`,
            `关联文档不存在：${documentPath}`,
            '选择现有 PRD，或取消失效关联。',
          ),
        );
      }
    }
  }
  for (const binding of bindings.bindings || []) {
    if (binding?.prd?.document && !documentPaths.has(binding.prd.document)) {
      issues.push(
        issue(
          'associations',
          'error',
          'PRD_BINDING_MISSING',
          binding.id || binding.pagePath,
          `组件关联文档不存在：${binding.prd.document}`,
          '更新关联目标，或恢复对应 PRD。',
        ),
      );
    }
  }

  const routeCount = (manifest.clients || []).reduce(
    (sum, client) =>
      sum +
      (Array.isArray(definitions[client.id]?.pages) ? definitions[client.id].pages.length : 0),
    0,
  );
  const directHtmlCount = Object.values(htmlCatalog.projects[project.id] || {}).reduce(
    (sum, pages) => sum + pages.length,
    0,
  );
  return {
    project: { id: project.id, name: project.name, mounted: Boolean(project.mounted) },
    mounts: describeProjectMounts(manifest, projectRoot, mounts),
    summary: {
      status: issues.some((item) => item.severity === 'error')
        ? 'error'
        : issues.length
          ? 'warning'
          : 'healthy',
      errors: issues.filter((item) => item.severity === 'error').length,
      warnings: issues.filter((item) => item.severity === 'warning').length,
      clients: manifest.clients?.length || 0,
      routes: routeCount + directHtmlCount,
      htmlFiles: htmlResults.length,
      documents: documentCount,
      pageLinks: pageLinkCount,
      componentBindings: bindings.bindings?.length || 0,
      schemaVersion: manifest.schemaVersion,
    },
    issues,
  };
}

export async function createProjectHealthReport(projectsRoot, { mounts = {} } = {}) {
  const root = path.resolve(projectsRoot);
  const [scan, htmlCatalog] = await Promise.all([
    scanProjectPackages(root, { mounts }),
    scanHtmlPrototypePages(root, { mounts }),
  ]);
  const projects = [];
  for (const project of scan.projects)
    projects.push(await inspectProject(root, project, mounts, htmlCatalog));
  for (const invalid of scan.invalidProjects) {
    projects.push({
      project: {
        id: invalid.project?.id || invalid.folder,
        name: invalid.project?.name || invalid.folder,
        mounted: Boolean(invalid.mounted),
      },
      mounts: null,
      summary: {
        status: 'error',
        errors: invalid.errors.length,
        warnings: 0,
        clients: invalid.project?.clients?.length || 0,
        routes: 0,
        htmlFiles: 0,
        documents: 0,
        pageLinks: 0,
        componentBindings: 0,
        schemaVersion: invalid.project?.schemaVersion ?? null,
      },
      issues: invalid.errors.map((message, index) =>
        issue(
          categoryForScanError(message),
          'error',
          `PROJECT_SCAN_${index + 1}`,
          invalid.folder,
          message,
          '根据具体错误修复项目配置或缺失文件后重新扫描。',
        ),
      ),
    });
  }
  projects.sort((left, right) => left.project.id.localeCompare(right.project.id));
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      projects: projects.length,
      healthy: projects.filter((item) => item.summary.status === 'healthy').length,
      errors: projects.reduce((sum, item) => sum + item.summary.errors, 0),
      warnings: projects.reduce((sum, item) => sum + item.summary.warnings, 0),
    },
    projects,
  };
}
