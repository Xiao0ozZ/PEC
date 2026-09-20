import path from 'node:path';

import { PAGE_PATH_PATTERN, PROJECT_ID_PATTERN } from './constants.js';
import { isSafeRelativePath, resolveExistingPathInsideRoot } from './filesystem.js';
import { hasExternalPrototypePage } from './project-manifest.js';

export async function validateProjectDefinitions(manifest, projectRoot, definitions, { mounts = {} } = {}) {
  const errors = [];
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
    return ['page-definitions.js 必须导出 clientPageDefinitions 对象。'];
  }

  // project.json 是客户端入口的唯一登记来源。页面定义文件可能由模板生成，
  // 因而保留尚未启用的空客户端骨架；这些不可达定义不能阻断实际项目启动。
  // 已登记客户端仍会在下面严格校验是否存在对应定义。

  for (const client of manifest.clients || []) {
    const definition = definitions[client.id];
    if (!definition) {
      errors.push(`客户端 ${client.id} 缺少页面定义。`);
      continue;
    }
    if (!Array.isArray(definition.sections)) errors.push(`客户端 ${client.id} 的 sections 必须是数组。`);
    if (!Array.isArray(definition.pages)) errors.push(`客户端 ${client.id} 的 pages 必须是数组。`);
    if (!Array.isArray(definition.sections) || !Array.isArray(definition.pages)) continue;

    const sectionIds = new Set();
    for (const section of definition.sections) {
      if (!PROJECT_ID_PATTERN.test(section.id || '')) errors.push(`客户端 ${client.id} 的菜单分组 id 无效。`);
      if (sectionIds.has(section.id)) errors.push(`客户端 ${client.id} 的菜单分组重复：${section.id}。`);
      sectionIds.add(section.id);
      if (!String(section.title || '').trim()) {
        errors.push(`菜单分组 ${client.id}/${section.id || '未知'} 缺少名称。`);
      }
    }

    const pagePaths = new Set();
    const pageNames = new Set();
    for (const page of definition.pages) {
      if (!PAGE_PATH_PATTERN.test(page.path || '')) {
        errors.push(`客户端 ${client.id} 的页面路径无效：${page.path || '空值'}。`);
      }
      if (pagePaths.has(page.path)) errors.push(`客户端 ${client.id} 的页面路径重复：${page.path}。`);
      pagePaths.add(page.path);
      if (!String(page.name || '').trim())
        errors.push(`页面 ${client.id}/${page.path || '未知'} 缺少 name。`);
      if (pageNames.has(page.name)) errors.push(`客户端 ${client.id} 的页面 name 重复：${page.name}。`);
      pageNames.add(page.name);
      if (!String(page.title || '').trim())
        errors.push(`页面 ${client.id}/${page.path || '未知'} 缺少标题。`);
      if (page.menu !== false && !sectionIds.has(page.section)) {
        errors.push(
          `页面 ${client.id}/${page.path || '未知'} 引用了不存在的菜单分组：${page.section || '空值'}。`,
        );
      }
      const sourceType = String(page.sourceType || '').trim();
      const source = String(page.source || '').replaceAll('\\', '/');
      if (!['html-template', 'html-direct'].includes(sourceType)) {
        errors.push(`页面 ${client.id}/${page.path || '未知'} 必须声明 HTML sourceType。`);
        continue;
      }
      if (!isSafeRelativePath(source) || !['.html', '.htm'].includes(path.extname(source).toLowerCase())) {
        errors.push(`页面 ${client.id}/${page.path || '未知'} 的 HTML source 路径无效。`);
        continue;
      }
      if (sourceType === 'html-template') {
        const sourcePath = await resolveExistingPathInsideRoot(
          path.resolve(projectRoot, 'html-pages', client.id),
          source,
          { allowedExtensions: new Set(['.html', '.htm']) },
        );
        if (!sourcePath) errors.push(`HTML 页面文件不存在：${client.id}/${source}。`);
      }
    }

    if (
      client.defaultPage &&
      !pagePaths.has(client.defaultPage) &&
      !(await hasExternalPrototypePage(manifest, projectRoot, client.id, client.defaultPage, mounts))
    ) {
      errors.push(`客户端 ${client.id} 的 defaultPage 未登记：${client.defaultPage}。`);
    }
    if (
      client.entry?.mode === 'custom-page' &&
      client.entry.page &&
      !pagePaths.has(client.entry.page) &&
      !(await hasExternalPrototypePage(manifest, projectRoot, client.id, client.entry.page, mounts))
    ) {
      errors.push(`客户端 ${client.id} 的自定义入口页面未登记：${client.entry.page}。`);
    }
  }
  return errors;
}
