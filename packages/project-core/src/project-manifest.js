import path from 'node:path';

import {
  CLIENT_ENTRY_MODES,
  CLIENT_LAYOUT_TYPES,
  CURRENT_PROJECT_SCHEMA_VERSION,
  ENTRY_KINDS,
  HTML_EXTENSIONS,
  HTML_SHELL_MODES,
  PROJECT_ID_PATTERN,
} from './constants.js';
import {
  fileExists,
  isInsideRoot,
  isSafeRelativePath,
  resolveExistingPathInsideRoot,
  walkFiles,
} from './filesystem.js';

export function normalizePrototypeSources(prototype = {}) {
  const configuredClients = prototype?.clients;
  const entries = Array.isArray(configuredClients)
    ? configuredClients.map((item) => [item?.clientId || item?.id, item])
    : configuredClients && typeof configuredClients === 'object'
      ? Object.entries(configuredClients)
      : [];

  if (entries.length) {
    return entries
      .map(([clientId, item]) => ({
        clientId: String(item?.clientId || clientId || '').trim(),
        root: String(item?.root || '').trim(),
        section: String(item?.section || '').trim(),
        icon: String(item?.icon || '').trim(),
        shellMode: item?.shellMode === 'full' ? 'full' : 'auto',
        enabled: item?.enabled !== false,
      }))
      .filter((item) => item.enabled && item.root);
  }

  if (!prototype?.enabled || !prototype?.root) return [];
  return [
    {
      clientId: String(prototype.client || '').trim(),
      root: String(prototype.root).trim(),
      section: String(prototype.section || '').trim(),
      icon: String(prototype.icon || '').trim(),
      shellMode: prototype.shellMode === 'full' ? 'full' : 'auto',
      enabled: true,
    },
  ];
}

export function resolveProjectContentRoot(projectRoot, configuredRoot, fallback) {
  return path.resolve(projectRoot, String(configuredRoot || fallback || '').trim());
}

export function prototypeRootsForClient(manifest, projectRoot, clientId, mounts = {}) {
  const mountedRoots = mounts.projects?.[manifest.id]?.prototypes || {};
  return normalizePrototypeSources(manifest.prototype)
    .filter((source) => !source.clientId || source.clientId === clientId)
    .map((source) => mountedRoots[source.clientId] || resolveProjectContentRoot(projectRoot, source.root));
}

export function validateProjectManifest(manifest, folderName, projectRoot) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['project.json 根节点必须是对象。'];
  }
  if (manifest.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${CURRENT_PROJECT_SCHEMA_VERSION}。`);
  }
  if (!PROJECT_ID_PATTERN.test(manifest.id || '')) errors.push('id 必须使用小写 kebab-case。');
  if (manifest.id && manifest.id !== folderName) errors.push('项目 id 必须与项目文件夹名称一致。');
  if (!String(manifest.name || '').trim()) errors.push('缺少项目名称。');
  if (!Array.isArray(manifest.clients)) errors.push('clients 必须是数组。');
  if (!Array.isArray(manifest.entries)) errors.push('entries 必须是数组。');

  for (const [name, value] of Object.entries(manifest.theme || {})) {
    if (value && !/^#[a-f\d]{6}$/iu.test(value)) {
      errors.push(`主题颜色 ${name} 必须使用六位十六进制色值。`);
    }
  }
  const clientIds = new Set();
  for (const client of manifest.clients || []) {
    if (!PROJECT_ID_PATTERN.test(client.id || '')) errors.push(`客户端 id 无效：${client.id || '空值'}。`);
    if (clientIds.has(client.id)) errors.push(`客户端 id 重复：${client.id}。`);
    clientIds.add(client.id);
    if (!String(client.name || '').trim()) errors.push(`客户端 ${client.id || '未知'} 缺少名称。`);
    if (client.entry?.mode && !CLIENT_ENTRY_MODES.has(client.entry.mode)) {
      errors.push(`客户端 ${client.id || '未知'} 的进入方式无效：${client.entry.mode}。`);
    }
    if (client.entry?.mode === 'custom-page' && !String(client.entry.page || '').trim()) {
      errors.push(`客户端 ${client.id || '未知'} 使用自定义入口时必须指定入口页面。`);
    }
    if (client.layout?.type && !CLIENT_LAYOUT_TYPES.has(client.layout.type)) {
      errors.push(`客户端 ${client.id || '未知'} 的页面外壳无效：${client.layout.type}。`);
    }
    if (client.login?.background && !isSafeRelativePath(client.login.background)) {
      errors.push(`客户端 ${client.id || '未知'} 的登录背景路径无效。`);
    }
  }

  const entryIds = new Set();
  for (const entry of manifest.entries || []) {
    if (!PROJECT_ID_PATTERN.test(entry.id || '')) errors.push(`入口 id 无效：${entry.id || '空值'}。`);
    if (entryIds.has(entry.id)) errors.push(`入口 id 重复：${entry.id}。`);
    entryIds.add(entry.id);
    if (!ENTRY_KINDS.has(entry.kind)) errors.push(`入口 ${entry.id || '未知'} 的 kind 无效。`);
    if (entry.kind === 'client' && !clientIds.has(entry.clientId)) {
      errors.push(`入口 ${entry.id} 引用了不存在的客户端：${entry.clientId}。`);
    }
    if (entry.kind === 'docs' && !manifest.docs?.enabled) {
      errors.push(`入口 ${entry.id} 已配置，但文档能力未启用。`);
    }
    if (entry.kind === 'mobile' && !manifest.mobile?.enabled) {
      errors.push(`入口 ${entry.id} 已配置，但移动端能力未启用。`);
    }
  }

  if (!isSafeRelativePath(manifest.pageDefinitions)) {
    errors.push('pageDefinitions 必须是项目包内的相对路径。');
  } else if (!isInsideRoot(projectRoot, path.resolve(projectRoot, manifest.pageDefinitions))) {
    errors.push('pageDefinitions 超出项目包目录。');
  }
  if (manifest.pageDefinitions !== 'page-definitions.js') {
    errors.push('pageDefinitions 当前必须固定为 page-definitions.js。');
  }

  for (const resourcePath of [
    manifest.branding?.logo,
    manifest.branding?.favicon,
    manifest.mobile?.enabled ? manifest.mobile?.entry : null,
  ]) {
    if (resourcePath && !isSafeRelativePath(resourcePath)) {
      errors.push(`项目资源路径无效：${resourcePath}。`);
    }
  }
  return errors;
}

async function hasExternalPrototypePage(manifest, projectRoot, clientId, expectedPath, mounts = {}) {
  const expected = String(expectedPath || '')
    .trim()
    .toLowerCase();
  if (!expected || !manifest.prototype?.enabled) return false;

  for (const root of prototypeRootsForClient(manifest, projectRoot, clientId, mounts)) {
    const files = await walkFiles(root, { extensions: HTML_EXTENSIONS });
    if (
      files.some((filePath) => path.basename(filePath, path.extname(filePath)).toLowerCase() === expected)
    ) {
      return true;
    }
  }
  return false;
}

export async function validateProjectResources(manifest, projectRoot, { mounts = {} } = {}) {
  const errors = [];
  for (const [label, resourcePath] of [
    ['项目 Logo', manifest.branding?.logo],
    ['项目图标', manifest.branding?.favicon],
    ['移动端入口', manifest.mobile?.enabled ? manifest.mobile?.entry : null],
  ]) {
    if (!resourcePath) continue;
    if (!(await resolveExistingPathInsideRoot(projectRoot, resourcePath))) {
      errors.push(`${label}不存在：${resourcePath}。`);
    }
  }
  for (const client of manifest.clients || []) {
    const background = client.login?.background;
    if (background && !(await resolveExistingPathInsideRoot(projectRoot, background))) {
      errors.push(`客户端 ${client.id} 的登录背景不存在：${background}。`);
    }
  }
  if (manifest.docs?.enabled) {
    const docsRoot =
      mounts.projects?.[manifest.id]?.docsRoot ||
      resolveProjectContentRoot(projectRoot, manifest.docs.root, 'docs');
    if (!(await fileExists(docsRoot, 'directory'))) {
      errors.push(`文档目录不存在：${manifest.docs.root || 'docs'}。`);
    }
  }
  if (manifest.prototype?.enabled) {
    const mountedRoots = mounts.projects?.[manifest.id]?.prototypes || {};
    for (const source of normalizePrototypeSources(manifest.prototype)) {
      if (source.shellMode && !HTML_SHELL_MODES.has(source.shellMode)) {
        errors.push(`客户端 ${source.clientId || '默认'} 的 HTML 外壳处理方式无效：${source.shellMode}。`);
      }
      const prototypeRoot =
        mountedRoots[source.clientId] || resolveProjectContentRoot(projectRoot, source.root, 'prototype');
      if (!(await fileExists(prototypeRoot, 'directory'))) {
        const prefix = source.clientId ? `客户端 ${source.clientId} 的 ` : '';
        errors.push(`${prefix}HTML 原型目录不存在：${source.root || 'prototype'}。`);
      }
    }
  }
  return errors;
}

export function toPublicProjectManifest(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    name: manifest.name,
    shortName: manifest.shortName || manifest.name,
    description: manifest.description || '',
    version: manifest.version || '0.0.0',
    defaultLocale: manifest.defaultLocale || 'zh-CN',
    homepage: { visible: manifest.homepage?.visible !== false },
    branding: manifest.branding || {},
    theme: manifest.theme || {},
    clients: manifest.clients || [],
    entries: manifest.entries || [],
    docs: { enabled: Boolean(manifest.docs?.enabled), root: manifest.docs?.root || 'docs' },
    prototype: {
      enabled: Boolean(manifest.prototype?.enabled),
      root: manifest.prototype?.root || 'prototype',
      client: manifest.prototype?.client || '',
      section: manifest.prototype?.section || '',
      clients: manifest.prototype?.clients || {},
    },
    mobile: { enabled: Boolean(manifest.mobile?.enabled), entry: manifest.mobile?.entry || null },
    features: manifest.features || {},
    compatibility: manifest.compatibility || {},
  };
}

export { hasExternalPrototypePage };
