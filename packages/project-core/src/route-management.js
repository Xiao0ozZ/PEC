import { promises as fs } from 'node:fs';
import path from 'node:path';

import { HTML_EXTENSIONS, PAGE_PATH_PATTERN, PROJECT_ID_PATTERN } from './constants.js';
import {
  importJavaScriptFile,
  isSafeRelativePath,
  resolveExistingPathInsideRoot,
  resolveWritablePathInsideRoot,
  withFileRollback,
  writeFileAtomic,
  writeJsonAtomic,
} from './filesystem.js';
import { scanHtmlPrototypePages } from './html-prototypes.js';
import { resolveProjectRoot } from './project-mounts.js';
import { normalizeRouteOrder, orderClientRouteData } from './route-order.js';

const ALLOWED_ICONS = new Set([
  'Calendar',
  'CirclePlus',
  'DataBoard',
  'Document',
  'Files',
  'House',
  'List',
  'Location',
  'Lock',
  'Management',
  'Medal',
  'Money',
  'Odometer',
  'Postcard',
  'Setting',
  'Tickets',
  'User',
  'Van',
  'Warning',
]);

const BACKUP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function escapeHtmlAttribute(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function loadProjectPackage(projectRoot, projectId, mounts = {}) {
  if (!PROJECT_ID_PATTERN.test(projectId || '')) throw new Error('项目 ID 无效。');
  const packageRoot = resolveProjectRoot(path.join(projectRoot, 'projects'), projectId, mounts);
  const manifestPath = await resolveExistingPathInsideRoot(packageRoot, 'project.json', {
    allowedExtensions: new Set(['.json']),
  });
  if (!manifestPath) throw new Error('项目配置文件不存在、越界或不是 JSON 文件。');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.id !== projectId) throw new Error('项目 ID 与项目文件夹不一致。');
  const definitionsPath = await resolveExistingPathInsideRoot(
    packageRoot,
    manifest.pageDefinitions || 'page-definitions.js',
    { allowedExtensions: new Set(['.js']) },
  );
  if (!definitionsPath) throw new Error('页面定义文件必须是项目包内的 JavaScript 文件。');
  const definitionsModule = await importJavaScriptFile(definitionsPath, {
    cacheKey: `routes-${Date.now()}`,
  });
  const definitions = definitionsModule.clientPageDefinitions || definitionsModule.default;
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
    throw new Error('页面定义文件没有导出有效的客户端定义。');
  }
  return { projectId, packageRoot, manifest, definitionsPath, definitions };
}

function cloneDefinitions(definitions, clientId, patch) {
  const current = definitions[clientId];
  if (!current) throw new Error(`客户端不存在：${clientId}。`);
  return {
    ...definitions,
    [clientId]: { ...current, ...patch },
  };
}

async function writeDefinitions(definitionsPath, definitions) {
  await writeFileAtomic(
    definitionsPath,
    `export const clientPageDefinitions = ${JSON.stringify(definitions, null, 2)};\n`,
    { encoding: 'utf8' },
  );
}

function managedHtmlRoot(projectPackage, client) {
  return path.join(projectPackage.packageRoot, 'html-pages', client);
}

async function resolveManagedHtmlPath(projectPackage, client, source, { mustExist = false } = {}) {
  const relative = String(source || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  const packageRelative = path.posix.join('html-pages', client, relative);
  const target = mustExist
    ? await resolveExistingPathInsideRoot(projectPackage.packageRoot, packageRelative, {
        allowedExtensions: HTML_EXTENSIONS,
      })
    : await resolveWritablePathInsideRoot(projectPackage.packageRoot, packageRelative, {
        allowedExtensions: HTML_EXTENSIONS,
      });
  if (!relative || !isSafeRelativePath(relative) || !target) {
    throw new Error(`HTML 页面来源路径无效：${client}/${relative || '空值'}。`);
  }
  return { root: managedHtmlRoot(projectPackage, client), relative, target };
}

async function managedHtmlPathForPage(projectPackage, page, options = {}) {
  if (page?.sourceType !== 'html-template' || !page.source) return null;
  return (await resolveManagedHtmlPath(projectPackage, page.client, page.source, options)).target;
}

function routeDefinitionPages(definition) {
  return (definition?.pages || []).filter((page) => page.sourceType !== 'html-template');
}

function normalizeHtmlFileName(value, fallback = 'page.html') {
  const rawValue = String(value || '')
    .trim()
    .replaceAll('\\', '/');
  let fileName = rawValue.split('/').filter(Boolean).at(-1) || String(fallback || 'page.html');
  fileName = fileName
    .replace(/[<>:"/|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!fileName || fileName === '.' || fileName === '..') fileName = String(fallback || 'page.html');
  fileName = Array.from(fileName, (character) => (character.charCodeAt(0) < 32 ? '-' : character)).join('');
  if (!/\.html?$/iu.test(fileName)) fileName = `${fileName}.html`;
  return fileName;
}

function backupIdFor(clientId, pagePath) {
  const slug = `${clientId}-${pagePath}`.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${Date.now()}-${slug || 'page'}-${Math.random().toString(36).slice(2, 7)}`;
}

function pageBackupRoot(projectPackage) {
  return path.join(projectPackage.packageRoot, '.backups', 'pages');
}

function sectionBackupRoot(projectPackage) {
  return path.join(projectPackage.packageRoot, '.backups', 'sections');
}

async function createPageBackup(projectPackage, metadata, sourcePath) {
  const id = backupIdFor(metadata.client, metadata.original.path);
  const relativeDirectory = path.posix.join('.backups', 'pages', id);
  const metadataPath = await resolveWritablePathInsideRoot(
    projectPackage.packageRoot,
    path.posix.join(relativeDirectory, 'metadata.json'),
    { allowedExtensions: new Set(['.json']) },
  );
  if (!metadataPath) throw new Error('页面备份路径不安全。');
  const directory = path.dirname(metadataPath);
  try {
    await fs.mkdir(directory, { recursive: true });
    if (sourcePath && (await fs.stat(sourcePath).catch(() => null))?.isFile()) {
      const backupPath = await resolveWritablePathInsideRoot(
        projectPackage.packageRoot,
        path.posix.join(relativeDirectory, 'page.html'),
        { allowedExtensions: HTML_EXTENSIONS },
      );
      if (!backupPath) throw new Error('页面备份文件路径不安全。');
      await fs.copyFile(sourcePath, backupPath);
    }
    await writeJsonAtomic(metadataPath, { ...metadata, id, sourceKind: 'html' });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return { id, directory };
}

async function listPageBackups(projectPackage) {
  const entries = await fs.readdir(pageBackupRoot(projectPackage), { withFileTypes: true }).catch(() => []);
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !BACKUP_ID_PATTERN.test(entry.name)) continue;
    const metadataPath = path.join(pageBackupRoot(projectPackage), entry.name, 'metadata.json');
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      if (metadata.sourceKind !== 'html' && metadata.original?.sourceType !== 'html-template') continue;
      backups.push(metadata);
    } catch {
      // 忽略未完成的备份目录。
    }
  }
  return backups.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

async function listSectionBackups(projectPackage) {
  const root = sectionBackupRoot(projectPackage);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !BACKUP_ID_PATTERN.test(entry.name)) continue;
    const metadataPath = path.join(root, entry.name, 'metadata.json');
    try {
      backups.push(JSON.parse(await fs.readFile(metadataPath, 'utf8')));
    } catch {
      // 忽略未完成的备份目录。
    }
  }
  return backups.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

async function createSectionBackup(projectPackage, metadata) {
  const id = backupIdFor(metadata.client, `section-${metadata.sectionIds.join('-')}`);
  const metadataPath = await resolveWritablePathInsideRoot(
    projectPackage.packageRoot,
    path.posix.join('.backups', 'sections', id, 'metadata.json'),
    { allowedExtensions: new Set(['.json']) },
  );
  if (!metadataPath) throw new Error('分组备份路径不安全。');
  const directory = path.dirname(metadataPath);
  try {
    await fs.mkdir(directory, { recursive: true });
    await writeJsonAtomic(metadataPath, { ...metadata, id });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return { id, directory };
}

function buildPlaceholderHtml({ client, title, routePath, section, icon }) {
  const safeTitle = escapeHtmlAttribute(title);
  const manifest = JSON.stringify(
    {
      templateVersion: 1,
      pageKey: `${client}-${routePath}`,
      client,
      routePath: `/${client}/${routePath}`,
      pageTitle: title,
      menuTitle: title,
      menuSection: section,
      menuIcon: icon,
      menu: true,
      pageType: 'custom',
      pageHeaderMode: 'standard',
    },
    null,
    2,
  ).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="prototype-title" content="${safeTitle}" />
    <meta name="prototype-path" content="${escapeHtmlAttribute(routePath)}" />
    <meta name="prototype-section" content="${escapeHtmlAttribute(section)}" />
    <meta name="prototype-icon" content="${escapeHtmlAttribute(icon)}" />
    <title>${safeTitle}</title>
    <style data-page-style>
      :root {
        color: #1f2329;
        background: var(--app-color-page, #f5f7fb);
        font-family: "PingFang SC", "SF Pro Display", "SF Pro Text", -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--app-color-page, #f5f7fb); }
      .prototype-app { min-height: 100vh; }
      .prototype-main { padding: 24px 28px 32px; }
      .placeholder-header h1 { margin: 0; font-size: 24px; line-height: 1.35; }
      .placeholder-header p { margin: 8px 0 0; color: #86909c; font-size: 14px; }
      .placeholder-panel {
        margin-top: 20px;
        padding: 56px 24px;
        border: 1px solid #e5e6eb;
        border-radius: 12px;
        background: #fff;
        color: #86909c;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="prototype-app">
      <main class="prototype-main" data-page-content data-business-content>
        <!-- [AI-EDIT] PAGE_CONTENT_START -->
        <header class="placeholder-header">
          <h1>${safeTitle}</h1>
          <p>页面路由已建立，可直接在项目包 html-pages 目录中维护正式内容。</p>
        </header>
        <section class="placeholder-panel">页面内容待补充</section>
        <!-- PAGE_CONTENT_END -->
      </main>
      <!-- [AI-EDIT] PAGE_OVERLAYS_START -->
      <div data-page-overlay="placeholder" hidden></div>
      <!-- PAGE_OVERLAYS_END -->
    </div>
    <script id="prototype-page-manifest" type="application/json">${manifest}</script>
    <script>
      /* [AI-EDIT] PAGE_LOGIC_START */
      function pageSetup() { return {}; }
      /* PAGE_LOGIC_END */
    </script>
  </body>
</html>
`;
}

function routeOrderConfigPath(projectPackage) {
  return path.join(projectPackage.packageRoot, '.platform', 'route-order.json');
}

async function readRouteOrderConfig(projectPackage) {
  const configuredPath = routeOrderConfigPath(projectPackage);
  try {
    const configPath = await resolveExistingPathInsideRoot(
      projectPackage.packageRoot,
      '.platform/route-order.json',
      { allowedExtensions: new Set(['.json']) },
    );
    if (!configPath) {
      if (!(await fs.stat(configuredPath).catch(() => null))) return {};
      throw new Error('路由顺序配置路径越界或类型无效。');
    }
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`路由顺序配置读取失败：${error.message}`);
  }
}

async function writeRouteOrderConfig(projectPackage, clientId, clientConfig) {
  const current = await readRouteOrderConfig(projectPackage);
  const configPath = await resolveWritablePathInsideRoot(
    projectPackage.packageRoot,
    '.platform/route-order.json',
    { allowedExtensions: new Set(['.json']) },
  );
  if (!configPath) throw new Error('路由顺序配置写入路径不安全。');
  const config = {
    ...current,
    schemaVersion: 1,
    clients: { ...(current.clients || {}), [clientId]: clientConfig },
  };
  await writeJsonAtomic(configPath, config);
  return config;
}

async function htmlPagesForProject(projectRoot, projectId, mounts = {}) {
  const state = await scanHtmlPrototypePages(path.join(projectRoot, 'projects'), { mounts });
  return state.projects[projectId] || {};
}

function clientRouteData(projectPackage, htmlPages, clientId, routeOrder) {
  const definition = projectPackage.definitions[clientId];
  const pages = [...routeDefinitionPages(definition), ...(htmlPages[clientId] || [])];
  return orderClientRouteData(definition?.sections || [], pages, routeOrder?.clients?.[clientId]);
}

export async function listProjectRoutes({ projectRoot, projectId, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, projectId, mounts);
  const htmlPages = await htmlPagesForProject(projectRoot, projectId, mounts);
  const routeOrder = await readRouteOrderConfig(projectPackage);
  return {
    project: {
      id: projectPackage.projectId,
      name: projectPackage.manifest.name,
      version: projectPackage.manifest.version || '',
    },
    clients: (projectPackage.manifest.clients || [])
      .filter((client) => projectPackage.definitions[client.id])
      .map((client) => {
        const ordered = clientRouteData(projectPackage, htmlPages, client.id, routeOrder);
        return {
          id: client.id,
          name: client.name,
          basePath: projectPackage.definitions[client.id].basePath || `/${client.id}`,
          sections: ordered.sections,
          pages: ordered.pages,
        };
      }),
    backups: await listPageBackups(projectPackage),
    sectionBackups: await listSectionBackups(projectPackage),
  };
}

function normalizeSections(sections) {
  const updates = Array.isArray(sections)
    ? sections.map((section) => ({
        id: String(section?.id || '').trim(),
        title: String(section?.title || '').trim(),
      }))
    : [];
  if (updates.some((section) => !section.id || !section.title)) {
    throw new Error('菜单分组 ID 和名称不能为空。');
  }
  if (updates.some((section) => !/^[a-z][a-z0-9-]*$/.test(section.id))) {
    throw new Error('菜单分组 ID 必须使用小写英文字母、数字和连字符，并以字母开头。');
  }
  if (new Set(updates.map((section) => section.id)).size !== updates.length) {
    throw new Error('菜单分组 ID 不能重复。');
  }
  if (new Set(updates.map((section) => section.title)).size !== updates.length) {
    throw new Error('菜单分组名称不能重复。');
  }
  return updates;
}

export async function updateProjectSections({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  const client = String(target.client || '').trim();
  const clientDefinition = projectPackage.definitions[client];
  if (!clientDefinition) throw new Error(`项目 ${target.projectId} 不存在客户端：${client}。`);
  const htmlPages = await htmlPagesForProject(projectRoot, target.projectId, mounts);
  const allPages = [...routeDefinitionPages(clientDefinition), ...(htmlPages[client] || [])];
  const updates = normalizeSections(target.sections);
  const originalSections = (clientDefinition.sections || []).map((section) => ({
    id: section.id,
    title: section.title,
  }));
  const updateIds = new Set(updates.map((section) => section.id));
  const removedSections = originalSections.filter((section) => !updateIds.has(section.id));
  const usedRemovedSection = allPages.find((page) =>
    removedSections.some((section) => section.id === page.section),
  );
  if (usedRemovedSection) {
    throw new Error(`分组“${usedRemovedSection.section}”仍有页面使用，请先调整页面所属分组后再删除。`);
  }
  const sectionsChanged =
    updates.length !== originalSections.length ||
    updates.some((section, index) => {
      const original = originalSections[index];
      return !original || section.id !== original.id || section.title !== original.title;
    });
  if (!sectionsChanged) throw new Error('菜单分组没有发生变化。');

  const routeOrder = await readRouteOrderConfig(projectPackage);
  const normalizedOrder = normalizeRouteOrder({
    sections: updates,
    pages: allPages,
    sectionOrder: updates.map((section) => section.id),
    pageOrder: routeOrder.clients?.[client]?.pageOrder,
  });
  const updatedDefinitions = cloneDefinitions(projectPackage.definitions, client, { sections: updates });
  const backup = await createSectionBackup(projectPackage, {
    schemaVersion: 1,
    type: 'edited',
    createdAt: new Date().toISOString(),
    projectId: projectPackage.projectId,
    client,
    sectionIds: originalSections.map((section) => section.id),
    original: originalSections,
    replacement: updates,
  });
  await withFileRollback([projectPackage.definitionsPath, routeOrderConfigPath(projectPackage)], async () => {
    await writeDefinitions(projectPackage.definitionsPath, updatedDefinitions);
    await writeRouteOrderConfig(projectPackage, client, normalizedOrder);
  });
  return { backupId: backup.id, sections: updates, order: normalizedOrder, requiresReload: true };
}

export async function updateProjectRouteOrder({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  const client = String(target.client || '').trim();
  const clientDefinition = projectPackage.definitions[client];
  if (!clientDefinition) throw new Error(`项目 ${target.projectId} 不存在客户端：${client}。`);
  const htmlPages = await htmlPagesForProject(projectRoot, target.projectId, mounts);
  const pages = [...routeDefinitionPages(clientDefinition), ...(htmlPages[client] || [])];
  const currentConfig = await readRouteOrderConfig(projectPackage);
  const currentClientOrder = currentConfig.clients?.[client] || {};
  const normalizedOrder = normalizeRouteOrder({
    sections: clientDefinition.sections || [],
    pages,
    sectionOrder: target.sectionOrder || currentClientOrder.sectionOrder,
    pageOrder: target.pageOrder || currentClientOrder.pageOrder,
  });
  await writeRouteOrderConfig(projectPackage, client, normalizedOrder);
  return { client, order: normalizedOrder, requiresReload: true };
}

export async function restoreProjectSections({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  if (!BACKUP_ID_PATTERN.test(String(target.backupId || ''))) throw new Error('备份 ID 无效。');
  const metadataPath = await resolveExistingPathInsideRoot(
    projectPackage.packageRoot,
    path.posix.join('.backups', 'sections', target.backupId, 'metadata.json'),
    { allowedExtensions: new Set(['.json']) },
  );
  if (!metadataPath) throw new Error('分组备份不存在或路径不安全。');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (metadata.restoredAt) throw new Error('该分组备份已经还原。');
  const clientDefinition = projectPackage.definitions[metadata.client];
  if (!clientDefinition) throw new Error(`客户端不存在：${metadata.client}。`);
  const currentSections = (clientDefinition.sections || []).map((section) => ({
    id: section.id,
    title: section.title,
  }));
  const currentMap = new Map(currentSections.map((section) => [section.id, section.title]));
  if ((metadata.replacement || []).some((section) => currentMap.get(section.id) !== section.title)) {
    throw new Error('当前菜单分组已经发生其他变化，请先重新读取后再试。');
  }
  const original = normalizeSections(metadata.original);
  const updatedDefinitions = cloneDefinitions(projectPackage.definitions, metadata.client, {
    sections: original,
  });
  const routeOrder = await readRouteOrderConfig(projectPackage);
  const restoredOrder = {
    ...(routeOrder.clients?.[metadata.client] || {}),
    sectionOrder: original.map((section) => section.id),
  };
  await withFileRollback(
    [projectPackage.definitionsPath, routeOrderConfigPath(projectPackage), metadataPath],
    async () => {
      await writeDefinitions(projectPackage.definitionsPath, updatedDefinitions);
      await writeRouteOrderConfig(projectPackage, metadata.client, restoredOrder);
      metadata.restoredAt = new Date().toISOString();
      await writeJsonAtomic(metadataPath, metadata);
    },
  );
  return { sections: original, order: restoredOrder, requiresReload: true };
}

function normalizeRoutePath(value) {
  return String(value || '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function assertRouteForm(clientDefinition, routePath, pageTitle, section, icon) {
  if (!PAGE_PATH_PATTERN.test(routePath)) throw new Error('路由片段必须使用 kebab-case。');
  if (!pageTitle) throw new Error('页面名称不能为空。');
  if (!(clientDefinition.sections || []).some((item) => item.id === section)) {
    throw new Error(`菜单分组不存在：${section}。`);
  }
  if (!ALLOWED_ICONS.has(icon)) throw new Error(`不支持的菜单图标：${icon}。`);
}

function htmlTemplatePage({ client, routePath, pageTitle, section, icon, source }) {
  return {
    path: routePath,
    name: `${client}-${routePath}`,
    title: pageTitle,
    sourceType: 'html-template',
    source,
    section,
    icon,
    prototype: {
      fileName: source,
      templateVersion: 1,
      pageKey: `${client}-${routePath}`,
      pageTitle,
      pageType: 'custom',
      pageHeaderMode: 'standard',
    },
  };
}

export async function createProjectRoute({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  const client = String(target.client || '').trim();
  const clientDefinition = projectPackage.definitions[client];
  if (!clientDefinition) throw new Error(`项目 ${target.projectId} 不存在客户端：${client}。`);
  const routePath = normalizeRoutePath(target.routePath);
  const pageTitle = String(target.pageTitle || target.menuTitle || '').trim();
  const section = String(target.menuSection || '').trim();
  const icon = String(target.menuIcon || 'Document').trim();
  assertRouteForm(clientDefinition, routePath, pageTitle, section, icon);
  const htmlPages = await htmlPagesForProject(projectRoot, target.projectId, mounts);
  const existingPages = [...routeDefinitionPages(clientDefinition), ...(htmlPages[client] || [])];
  if (existingPages.some((page) => page.path === routePath)) throw new Error(`路由已存在：${routePath}。`);

  const fileName = normalizeHtmlFileName(target.fileName || pageTitle, `${routePath}.html`);
  const managedSource = await resolveManagedHtmlPath(projectPackage, client, fileName);
  if (await fs.stat(managedSource.target).catch(() => null)) {
    throw new Error(`页面文件已存在：${fileName}。`);
  }
  const page = htmlTemplatePage({ client, routePath, pageTitle, section, icon, source: fileName });
  const updatedDefinitions = cloneDefinitions(projectPackage.definitions, client, {
    pages: [page, ...(clientDefinition.pages || [])],
  });
  await withFileRollback([managedSource.target, projectPackage.definitionsPath], async () => {
    await fs.mkdir(path.dirname(managedSource.target), { recursive: true });
    await writeFileAtomic(
      managedSource.target,
      buildPlaceholderHtml({ client, title: pageTitle, routePath, section, icon }),
      { encoding: 'utf8' },
    );
    await writeDefinitions(projectPackage.definitionsPath, updatedDefinitions);
  });
  return { page, routePath: `/p/${projectPackage.projectId}/${client}/${routePath}`, requiresReload: true };
}

export async function updateProjectRoute({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  const client = String(target.client || '').trim();
  const clientDefinition = projectPackage.definitions[client];
  const originalPath = normalizeRoutePath(target.originalPath);
  const originalPage = clientDefinition?.pages?.find((item) => item.path === originalPath);
  if (!clientDefinition || !originalPage) throw new Error(`找不到要编辑的路由：${client}/${originalPath}。`);
  if (originalPage.sourceType !== 'html-template') {
    throw new Error('外部 HTML 页面只能在其原型目录中维护。');
  }
  const routePath = normalizeRoutePath(target.routePath);
  const pageTitle = String(target.pageTitle || target.menuTitle || '').trim();
  const section = String(target.menuSection || '').trim();
  const icon = String(target.menuIcon || originalPage.icon || 'Document').trim();
  assertRouteForm(clientDefinition, routePath, pageTitle, section, icon);
  const htmlPages = await htmlPagesForProject(projectRoot, target.projectId, mounts);
  const duplicate = [...routeDefinitionPages(clientDefinition), ...(htmlPages[client] || [])].find(
    (page) => page.path === routePath && page.path !== originalPath,
  );
  if (duplicate) throw new Error(`路由已存在：${routePath}。`);
  const manifestClient = projectPackage.manifest.clients?.find((item) => item.id === client);
  if (manifestClient?.defaultPage === originalPath && routePath !== originalPath) {
    throw new Error('默认页面不允许在编辑时更换路由片段，请先在项目配置中调整默认页面。');
  }

  const routeChanged = routePath !== originalPath;
  const fileName = normalizeHtmlFileName(
    target.fileName || (routeChanged ? `${routePath}.html` : originalPage.source),
    `${routePath}.html`,
  );
  const originalHtmlPath = await managedHtmlPathForPage(
    projectPackage,
    { ...originalPage, client },
    { mustExist: true },
  );
  const targetHtmlPath = await resolveManagedHtmlPath(projectPackage, client, fileName);
  if (
    routeChanged &&
    targetHtmlPath.target !== originalHtmlPath &&
    (await fs.stat(targetHtmlPath.target).catch(() => null))
  ) {
    throw new Error(`页面文件已存在：${fileName}。`);
  }
  const pageWithoutPrototype = { ...originalPage };
  delete pageWithoutPrototype.prototype;
  const updatedPage = {
    ...pageWithoutPrototype,
    path: routePath,
    name: routeChanged ? `${client}-${routePath}` : originalPage.name,
    title: pageTitle,
    sourceType: 'html-template',
    source: fileName,
    section,
    icon,
    prototype: {
      ...(originalPage.prototype || {}),
      fileName,
      pageKey: `${client}-${routePath}`,
      pageTitle,
    },
  };
  const updatedPages = (clientDefinition.pages || []).map((page) =>
    page.path === originalPath ? updatedPage : page,
  );
  const updatedDefinitions = cloneDefinitions(projectPackage.definitions, client, { pages: updatedPages });
  const backup = await createPageBackup(
    projectPackage,
    {
      schemaVersion: 1,
      type: 'edited',
      createdAt: new Date().toISOString(),
      projectId: projectPackage.projectId,
      client,
      original: originalPage,
      replacement: updatedPage,
    },
    originalHtmlPath,
  );
  await withFileRollback(
    [projectPackage.definitionsPath, targetHtmlPath.target, originalHtmlPath],
    async () => {
      if (routeChanged && targetHtmlPath.target !== originalHtmlPath) {
        await fs.mkdir(path.dirname(targetHtmlPath.target), { recursive: true });
        await fs.copyFile(originalHtmlPath, targetHtmlPath.target);
        await fs.rm(originalHtmlPath, { force: true });
      }
      await writeDefinitions(projectPackage.definitionsPath, updatedDefinitions);
    },
  );
  return {
    page: updatedPage,
    backupId: backup.id,
    routePath: `/p/${projectPackage.projectId}/${client}/${routePath}`,
    requiresReload: true,
  };
}

export async function deleteProjectRoute({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  const client = String(target.client || '').trim();
  const clientDefinition = projectPackage.definitions[client];
  const pagePath = normalizeRoutePath(target.pagePath);
  const page = clientDefinition?.pages?.find((item) => item.path === pagePath);
  if (!clientDefinition || !page) throw new Error(`找不到要删除的路由：${client}/${pagePath}。`);
  if (page.sourceType !== 'html-template')
    throw new Error('外部 HTML 页面由原型目录管理，不能从路由定义中删除。');
  const manifestClient = projectPackage.manifest.clients?.find((item) => item.id === client);
  if (manifestClient?.defaultPage === page.path) {
    throw new Error('当前页面是客户端默认页面，请先在项目配置中更换默认页面。');
  }
  const sourcePath = await managedHtmlPathForPage(projectPackage, { ...page, client }, { mustExist: true });
  const updatedDefinitions = cloneDefinitions(projectPackage.definitions, client, {
    pages: clientDefinition.pages.filter((item) => item.path !== page.path),
  });
  const backup = await createPageBackup(
    projectPackage,
    {
      schemaVersion: 1,
      type: 'deleted',
      createdAt: new Date().toISOString(),
      projectId: target.projectId,
      client,
      original: page,
    },
    sourcePath,
  );
  await withFileRollback([projectPackage.definitionsPath, sourcePath], async () => {
    await writeDefinitions(projectPackage.definitionsPath, updatedDefinitions);
    await fs.rm(sourcePath, { force: true });
  });
  return {
    backupId: backup.id,
    routePath: `/p/${target.projectId}/${client}/${page.path}`,
    requiresReload: true,
  };
}

export async function restoreProjectRoute({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  if (!BACKUP_ID_PATTERN.test(String(target.backupId || ''))) throw new Error('备份 ID 无效。');
  const metadataPath = await resolveExistingPathInsideRoot(
    projectPackage.packageRoot,
    path.posix.join('.backups', 'pages', target.backupId, 'metadata.json'),
    { allowedExtensions: new Set(['.json']) },
  );
  if (!metadataPath) throw new Error('页面备份不存在或路径不安全。');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (metadata.restoredAt) throw new Error('该备份已经还原。');
  const original = metadata.original;
  if (!original || original.sourceType !== 'html-template' || !original.source) {
    throw new Error('该备份不是可还原的 HTML 页面。');
  }
  const clientId = String(metadata.client || '').trim();
  const clientDefinition = projectPackage.definitions[clientId];
  if (!clientDefinition) throw new Error(`客户端不存在：${clientId}。`);
  const replacement = metadata.replacement || null;
  if (
    clientDefinition.pages.some(
      (page) => page.path === original.path && (!replacement || page.path !== replacement.path),
    )
  ) {
    throw new Error(`原路由已存在：${clientId}/${original.path}。`);
  }
  if (replacement) {
    const activeReplacement = clientDefinition.pages.find((page) => page.path === replacement.path);
    if (!activeReplacement || activeReplacement.sourceType !== 'html-template') {
      throw new Error('找不到被替换后的当前 HTML 页面，无法自动恢复。');
    }
  }
  const backupSourcePath = await resolveExistingPathInsideRoot(
    projectPackage.packageRoot,
    path.posix.join('.backups', 'pages', target.backupId, 'page.html'),
    { allowedExtensions: HTML_EXTENSIONS },
  );
  if (!backupSourcePath) throw new Error('备份文件缺失或路径不安全，无法还原。');
  let updatedDefinitions = projectPackage.definitions;
  if (replacement) {
    updatedDefinitions = cloneDefinitions(updatedDefinitions, clientId, {
      pages: clientDefinition.pages.filter((page) => page.path !== replacement.path),
    });
  }
  updatedDefinitions = cloneDefinitions(updatedDefinitions, clientId, {
    pages: [original, ...(updatedDefinitions[clientId].pages || [])],
  });
  const restoredSourcePath = await managedHtmlPathForPage(projectPackage, { ...original, client: clientId });
  const replacementHtmlPath =
    replacement?.sourceType === 'html-template'
      ? await managedHtmlPathForPage(
          projectPackage,
          { ...replacement, client: clientId },
          { mustExist: true },
        )
      : null;
  const rollbackPaths = [
    projectPackage.definitionsPath,
    restoredSourcePath,
    replacementHtmlPath,
    metadataPath,
  ];
  await withFileRollback(rollbackPaths, async () => {
    await fs.mkdir(path.dirname(restoredSourcePath), { recursive: true });
    await fs.copyFile(backupSourcePath, restoredSourcePath);
    await writeDefinitions(projectPackage.definitionsPath, updatedDefinitions);
    if (replacementHtmlPath && replacementHtmlPath !== restoredSourcePath) {
      await fs.rm(replacementHtmlPath, { force: true });
    }
    metadata.restoredAt = new Date().toISOString();
    await writeJsonAtomic(metadataPath, metadata);
  });
  return { routePath: `/p/${target.projectId}/${clientId}/${original.path}`, requiresReload: true };
}
