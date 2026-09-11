import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';

import prettier from 'prettier';

import { normalizeRouteOrder, orderClientRouteData } from '../../project-core/src/route-order.js';
import {
  isSafeRelativePath,
  importJavaScriptFile,
  resolveExistingPathInsideRoot,
  resolveProjectRoot as resolveMountedProjectRoot,
  resolveWritablePathInsideRoot,
  scanHtmlPrototypePages,
  withFileRollback,
  writeFileAtomic,
  writeJsonAtomic,
} from '../../project-core/src/index.js';
import { inspectHtmlPrototype } from '../../project-core/src/html-preflight.js';
import { extractEmbeddedScript, isSupportedPlatformExportFormat } from './export-format.js';

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const PAGE_PATH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const allowedIcons = new Set([
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
const supportedScriptModes = new Set(['composition-api', 'options-api', 'legacy-dom']);

const MAX_HTML_LENGTH = 5 * 1024 * 1024;

function toPascalCase(value) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const contentStart = start + startMarker.length;
  const end = source.indexOf(endMarker, contentStart);
  return end < 0 ? '' : source.slice(contentStart, end);
}

function extractEditableBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return '';
  const commentEndMarker = startMarker.startsWith('/*') ? '*/' : '-->';
  const commentEnd = source.indexOf(commentEndMarker, start + startMarker.length);
  const contentStart =
    commentEnd >= 0 && commentEnd < end ? commentEnd + commentEndMarker.length : start + startMarker.length;
  return source.slice(contentStart, end);
}

function extractManifest(source) {
  const content = extractEmbeddedScript(source, 'prototype-page-manifest');
  if (content === null) throw new Error('缺少 prototype-page-manifest 页面描述。');
  try {
    return JSON.parse(content.trim());
  } catch {
    throw new Error('prototype-page-manifest 不是有效的 JSON。');
  }
}

function extractSfcBlock(source, tagName) {
  const match = source.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1].trim() : '';
}

function extractSfcTag(source, tagName) {
  const match = String(source || '').match(
    new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'i'),
  );
  if (!match) return null;
  return { attributes: match[1].trim(), content: match[2].trim() };
}

function readSfcAttribute(attributes, name) {
  const match = String(attributes || '').match(
    new RegExp(
      `(?:^|\\s)${escapeRegExp(name)}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=\\s|$)`,
      'i',
    ),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function readEmbeddedScriptAttributes(source, scriptId) {
  const match = String(source || '').match(
    new RegExp(`<script\\b([^>]*\\bid=["']${escapeRegExp(scriptId)}["'][^>]*)>`, 'i'),
  );
  return match?.[1]?.trim() || '';
}

function canonicalSfcSource(source) {
  const template = extractSfcTag(source, 'template');
  if (!template) return '';
  const script = extractSfcTag(source, 'script');
  const style = extractSfcTag(source, 'style');
  const blocks = [
    `<template${template.attributes ? ` ${template.attributes}` : ''}>\n${template.content}\n</template>`,
  ];
  if (script) {
    const setup = /\bsetup\b/i.test(script.attributes) ? ' setup' : '';
    const lang = readSfcAttribute(script.attributes, 'lang');
    blocks.push(`<script${setup}${lang ? ` lang="${lang}"` : ''}>\n${script.content}\n</script>`);
  }
  if (style) {
    const scoped = /\bscoped\b/i.test(style.attributes) ? ' scoped' : '';
    const moduleName = readSfcAttribute(style.attributes, 'module');
    const module = /\bmodule\b/i.test(style.attributes)
      ? moduleName
        ? ` module="${moduleName}"`
        : ' module'
      : '';
    const lang = readSfcAttribute(style.attributes, 'lang');
    blocks.push(`<style${scoped}${module}${lang ? ` lang="${lang}"` : ''}>\n${style.content}\n</style>`);
  }
  return `${blocks.join('\n\n')}\n`;
}

function stripEditableMarkers(source) {
  return source
    .replace(/<!--\s*\[AI-EDIT\][^>]*-->/gi, '')
    .replace(/<!--\s*PAGE_CONTENT_END\s*-->/gi, '')
    .replace(/\/\*\s*\[AI-EDIT\][^*]*\*\//gi, '')
    .replace(/\/\*\s*PAGE_LOGIC_END\s*\*\//gi, '')
    .replace(/\/\*\s*PAGE_STYLE_END\s*\*\//gi, '')
    .trim();
}

function restoreScriptEndTags(source) {
  return String(source || '').replace(/<\\\/script/gi, '</script');
}

function extractEditableSfcSource(source) {
  const template = extractEmbeddedScript(source, 'prototype-editable-template');
  if (template === null) return '';
  const script = extractEmbeddedScript(source, 'prototype-editable-script');
  const style = extractEmbeddedScript(source, 'prototype-editable-style');
  const scriptAttributes = readEmbeddedScriptAttributes(source, 'prototype-editable-script');
  const styleAttributes = readEmbeddedScriptAttributes(source, 'prototype-editable-style');
  const setup = readSfcAttribute(scriptAttributes, 'data-sfc-setup') === 'true';
  const scoped = readSfcAttribute(styleAttributes, 'data-sfc-scoped') === 'true';
  const styleModule = readSfcAttribute(styleAttributes, 'data-sfc-module');
  const scriptLang = readSfcAttribute(scriptAttributes, 'data-sfc-lang');
  const styleLang = readSfcAttribute(styleAttributes, 'data-sfc-lang');
  return canonicalSfcSource(
    [
      `<template>${restoreScriptEndTags(stripEditableMarkers(template))}</template>`,
      script === null
        ? ''
        : `<script${setup ? ' setup' : ''}${scriptLang ? ` lang="${scriptLang}"` : ''}>${restoreScriptEndTags(stripEditableMarkers(script))}</script>`,
      style === null
        ? ''
        : `<style${scoped ? ' scoped' : ''}${styleModule ? (styleModule === 'true' ? ' module' : ` module="${styleModule}"`) : ''}${styleLang ? ` lang="${styleLang}"` : ''}>${restoreScriptEndTags(stripEditableMarkers(style))}</style>`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

function extractExportSource(source) {
  return extractEditableSfcSource(source);
}

function validatePageManifest(manifest, errors) {
  if (!manifest) return;
  if (manifest.templateVersion !== 1) errors.push('当前只支持 templateVersion 为 1 的模板。');
  if (!manifest.pageKey || !/^[a-z][a-z0-9-]*$/.test(manifest.pageKey)) {
    errors.push('pageKey 必须使用小写 kebab-case。');
  }
  if (!PROJECT_ID_PATTERN.test(manifest.client || '')) {
    errors.push('client 必须使用小写 kebab-case。');
  }
  if (!manifest.pageTitle || !String(manifest.pageTitle).trim()) {
    errors.push('manifest 缺少 pageTitle。');
  }
  if (manifest.scriptMode && !supportedScriptModes.has(manifest.scriptMode)) {
    errors.push(`不支持的脚本模式：${manifest.scriptMode}。`);
  }
  if (manifest.scriptMode === 'legacy-dom') {
    errors.push('legacy-dom 页面保留原生 DOM 脚本，不能自动导入为 Vue 页面。');
  }
  if (!manifest.routePath || !/^\/[a-z][a-z0-9-]*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.routePath)) {
    errors.push('routePath 必须使用 /{client}/xxx 格式。');
  }
  if (manifest.menuIcon && !allowedIcons.has(manifest.menuIcon)) {
    errors.push(`不支持的菜单图标：${manifest.menuIcon}。`);
  }
}

function extractPageStyle(source) {
  const match = source.match(/<style[^>]*data-page-style[^>]*>([\s\S]*?)<\/style>/i);
  return match ? match[1].trim() : '';
}

function cleanTemplateMarkup(source) {
  return source
    .replace(/\sdata-page-content(?=\s|>)/g, '')
    .replace(/\sdata-page-root=["'][^"']*["']/g, '')
    .replace(/\sdata-page-key=["'][^"']*["']/g, '')
    .replace(/\sdata-page-overlay=["'][^"']*["']/g, '')
    .replace(/\sdata-layout-type=["'][^"']*["']/g, '')
    .trim();
}

function collectBlocks(source) {
  const blocks = [];
  const pattern = /data-block-id=["']([^"']+)["'][^>]*data-block-name=["']([^"']+)["']/g;
  let match = pattern.exec(source);
  while (match) {
    blocks.push({ id: match[1], name: match[2] });
    match = pattern.exec(source);
  }
  return blocks;
}

export function inspectHtml(source) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('没有读取到 HTML 内容。');
  }
  if (source.length > MAX_HTML_LENGTH) {
    throw new Error('HTML 文件超过 5 MB，暂不支持导入。');
  }

  const errors = [];
  const warnings = [];
  let manifest = null;
  const exportSource = extractExportSource(source);
  const isRoundTripExport = Boolean(exportSource);

  try {
    manifest = extractManifest(source);
  } catch (error) {
    errors.push(error.message);
  }

  if (isRoundTripExport) {
    if (!isSupportedPlatformExportFormat(manifest?.exportFormat)) {
      errors.push('可回导 HTML 缺少有效的导出格式标识。');
    }
    if (!extractSfcBlock(exportSource, 'template')) {
      errors.push('可回导源文件缺少有效的 Vue template 区块。');
    }
  } else {
    const requiredMarkers = [
      ['页面内容区', '[AI-EDIT] PAGE_CONTENT_START', '<!-- PAGE_CONTENT_END -->'],
      ['覆盖层', '[AI-EDIT] PAGE_OVERLAYS_START', '<!-- PAGE_OVERLAYS_END -->'],
      ['页面逻辑', '[AI-EDIT] PAGE_LOGIC_START', '/* PAGE_LOGIC_END */'],
    ];

    for (const [label, startMarker, endMarker] of requiredMarkers) {
      if (!extractBetween(source, startMarker, endMarker).trim()) {
        errors.push(`缺少${label}标记或内容。`);
      }
    }
  }

  const markupSource = source.replace(/<!--[\s\S]*?-->/g, '');
  const content = isRoundTripExport
    ? extractSfcBlock(exportSource, 'template')
    : extractEditableBlock(source, '[AI-EDIT] PAGE_CONTENT_START', '<!-- PAGE_CONTENT_END -->');
  const overlays = isRoundTripExport
    ? ''
    : extractEditableBlock(source, '[AI-EDIT] PAGE_OVERLAYS_START', '<!-- PAGE_OVERLAYS_END -->');
  const logic = isRoundTripExport
    ? exportSource
    : extractEditableBlock(source, '/* [AI-EDIT] PAGE_LOGIC_START', '/* PAGE_LOGIC_END */');
  const editableSource = `${content}\n${overlays}\n${logic}`;
  if (!isRoundTripExport) {
    const contentCount = (markupSource.match(/<[^>]*\bdata-page-content\b[^>]*>/gi) || []).length;
    if (contentCount !== 1) errors.push('data-page-content 必须且只能出现一次。');
    if (!/<[^>]*\bdata-business-content\b[^>]*>/i.test(markupSource)) {
      warnings.push('未发现 data-business-content，页面可能缺少业务内容区标记。');
    }
    if (/<script[^>]+src=["'](?!https?:)/i.test(source.replace(/<!--[\s\S]*?-->/g, ''))) {
      warnings.push('页面包含本地 script src，导入时不会复制外部脚本文件。');
    }
    if (/\bon(?:click|change|input|submit)\s*=\s*/i.test(editableSource)) {
      errors.push('禁止使用 onclick、onchange 等内联事件，请改用 Vue 事件绑定。');
    }
    if (/window\.location|document\.querySelector|jquery|\.html\s*['"`]/i.test(editableSource)) {
      warnings.push('页面包含模板规范不建议使用的浏览器或 HTML 跳转逻辑，请导入前确认。');
    }
    if (/https?:\/\//i.test(editableSource.match(/<img\b[^>]*>/gi)?.join('') || '')) {
      warnings.push('图片存在外部 URL，导出时可能无法离线显示。');
    }
  }

  validatePageManifest(manifest, errors);

  const preflight = inspectHtmlPrototype(source, {
    requireDocument: /<!doctype\s+html|<html\b/iu.test(source),
  });
  for (const item of preflight.errors) {
    if (!errors.some((message) => message.includes(item.message))) errors.push(item.message);
  }
  for (const item of preflight.warnings.filter((warning) => warning.code !== 'external-resources')) {
    if (!warnings.some((message) => message.includes(item.message))) warnings.push(item.message);
  }

  const dialogs = (overlays.match(/<el-dialog\b/gi) || []).length;
  const drawers = (overlays.match(/<el-drawer\b/gi) || []).length;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest,
    format: isRoundTripExport ? manifest.exportFormat : 'html-template',
    roundTrip: isRoundTripExport,
    stats: {
      blocks: collectBlocks(content),
      dialogs,
      drawers,
      hasStyle: Boolean(extractPageStyle(source)),
      logicLength: logic.trim().length,
    },
  };
}

function convertLogicToVueScript(source, scriptMode = 'composition-api') {
  let logic = source.trim();
  const vueImports = new Set();
  const elementImports = new Set();
  const iconImports = new Set();
  const vueNames = new Set();
  const elementNames = new Set();
  const iconNames = new Set();
  const directIconNames = new Set();

  logic = logic.replace(/const\s*\{([\s\S]*?)\}\s*=\s*Vue\s*;?/g, (_match, names) => {
    names
      .split(',')
      .map((name) => name.trim().split(/\s+as\s+/)[0])
      .filter(Boolean)
      .forEach((name) => vueNames.add(name));
    return '';
  });

  logic = logic.replace(/const\s*\{([\s\S]*?)\}\s*=\s*ElementPlusIconsVue\s*;?/g, (_match, names) => {
    names
      .split(',')
      .map((name) => name.trim().split(/\s+as\s+/)[0])
      .filter(Boolean)
      .forEach((name) => iconNames.add(name));
    return '';
  });

  logic = logic.replace(/const\s*\{([\s\S]*?)\}\s*=\s*ElementPlus(?!IconsVue)\b\s*;?/g, (_match, names) => {
    names
      .split(',')
      .map((name) => name.trim().split(/\s+as\s+/)[0])
      .filter(Boolean)
      .forEach((name) => elementNames.add(name));
    return '';
  });

  logic = logic.replace(/ElementPlusIconsVue\.([A-Za-z0-9_]+)/g, (_match, name) => {
    directIconNames.add(name);
    return name;
  });

  logic = logic.replace(/ElementPlus\.(ElMessage|ElMessageBox)/g, (_match, name) => {
    elementImports.add(name);
    return name;
  });

  if (logic.includes('Vue.nextTick')) {
    vueImports.add('nextTick');
    logic = logic.replaceAll('Vue.nextTick', 'nextTick');
  }

  // Names in string literals (for example icon="Refresh" or a status value
  // like "Refresh") are resolved by the template/global icon registry and
  // must not become JavaScript imports. Comments are not references either.
  const referenceSource = maskJavaScriptNonCode(logic);
  const isReferenced = (name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(referenceSource);
  vueNames.forEach((name) => {
    if (isReferenced(name)) vueImports.add(name);
  });
  elementNames.forEach((name) => {
    if (isReferenced(name)) elementImports.add(name);
  });
  iconNames.forEach((name) => {
    if (isReferenced(name)) iconImports.add(name);
  });
  directIconNames.forEach((name) => {
    if (isReferenced(name)) iconImports.add(name);
  });

  const imports = [];
  if (vueImports.size) imports.push(`import { ${[...vueImports].join(', ')} } from 'vue';`);
  if (elementImports.size) imports.push(`import { ${[...elementImports].join(', ')} } from 'element-plus';`);
  if (iconImports.size)
    imports.push(`import { ${[...iconImports].join(', ')} } from '@element-plus/icons-vue';`);

  const exportStatement =
    scriptMode === 'options-api'
      ? 'export default pageOptions;'
      : 'export default {\n  setup: pageSetup,\n};';
  return `${imports.join('\n')}\n\n${logic}\n\n${exportStatement}`;
}

function maskJavaScriptNonCode(source) {
  const input = String(source || '');
  const output = input.split('');
  let state = 'code';
  let quote = '';
  let escaped = false;

  const blank = (index) => {
    if (output[index] !== '\n' && output[index] !== '\r') output[index] = ' ';
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') state = 'code';
      else blank(index);
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        blank(index);
        blank(index + 1);
        index += 1;
        state = 'code';
      } else {
        blank(index);
      }
      continue;
    }
    if (state === 'string') {
      if (char === '\\' && !escaped) {
        blank(index);
        escaped = true;
        continue;
      }
      blank(index);
      if (char === quote && !escaped) state = 'code';
      escaped = false;
      continue;
    }

    if (char === '/' && next === '/') {
      blank(index);
      blank(index + 1);
      index += 1;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      blank(index);
      blank(index + 1);
      index += 1;
      state = 'block-comment';
    } else if (char === '"' || char === "'" || char === '`') {
      blank(index);
      quote = char;
      escaped = false;
      state = 'string';
    }
  }

  return output.join('');
}

async function loadDefinitions(definitionsPath) {
  const module = await importJavaScriptFile(definitionsPath, { cacheKey: `transfer-${Date.now()}` });
  return module.clientPageDefinitions;
}

async function loadProjectPackage(projectRoot, projectId, mounts = {}) {
  if (!PROJECT_ID_PATTERN.test(projectId || '')) throw new Error('项目 ID 无效。');
  const packageRoot = resolveMountedProjectRoot(path.join(projectRoot, 'projects'), projectId, mounts);
  const manifestPath = await resolveExistingPathInsideRoot(packageRoot, 'project.json', {
    allowedExtensions: new Set(['.json']),
  });
  if (!manifestPath) throw new Error('项目配置文件不存在、越界或不是 JSON 文件。');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (manifest.id !== projectId) throw new Error('项目 ID 与项目文件夹不一致。');
  const definitionsPath = await resolveExistingPathInsideRoot(
    packageRoot,
    manifest.pageDefinitions || 'page-definitions.js',
    { allowedExtensions: new Set(['.js']) },
  );
  if (!definitionsPath) throw new Error('页面定义文件必须是项目包内的 JavaScript 文件。');
  const definitions = await loadDefinitions(definitionsPath);
  return { projectId, packageRoot, manifest, definitionsPath, definitions };
}

async function resolveProjectViewPath(projectRoot, projectPackage, view) {
  const packageView = await resolveExistingPathInsideRoot(
    path.join(projectPackage.packageRoot, 'views'),
    view,
    { allowedExtensions: new Set(['.vue']) },
  );
  if (packageView) return packageView;
  if (projectPackage.manifest.compatibility?.legacyViewRoot === 'src/views') {
    const compatibilityView = await resolveExistingPathInsideRoot(
      path.join(projectRoot, 'src', 'views'),
      view,
      {
        allowedExtensions: new Set(['.vue']),
      },
    );
    if (compatibilityView) return compatibilityView;
  }
  throw new Error(`项目页面文件不存在：${view}`);
}

function parseRoutePath(manifest, requestedRoute) {
  const fallback =
    String(manifest.routePath || '')
      .split('/')
      .filter(Boolean)
      .at(-1) || '';
  const routePath = String(requestedRoute || fallback)
    .replace(/^\//, '')
    .trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(routePath)) {
    throw new Error('路由片段必须使用 kebab-case。');
  }
  return routePath;
}

function normalizeThemeHex(value) {
  const match = String(value || '')
    .trim()
    .match(/^#([a-f\d]{6})$/i);
  return match ? `#${match[1]}` : '';
}

function mixThemeHexWithWhite(value, whiteWeight) {
  const normalized = normalizeThemeHex(value);
  if (!normalized) return '';
  const channels = normalized
    .slice(1)
    .match(/../g)
    .map((channel) => Number.parseInt(channel, 16));
  return `#${channels
    .map((channel) =>
      Math.round(channel + (255 - channel) * whiteWeight)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function themeHexToRgbChannels(value) {
  const normalized = normalizeThemeHex(value);
  if (!normalized) return '';
  return normalized
    .slice(1)
    .match(/../g)
    .map((channel) => Number.parseInt(channel, 16))
    .join(' ');
}

function readCssPropertyValue(source, property) {
  const match = String(source || '').match(new RegExp(`${escapeRegExp(property)}\\s*:\\s*([^;{}]+)`, 'i'));
  return match?.[1]?.trim() || '';
}

function extractThemeTokenStyle(source) {
  const match = String(source || '').match(/<style\b[^>]*data-theme-tokens[^>]*>([\s\S]*?)<\/style>/i);
  return match?.[1]?.trim() || '';
}

function replaceColorLiteral(source, original, replacement) {
  const normalizedOriginal = normalizeThemeHex(original);
  const normalizedReplacement = normalizeThemeHex(replacement);
  if (!normalizedOriginal || !normalizedReplacement) return source;
  return String(source || '').replace(
    new RegExp(escapeRegExp(normalizedOriginal), 'gi'),
    normalizedReplacement,
  );
}

function replaceCssPropertyValue(source, property, value) {
  if (!value) return source;
  return String(source || '').replace(
    new RegExp(`(${escapeRegExp(property)}\\s*:\\s*)[^;{}]+`, 'gi'),
    `$1${value}`,
  );
}

function applyProjectThemeToImportedBlocks(blocks, theme) {
  const sourceTheme = `${blocks.themeTokens || ''}\n${blocks.style || ''}`;
  const sourcePrimary = readCssPropertyValue(sourceTheme, '--app-color-primary') || '#00689E';
  const sourceHover = readCssPropertyValue(sourceTheme, '--app-color-primary-hover');
  const sourceActive = readCssPropertyValue(sourceTheme, '--app-color-primary-active');
  const primary = normalizeThemeHex(theme?.primary);
  if (!primary) return blocks;

  const hover = normalizeThemeHex(theme.primaryHover) || primary;
  const active = normalizeThemeHex(theme.primaryActive) || hover;
  const lightColors = [
    ['--app-color-primary-light-3', 0.3],
    ['--app-color-primary-light-5', 0.5],
    ['--app-color-primary-light-7', 0.7],
    ['--app-color-primary-light-8', 0.8],
    ['--app-color-primary-light-9', 0.9],
  ].map(([property, whiteWeight]) => ({
    property,
    original: readCssPropertyValue(sourceTheme, property),
    replacement: mixThemeHexWithWhite(primary, whiteWeight),
  }));
  const replacementPairs = [
    [sourcePrimary, primary],
    [sourceHover, hover],
    [sourceActive, active],
    ...lightColors.map(({ original, replacement }) => [original, replacement]),
  ].filter(([original, replacement]) => normalizeThemeHex(original) && normalizeThemeHex(replacement));
  const replaceBlockColors = (block) =>
    replacementPairs.reduce(
      (current, [original, replacement]) => replaceColorLiteral(current, original, replacement),
      block,
    );

  let style = replaceBlockColors(sourceTheme);
  style = replaceCssPropertyValue(style, '--app-color-primary', primary);
  style = replaceCssPropertyValue(style, '--app-color-primary-hover', hover);
  style = replaceCssPropertyValue(style, '--app-color-primary-active', active);
  style = replaceCssPropertyValue(
    style,
    '--app-color-primary-shadow',
    `rgb(${themeHexToRgbChannels(primary)} / 18%)`,
  );
  lightColors.forEach(({ property, replacement }) => {
    style = replaceCssPropertyValue(style, property, replacement);
  });

  return {
    content: replaceBlockColors(blocks.content),
    overlays: replaceBlockColors(blocks.overlays),
    logic: replaceBlockColors(blocks.logic),
    style,
  };
}

export function buildVueSource(source, manifest, theme = {}) {
  const themedBlocks = applyProjectThemeToImportedBlocks(
    {
      content: extractEditableBlock(source, '[AI-EDIT] PAGE_CONTENT_START', '<!-- PAGE_CONTENT_END -->'),
      overlays: extractEditableBlock(source, '[AI-EDIT] PAGE_OVERLAYS_START', '<!-- PAGE_OVERLAYS_END -->'),
      logic: extractEditableBlock(source, '/* [AI-EDIT] PAGE_LOGIC_START', '/* PAGE_LOGIC_END */'),
      style: extractPageStyle(source),
      themeTokens: extractThemeTokenStyle(source),
    },
    theme,
  );
  const content = cleanTemplateMarkup(themedBlocks.content);
  const overlays = cleanTemplateMarkup(themedBlocks.overlays);
  const logic = themedBlocks.logic;
  const style = themedBlocks.style;
  const scriptMode = manifest.scriptMode || 'composition-api';

  if (!content || !logic) throw new Error('页面内容或页面逻辑为空，无法生成 Vue 页面。');
  if (scriptMode === 'legacy-dom')
    throw new Error('legacy-dom 页面不能自动转换为 Vue 页面，请保留为直接读取 HTML。');

  return [
    '<template>',
    '  <!-- 由规范 HTML 原型导入；页面业务状态和模拟数据保留在本页面。 -->',
    content
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
    overlays
      ? overlays
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n')
      : '',
    '</template>',
    '',
    '<script>',
    `// 来源模板：${manifest.pageKey}`,
    convertLogicToVueScript(logic, scriptMode)
      .split('\n')
      .map((line) => line)
      .join('\n'),
    '</script>',
    '',
    '<style scoped>',
    style,
    '</style>',
    '',
  ].join('\n');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingDelimiter(source, start, opening, closing) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findClientArrayRange(source, clientId, arrayName) {
  const clientPattern = new RegExp(
    `(?:^|\\n)\\s*(?:${escapeRegExp(clientId)}|["']${escapeRegExp(clientId)}["'])\\s*:\\s*\\{`,
  );
  const clientMatch = clientPattern.exec(source);
  if (!clientMatch) throw new Error(`页面定义不存在客户端：${clientId}。`);
  const clientStart = source.indexOf('{', clientMatch.index + clientMatch[0].length - 1);
  const clientEnd = findMatchingDelimiter(source, clientStart, '{', '}');
  if (clientStart < 0 || clientEnd < 0) throw new Error(`客户端 ${clientId} 的定义格式无效。`);
  const propertyPattern = new RegExp(`${escapeRegExp(arrayName)}\\s*:\\s*\\[`);
  const propertyMatch = propertyPattern.exec(source.slice(clientStart, clientEnd + 1));
  if (!propertyMatch) throw new Error(`客户端 ${clientId} 缺少 ${arrayName} 配置。`);
  const arrayStart = clientStart + propertyMatch.index + propertyMatch[0].lastIndexOf('[');
  const arrayEnd = findMatchingDelimiter(source, arrayStart, '[', ']');
  if (arrayEnd < 0) throw new Error(`客户端 ${clientId} 的 ${arrayName} 配置格式无效。`);
  return { start: arrayStart, end: arrayEnd };
}

function splitTopLevelArrayItems(source, range) {
  const items = [];
  let itemStart = range.start + 1;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = range.start + 1; index <= range.end; index += 1) {
    const char = source[index] || '';
    const next = source[index + 1] || '';
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;
    const isTopLevel = braceDepth === 0 && bracketDepth === 0 && parenDepth === 0;
    if ((char === ',' && isTopLevel) || index === range.end) {
      const end = char === ',' ? index + 1 : index;
      const raw = source.slice(itemStart, end);
      const valueStart = itemStart + raw.search(/\S/);
      if (
        valueStart >= itemStart &&
        valueStart < end &&
        !source.slice(valueStart, end).trim().startsWith('//')
      ) {
        items.push({ start: valueStart, end, source: source.slice(valueStart, end) });
      }
      itemStart = end;
    }
  }
  return items;
}

function readDefinitionProperty(source, property) {
  const pattern = new RegExp(
    `(?:^|[,{]\\s*)(?:${escapeRegExp(property)}|["']${escapeRegExp(property)}["'])\\s*:\\s*(["'])(.*?)\\1`,
  );
  return source.match(pattern)?.[2] || '';
}

function findPageDefinitionItem(source, clientId, pagePath) {
  const range = findClientArrayRange(source, clientId, 'pages');
  const item = splitTopLevelArrayItems(source, range).find(
    (candidate) => readDefinitionProperty(candidate.source, 'path') === pagePath,
  );
  if (!item) throw new Error(`客户端 ${clientId} 不存在路由：${pagePath}。`);
  return item;
}

function replaceDefinitionStringProperty(source, property, value) {
  const pattern = new RegExp(
    `((?:^|[,{]\\s*)(?:${escapeRegExp(property)}|["']${escapeRegExp(property)}["'])\\s*:\\s*)(["'])(.*?)\\2`,
  );
  if (!pattern.test(source)) throw new Error(`定义缺少 ${property} 字段。`);
  return source.replace(pattern, (_, prefix) => `${prefix}${JSON.stringify(value)}`);
}

function replaceSectionDefinitions(source, clientId, updates) {
  const range = findClientArrayRange(source, clientId, 'sections');
  const updateMap = new Map(updates.map((section) => [section.id, section.title]));
  const items = splitTopLevelArrayItems(source, range)
    .filter((item) => updateMap.has(readDefinitionProperty(item.source, 'id')))
    .sort((left, right) => right.start - left.start);
  if (items.length !== updateMap.size) throw new Error('菜单分组定义已发生变化，请重新读取后再试。');
  return items.reduce((result, item) => {
    const sectionId = readDefinitionProperty(item.source, 'id');
    const updatedItem = replaceDefinitionStringProperty(item.source, 'title', updateMap.get(sectionId));
    return `${result.slice(0, item.start)}${updatedItem}${result.slice(item.end)}`;
  }, source);
}

function reorderSectionDefinitions(source, clientId, sections) {
  const range = findClientArrayRange(source, clientId, 'sections');
  const itemsById = new Map(
    splitTopLevelArrayItems(source, range).map((item) => [
      readDefinitionProperty(item.source, 'id'),
      item.source,
    ]),
  );
  const content = sections
    .map((section) => {
      const current = itemsById.get(section.id);
      return current
        ? replaceDefinitionStringProperty(current, 'title', section.title).trim()
        : sectionDefinitionLineFromSection(section).trim();
    })
    .map((item) => `      ${item}`)
    .join('\n');
  const replacement = content ? `\n${content}\n    ` : '\n    ';
  return `${source.slice(0, range.start + 1)}${replacement}${source.slice(range.end)}`;
}

function sectionDefinitionLineFromSection(section) {
  return `      ${JSON.stringify({ id: section.id, title: section.title })},`;
}

function removeSectionDefinitions(source, clientId, sectionIds) {
  const ids = new Set(sectionIds);
  if (!ids.size) return source;
  const range = findClientArrayRange(source, clientId, 'sections');
  const items = splitTopLevelArrayItems(source, range)
    .filter((item) => ids.has(readDefinitionProperty(item.source, 'id')))
    .sort((left, right) => right.start - left.start);
  if (items.length !== ids.size) throw new Error('菜单分组定义已发生变化，请重新读取后再试。');
  return items.reduce((result, item) => `${result.slice(0, item.start)}${result.slice(item.end)}`, source);
}

function insertSectionDefinition(source, clientId, section) {
  const range = findClientArrayRange(source, clientId, 'sections');
  const line = sectionDefinitionLineFromSection(section);
  const marker = `      // <generator:${clientId}-sections>`;
  if (source.includes(marker)) return source.replace(marker, `${line}\n${marker}`);
  const sectionContent = source.slice(range.start + 1, range.end);
  const separator = sectionContent.trim() && !sectionContent.trimEnd().endsWith(',') ? ',' : '';
  return `${source.slice(0, range.end)}${separator}\n${line}${source.slice(range.end)}`;
}

function syncSectionDefinitions(source, clientId, currentSections, targetSections) {
  const currentIds = new Set(currentSections.map((section) => section.id));
  const targetIds = new Set(targetSections.map((section) => section.id));
  let result = replaceSectionDefinitions(
    source,
    clientId,
    targetSections.filter((section) => currentIds.has(section.id)),
  );
  result = removeSectionDefinitions(
    result,
    clientId,
    currentSections.filter((section) => !targetIds.has(section.id)).map((section) => section.id),
  );
  targetSections
    .filter((section) => !currentIds.has(section.id))
    .forEach((section) => {
      result = insertSectionDefinition(result, clientId, section);
    });
  return reorderSectionDefinitions(result, clientId, targetSections);
}

function insertPageDefinition(source, clientId, page) {
  const marker = `      // <generator:${clientId}-pages>`;
  if (!source.includes(marker)) throw new Error(`页面注册表缺少生成器标记：${marker}`);
  return source.replace(marker, `${definitionLineFromPage(page)}\n${marker}`);
}

function definitionLineFromPage(page) {
  return `      ${JSON.stringify(page)},`;
}

function replacePageDefinition(source, clientId, originalPath, page) {
  const item = findPageDefinitionItem(source, clientId, originalPath);
  return `${source.slice(0, item.start)}${definitionLineFromPage(page)}${source.slice(item.end)}`;
}

function removePageDefinition(source, clientId, pagePath) {
  const item = findPageDefinitionItem(source, clientId, pagePath);
  return source.slice(0, item.start) + source.slice(item.end);
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

async function isPackageViewPath(projectPackage, filePath) {
  if (!filePath) return false;
  const [packageViewsRoot, absolute] = await Promise.all([
    fsp.realpath(path.resolve(projectPackage.packageRoot, 'views')).catch(() => null),
    fsp.realpath(filePath).catch(() => null),
  ]);
  return Boolean(packageViewsRoot && absolute && isPathInside(packageViewsRoot, absolute));
}

function managedHtmlRoot(projectPackage, client) {
  return path.join(projectPackage.packageRoot, 'html-pages', client);
}

async function resolvePackageViewWritePath(projectPackage, relativeView) {
  const target = await resolveWritablePathInsideRoot(
    projectPackage.packageRoot,
    path.posix.join('views', String(relativeView || '').replaceAll('\\', '/')),
    { allowedExtensions: new Set(['.vue']) },
  );
  if (!target) throw new Error(`Vue 页面写入路径无效：${relativeView || '空值'}。`);
  return target;
}

async function resolveManagedHtmlPath(projectPackage, client, source, { mustExist = false } = {}) {
  const relative = String(source || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  const root = managedHtmlRoot(projectPackage, client);
  const packageRelative = path.posix.join('html-pages', client, relative);
  const target = mustExist
    ? await resolveExistingPathInsideRoot(projectPackage.packageRoot, packageRelative, {
        allowedExtensions: new Set(['.html', '.htm']),
      })
    : await resolveWritablePathInsideRoot(projectPackage.packageRoot, packageRelative, {
        allowedExtensions: new Set(['.html', '.htm']),
      });
  if (!relative || !isSafeRelativePath(relative) || !target) {
    throw new Error(`HTML 页面来源路径无效：${client}/${relative || '空值'}。`);
  }
  return { root, relative, target };
}

async function managedHtmlPathForPage(projectPackage, page, options = {}) {
  if (page?.sourceType !== 'html-template' || !page.source) return null;
  return (await resolveManagedHtmlPath(projectPackage, page.client, page.source, options)).target;
}

function routeDefinitionPages(definition) {
  return (definition?.pages || []).filter((page) => page.sourceType !== 'html-template');
}

async function createPageBackup(projectPackage, metadata, sourcePath, sourceKind = 'vue') {
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
    await fsp.mkdir(directory, { recursive: true });
    const backupFile = sourceKind === 'html' ? 'page.html' : 'page.vue';
    if (sourcePath && fs.existsSync(sourcePath)) {
      const backupPath = await resolveWritablePathInsideRoot(
        projectPackage.packageRoot,
        path.posix.join(relativeDirectory, backupFile),
        { allowedExtensions: new Set(['.html', '.vue']) },
      );
      if (!backupPath) throw new Error('页面备份文件路径不安全。');
      await fsp.copyFile(sourcePath, backupPath);
    }
    await writeJsonAtomic(metadataPath, { ...metadata, id, sourceKind });
  } catch (error) {
    await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return { id, directory };
}

async function listPageBackups(projectPackage) {
  const root = pageBackupRoot(projectPackage);
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
    const metadataPath = path.join(root, entry.name, 'metadata.json');
    try {
      const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
      backups.push(metadata);
    } catch {
      // Ignore incomplete backup folders; they are not presented as restorable records.
    }
  }
  return backups.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

async function listSectionBackups(projectPackage) {
  const root = sectionBackupRoot(projectPackage);
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
    const metadataPath = path.join(root, entry.name, 'metadata.json');
    try {
      const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
      backups.push(metadata);
    } catch {
      // Ignore incomplete backup folders; they are not presented as restorable records.
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
    await fsp.mkdir(directory, { recursive: true });
    await writeJsonAtomic(metadataPath, { ...metadata, id });
  } catch (error) {
    await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return { id, directory };
}

function buildPlaceholderVue({ title, routePath }) {
  return `<template>
  <main class="project-placeholder-page">
    <header class="project-placeholder-header">
      <h1>${String(title).replace(/[<&>"']/g, '')}</h1>
      <p>页面路由已建立，可继续通过 HTML 原型导入完善页面内容。</p>
    </header>
    <section class="project-placeholder-panel">
      <el-empty description="页面内容待补充" />
    </section>
  </main>
</template>

<style scoped>
.project-placeholder-page { padding: 24px 28px 32px; color: var(--app-color-text-primary); }
.project-placeholder-header h1 { margin: 0; font-size: 24px; }
.project-placeholder-header p { margin: 8px 0 0; color: var(--app-color-text-muted); font-size: 13px; }
.project-placeholder-panel { margin-top: 20px; padding: 48px 24px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius-panel); background: var(--app-color-surface); }
</style>
<!-- route: ${routePath} -->
`;
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
    <meta name="prototype-path" content="${routePath}" />
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
          <p>页面路由已建立，可通过页面导入功能替换为正式原型内容。</p>
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

function pageRecord({ client, routePath, pageTitle, view, section, icon, source = 'route-manager' }) {
  return {
    path: routePath,
    name: `${client}-${routePath}`,
    title: pageTitle,
    view,
    section,
    icon,
    source,
  };
}

async function writeDefinitions(definitionsPath, source) {
  await writeFileAtomic(definitionsPath, source, { encoding: 'utf8' });
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
      if (!fs.existsSync(configuredPath)) return {};
      throw new Error('路由顺序配置路径越界或类型无效。');
    }
    const content = await fsp.readFile(configPath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`路由顺序配置读取失败：${error.message}`);
  }
}

async function writeRouteOrderConfig(projectPackage, clientId, clientConfig) {
  const current = await readRouteOrderConfig(projectPackage);
  const clients = {
    ...(current.clients || {}),
    [clientId]: clientConfig,
  };
  const config = {
    ...current,
    schemaVersion: 1,
    clients,
  };
  const configPath = await resolveWritablePathInsideRoot(
    projectPackage.packageRoot,
    '.platform/route-order.json',
    { allowedExtensions: new Set(['.json']) },
  );
  if (!configPath) throw new Error('路由顺序配置写入路径不安全。');
  await writeJsonAtomic(configPath, config);
  return config;
}

async function htmlPagesForProject(projectRoot, projectId, mounts = {}) {
  const htmlPrototypeState = await scanHtmlPrototypePages(path.join(projectRoot, 'projects'), {
    mounts,
  });
  return htmlPrototypeState.projects[projectId] || {};
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

export async function updateProjectSections({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  const client = String(target.client || '').trim();
  const clientDefinition = projectPackage.definitions[client];
  if (!clientDefinition) throw new Error(`项目 ${target.projectId} 不存在客户端：${client}。`);
  const htmlPages = await htmlPagesForProject(projectRoot, target.projectId, mounts);
  const allPages = [...routeDefinitionPages(clientDefinition), ...(htmlPages[client] || [])];
  const updates = Array.isArray(target.sections)
    ? target.sections.map((section) => ({
        id: String(section?.id || '').trim(),
        title: String(section?.title || '').trim(),
      }))
    : [];
  if (updates.some((section) => !section.id || !section.title))
    throw new Error('菜单分组 ID 和名称不能为空。');
  if (updates.some((section) => !/^[a-z][a-z0-9-]*$/.test(section.id))) {
    throw new Error('菜单分组 ID 必须使用小写英文字母、数字和连字符，并以字母开头。');
  }
  if (new Set(updates.map((section) => section.id)).size !== updates.length) {
    throw new Error('菜单分组 ID 不能重复。');
  }
  if (new Set(updates.map((section) => section.title)).size !== updates.length) {
    throw new Error('菜单分组名称不能重复。');
  }
  const originalSections = clientDefinition.sections.map((section) => ({
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
  if (!sectionsChanged) {
    throw new Error('菜单分组没有发生变化。');
  }
  const sourceDefinitions = await fsp.readFile(projectPackage.definitionsPath, 'utf8');
  const updatedDefinitions = syncSectionDefinitions(sourceDefinitions, client, originalSections, updates);
  const routeOrder = await readRouteOrderConfig(projectPackage);
  const currentClientOrder = routeOrder.clients?.[client] || {};
  const normalizedOrder = normalizeRouteOrder({
    sections: updates,
    pages: allPages,
    sectionOrder: updates.map((section) => section.id),
    pageOrder: currentClientOrder.pageOrder,
  });
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
  return {
    client,
    order: normalizedOrder,
    requiresReload: true,
  };
}

export async function restoreProjectSections({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  if (!/^[a-zA-Z0-9_-]+$/.test(String(target.backupId || ''))) throw new Error('备份 ID 无效。');
  const metadataPath = await resolveExistingPathInsideRoot(
    projectPackage.packageRoot,
    path.posix.join('.backups', 'sections', target.backupId, 'metadata.json'),
    { allowedExtensions: new Set(['.json']) },
  );
  if (!metadataPath) throw new Error('分组备份不存在或路径不安全。');
  const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
  if (metadata.restoredAt) throw new Error('该分组备份已经还原。');
  const clientDefinition = projectPackage.definitions[metadata.client];
  if (!clientDefinition) throw new Error(`客户端不存在：${metadata.client}。`);
  const currentSections = clientDefinition.sections.map((section) => ({
    id: section.id,
    title: section.title,
  }));
  const currentMap = new Map(currentSections.map((section) => [section.id, section.title]));
  if (metadata.replacement.some((section) => currentMap.get(section.id) !== section.title)) {
    throw new Error('当前菜单分组已经发生其他变化，请先重新读取后再试。');
  }
  const sourceDefinitions = await fsp.readFile(projectPackage.definitionsPath, 'utf8');
  const updatedDefinitions = syncSectionDefinitions(
    sourceDefinitions,
    metadata.client,
    currentSections,
    metadata.original,
  );
  const routeOrder = await readRouteOrderConfig(projectPackage);
  const currentClientOrder = routeOrder.clients?.[metadata.client] || {};
  const restoredOrder = {
    ...currentClientOrder,
    sectionOrder: metadata.original.map((section) => section.id),
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
  return { sections: metadata.original, order: restoredOrder, requiresReload: true };
}

export async function createProjectRoute({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  const client = String(target.client || '').trim();
  const clientDefinition = projectPackage.definitions[client];
  if (!clientDefinition) throw new Error(`项目 ${target.projectId} 不存在客户端：${client}。`);
  const routePath = String(target.routePath || '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  if (!PAGE_PATH_PATTERN.test(routePath)) throw new Error('路由片段必须使用 kebab-case。');
  const pageTitle = String(target.pageTitle || target.menuTitle || '').trim();
  if (!pageTitle) throw new Error('页面名称不能为空。');
  const section = String(target.menuSection || '').trim();
  if (!clientDefinition.sections.some((item) => item.id === section))
    throw new Error(`菜单分组不存在：${section}。`);
  const icon = String(target.menuIcon || 'Document').trim();
  if (!allowedIcons.has(icon)) throw new Error(`不支持的菜单图标：${icon}。`);
  if (clientDefinition.pages.some((page) => page.path === routePath))
    throw new Error(`路由已存在：${routePath}。`);
  const useManagedHtml = target.runtime === 'html';
  const relativeView = `${client}/${toPascalCase(routePath)}View.vue`;
  const fileName = normalizeHtmlFileName(target.fileName || pageTitle, `${routePath}.html`);
  const managedSource = useManagedHtml
    ? await resolveManagedHtmlPath(projectPackage, client, fileName)
    : null;
  const targetPath = useManagedHtml
    ? managedSource.target
    : await resolvePackageViewWritePath(projectPackage, relativeView);
  if (fs.existsSync(targetPath)) {
    throw new Error(`页面文件已存在：${useManagedHtml ? fileName : relativeView}。`);
  }
  const sourceDefinitions = await fsp.readFile(projectPackage.definitionsPath, 'utf8');
  const page = useManagedHtml
    ? {
        path: routePath,
        name: `${client}-${routePath}`,
        title: pageTitle,
        sourceType: 'html-template',
        source: fileName,
        section,
        icon,
        prototype: {
          fileName,
          templateVersion: 1,
          pageKey: `${client}-${routePath}`,
          pageTitle,
          pageType: 'custom',
          pageHeaderMode: 'standard',
        },
      }
    : pageRecord({ client, routePath, pageTitle, view: relativeView, section, icon });
  const updatedDefinitions = insertPageDefinition(sourceDefinitions, client, page);
  await withFileRollback([targetPath, projectPackage.definitionsPath], async () => {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await writeFileAtomic(
      targetPath,
      useManagedHtml
        ? buildPlaceholderHtml({ client, title: pageTitle, routePath, section, icon })
        : buildPlaceholderVue({ title: pageTitle, routePath }),
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
  const originalPath = String(target.originalPath || '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  const originalPage = clientDefinition?.pages.find((item) => item.path === originalPath);
  if (!clientDefinition || !originalPage) throw new Error(`找不到要编辑的路由：${client}/${originalPath}。`);
  const routePath = String(target.routePath || '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  if (!PAGE_PATH_PATTERN.test(routePath)) throw new Error('路由片段必须使用 kebab-case。');
  const pageTitle = String(target.pageTitle || target.menuTitle || '').trim();
  if (!pageTitle) throw new Error('页面名称不能为空。');
  const section = String(target.menuSection || '').trim();
  if (!clientDefinition.sections.some((item) => item.id === section))
    throw new Error(`菜单分组不存在：${section}。`);
  const icon = String(target.menuIcon || originalPage.icon || 'Document').trim();
  if (!allowedIcons.has(icon)) throw new Error(`不支持的菜单图标：${icon}。`);
  const duplicate = clientDefinition.pages.find(
    (page) => page.path === routePath && page.path !== originalPath,
  );
  if (duplicate) throw new Error(`路由已存在：${routePath}。`);
  const manifestClient = projectPackage.manifest.clients?.find((item) => item.id === client);
  if (manifestClient?.defaultPage === originalPath && routePath !== originalPath) {
    throw new Error('默认页面不允许在编辑时更换路由片段，请先在项目配置中调整默认页面。');
  }

  const routeChanged = routePath !== originalPath;
  const relativeView = routeChanged ? `${client}/${toPascalCase(routePath)}View.vue` : originalPage.view;
  const targetPath = await resolvePackageViewWritePath(projectPackage, relativeView);
  const originalViewPath = await resolveProjectViewPath(projectRoot, projectPackage, originalPage.view);
  if (routeChanged && fs.existsSync(targetPath)) throw new Error(`页面文件已存在：${relativeView}。`);
  const sourceDefinitions = await fsp.readFile(projectPackage.definitionsPath, 'utf8');
  const updatedPage = {
    ...originalPage,
    path: routePath,
    name: routeChanged ? `${client}-${routePath}` : originalPage.name,
    title: pageTitle,
    view: relativeView,
    section,
    icon,
  };
  const updatedDefinitions = replacePageDefinition(sourceDefinitions, client, originalPath, updatedPage);
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
    originalViewPath,
  );

  await withFileRollback([projectPackage.definitionsPath, targetPath, originalViewPath], async () => {
    if (routeChanged) {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.copyFile(originalViewPath, targetPath);
      if (await isPackageViewPath(projectPackage, originalViewPath))
        await fsp.rm(originalViewPath, { force: true });
    }
    await writeDefinitions(projectPackage.definitionsPath, updatedDefinitions);
  });
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
  const pagePath = String(target.pagePath || '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  const page = clientDefinition?.pages.find((item) => item.path === pagePath);
  if (!clientDefinition || !page) throw new Error(`找不到要删除的路由：${client}/${pagePath}。`);
  const manifestClient = projectPackage.manifest.clients?.find((item) => item.id === client);
  if (manifestClient?.defaultPage === page.path)
    throw new Error('当前页面是客户端默认页面，请先在项目配置中更换默认页面。');
  const sourceKind = page.sourceType === 'html-template' ? 'html' : 'vue';
  const sourcePath =
    sourceKind === 'html'
      ? await managedHtmlPathForPage(projectPackage, { ...page, client }, { mustExist: true })
      : await resolveProjectViewPath(projectRoot, projectPackage, page.view);
  const sourceDefinitions = await fsp.readFile(projectPackage.definitionsPath, 'utf8');
  const updatedDefinitions = removePageDefinition(sourceDefinitions, client, page.path);
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
    sourceKind,
  );
  await withFileRollback([projectPackage.definitionsPath, sourcePath], async () => {
    await writeDefinitions(projectPackage.definitionsPath, updatedDefinitions);
    if (sourceKind === 'html' || (await isPackageViewPath(projectPackage, sourcePath)))
      await fsp.rm(sourcePath, { force: true });
  });
  return {
    backupId: backup.id,
    routePath: `/p/${target.projectId}/${client}/${page.path}`,
    requiresReload: true,
  };
}

export async function restoreProjectRoute({ projectRoot, target, mounts = {} }) {
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  if (!/^[a-zA-Z0-9_-]+$/.test(String(target.backupId || ''))) throw new Error('备份 ID 无效。');
  const metadataPath = await resolveExistingPathInsideRoot(
    projectPackage.packageRoot,
    path.posix.join('.backups', 'pages', target.backupId, 'metadata.json'),
    { allowedExtensions: new Set(['.json']) },
  );
  if (!metadataPath) throw new Error('页面备份不存在或路径不安全。');
  const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
  if (metadata.restoredAt) throw new Error('该备份已经还原。');
  const clientDefinition = projectPackage.definitions[metadata.client];
  if (!clientDefinition) throw new Error(`客户端不存在：${metadata.client}。`);
  const original = metadata.original;
  const replacement = metadata.replacement || null;
  if (
    clientDefinition.pages.some(
      (page) => page.path === original.path && (!replacement || page.path !== replacement.path),
    )
  ) {
    throw new Error(`原路由已存在：${metadata.client}/${original.path}。`);
  }
  if (replacement) {
    const activeReplacement = clientDefinition.pages.find((page) => page.path === replacement.path);
    if (!activeReplacement) throw new Error('找不到被替换后的当前页面，无法自动恢复。');
  } else if (clientDefinition.pages.some((page) => page.path === original.path)) {
    throw new Error(`原路由已存在：${metadata.client}/${original.path}。`);
  }
  const sourceDefinitions = await fsp.readFile(projectPackage.definitionsPath, 'utf8');
  let updatedDefinitions = sourceDefinitions;
  if (replacement)
    updatedDefinitions = removePageDefinition(updatedDefinitions, metadata.client, replacement.path);
  updatedDefinitions = insertPageDefinition(updatedDefinitions, metadata.client, original);
  const sourceKind = metadata.sourceKind || (original.sourceType === 'html-template' ? 'html' : 'vue');
  const backupSourcePath = await resolveExistingPathInsideRoot(
    projectPackage.packageRoot,
    path.posix.join('.backups', 'pages', target.backupId, sourceKind === 'html' ? 'page.html' : 'page.vue'),
    { allowedExtensions: new Set(['.html', '.vue']) },
  );
  if (!backupSourcePath) throw new Error('备份文件缺失或路径不安全，无法还原。');
  const restoredSourcePath =
    sourceKind === 'html'
      ? await managedHtmlPathForPage(projectPackage, { ...original, client: metadata.client })
      : await resolvePackageViewWritePath(projectPackage, original.view);
  const replacementViewPath = replacement?.view
    ? await resolveExistingPathInsideRoot(path.join(projectPackage.packageRoot, 'views'), replacement.view, {
        allowedExtensions: new Set(['.vue']),
      })
    : null;
  const replacementHtmlPath =
    replacement?.sourceType === 'html-template'
      ? await managedHtmlPathForPage(
          projectPackage,
          { ...replacement, client: metadata.client },
          { mustExist: true },
        )
      : null;
  await withFileRollback(
    [
      projectPackage.definitionsPath,
      restoredSourcePath,
      replacementViewPath,
      replacementHtmlPath,
      metadataPath,
    ],
    async () => {
      await fsp.mkdir(path.dirname(restoredSourcePath), { recursive: true });
      await fsp.copyFile(backupSourcePath, restoredSourcePath);
      await writeDefinitions(projectPackage.definitionsPath, updatedDefinitions);
      if (
        replacementViewPath &&
        replacementViewPath !== restoredSourcePath &&
        (await isPackageViewPath(projectPackage, replacementViewPath))
      )
        await fsp.rm(replacementViewPath, { force: true });
      if (replacementHtmlPath && replacementHtmlPath !== restoredSourcePath)
        await fsp.rm(replacementHtmlPath, { force: true });
      metadata.restoredAt = new Date().toISOString();
      await writeJsonAtomic(metadataPath, metadata);
    },
  );
  return { routePath: `/p/${target.projectId}/${metadata.client}/${original.path}`, requiresReload: true };
}

export async function importPage({ projectRoot, source, target, mounts = {} }) {
  const inspection = inspectHtml(source);
  if (!inspection.valid) {
    const error = new Error('HTML 模板校验未通过。');
    error.details = inspection;
    throw error;
  }

  const manifest = inspection.manifest;
  const projectPackage = await loadProjectPackage(projectRoot, target.projectId, mounts);
  const client = target.client || manifest.client;
  const definitionsPath = projectPackage.definitionsPath;
  const clientDefinition = projectPackage.definitions[client];
  if (!clientDefinition) throw new Error(`项目 ${projectPackage.projectId} 不存在客户端：${client}。`);
  const mode = target.mode === 'replace' ? 'replace' : 'create';
  const useManagedHtml = target.runtime === 'html' && inspection.format === 'html-template';
  const originalPage =
    mode === 'replace'
      ? clientDefinition.pages.find(
          (page) => page.path === String(target.replacePagePath || '').replace(/^\/+/, ''),
        )
      : null;
  if (mode === 'replace' && !originalPage) throw new Error('请选择要替换的现有页面。');
  const routePath = parseRoutePath(manifest, target.routePath || originalPage?.path);
  const section = target.menuSection || manifest.menuSection;
  const icon = target.menuIcon || manifest.menuIcon || originalPage?.icon || 'Document';
  const pageTitle = String(target.pageTitle || manifest.pageTitle).trim();
  const menuTitle = String(target.menuTitle || manifest.menuTitle || originalPage?.title || pageTitle).trim();
  const fileName = normalizeHtmlFileName(
    target.fileName ||
      (mode === 'replace'
        ? originalPage?.prototype?.fileName ||
          originalPage?.prototype?.htmlFileName ||
          originalPage?.prototype?.sourceFile
        : '') ||
      target.sourceFile ||
      manifest.fileName ||
      pageTitle,
    `${client}-${routePath}.html`,
  );
  const manifestClient = projectPackage.manifest.clients?.find((item) => item.id === client);
  if (
    mode === 'replace' &&
    manifestClient?.defaultPage === originalPage.path &&
    routePath !== originalPage.path
  ) {
    throw new Error('默认页面不允许在替换时更换路由片段，请先在项目配置中调整默认页面。');
  }
  const componentName = `${toPascalCase(routePath)}View`;
  const relativeView = `${client}/${componentName}.vue`;
  const managedSource = useManagedHtml
    ? await resolveManagedHtmlPath(projectPackage, client, fileName)
    : null;
  const targetPath = useManagedHtml
    ? managedSource.target
    : await resolvePackageViewWritePath(projectPackage, relativeView);
  const duplicate = clientDefinition.pages.find(
    (page) => page.path === routePath || page.name === `${client}-${routePath}` || page.view === relativeView,
  );

  if (
    (mode === 'create' && duplicate) ||
    (mode === 'replace' && duplicate && duplicate.path !== originalPage.path)
  ) {
    throw new Error(`目标页面已存在：${clientDefinition.basePath}/${routePath}。请更换路由或先处理冲突。`);
  }
  const originalHtmlPath =
    originalPage?.sourceType === 'html-template'
      ? await managedHtmlPathForPage(projectPackage, { ...originalPage, client }, { mustExist: true })
      : null;
  if (
    fs.existsSync(targetPath) &&
    (!originalPage || (useManagedHtml ? originalHtmlPath !== targetPath : originalPage.view !== relativeView))
  ) {
    throw new Error(`页面文件已存在：${relativeView}。请更换路由或先处理冲突。`);
  }
  if (!clientDefinition.sections.some((item) => item.id === section)) {
    throw new Error(`菜单分组不存在：${section}。`);
  }
  if (!allowedIcons.has(icon)) throw new Error(`不支持的菜单图标：${icon}。`);

  const sourceDefinitions = await fsp.readFile(definitionsPath, 'utf8');
  const definition = {
    ...(originalPage || {}),
    path: routePath,
    name: originalPage && routePath === originalPage.path ? originalPage.name : `${client}-${routePath}`,
    title: menuTitle,
    section,
    icon,
    ...(useManagedHtml ? { sourceType: 'html-template', source: fileName } : { view: relativeView }),
    ...(!useManagedHtml
      ? { source: inspection.roundTrip && inspection.format === 'vue-sfc' ? 'html-export' : 'html-template' }
      : {}),
    prototype: {
      ...(originalPage?.prototype || {}),
      ...(target.sourceFile ? { sourceFile: target.sourceFile } : {}),
      fileName,
      templateVersion: manifest.templateVersion,
      ...(manifest.scriptMode ? { scriptMode: manifest.scriptMode } : {}),
      ...(inspection.format === 'vue-sfc' ? { exportFormat: manifest.exportFormat } : {}),
      pageKey: manifest.pageKey,
      pageTitle: manifest.pageTitle,
      pageType: manifest.pageType || 'custom',
      pageHeaderMode: manifest.pageHeaderMode || 'standard',
      ...(typeof manifest.menu === 'boolean' ? { menu: manifest.menu } : {}),
    },
  };
  if (useManagedHtml) delete definition.view;
  else delete definition.sourceType;
  const updatedDefinitions =
    mode === 'replace'
      ? replacePageDefinition(sourceDefinitions, client, originalPage.path, definition)
      : insertPageDefinition(sourceDefinitions, client, definition);
  const vueSource = useManagedHtml
    ? null
    : await prettier.format(
        inspection.roundTrip
          ? extractExportSource(source)
          : buildVueSource(source, manifest, projectPackage.manifest.theme || {}),
        { parser: 'vue' },
      );
  const originalViewPath = originalPage
    ? originalPage.view
      ? await resolveProjectViewPath(projectRoot, projectPackage, originalPage.view)
      : null
    : null;
  const originalSourcePath = originalHtmlPath || originalViewPath;
  const originalSourceKind = originalHtmlPath ? 'html' : 'vue';
  const backup =
    mode === 'replace'
      ? await createPageBackup(
          projectPackage,
          {
            schemaVersion: 1,
            type: 'replaced',
            createdAt: new Date().toISOString(),
            projectId: projectPackage.projectId,
            client,
            original: originalPage,
            replacement: definition,
          },
          originalSourcePath,
          originalSourceKind,
        )
      : null;

  await withFileRollback([targetPath, originalSourcePath, definitionsPath], async () => {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await writeFileAtomic(targetPath, useManagedHtml ? source : vueSource, { encoding: 'utf8' });
    if (
      mode === 'replace' &&
      originalSourcePath &&
      originalSourcePath !== targetPath &&
      ((await isPackageViewPath(projectPackage, originalSourcePath)) || originalHtmlPath)
    ) {
      await fsp.rm(originalSourcePath, { force: true });
    }
    await writeDefinitions(definitionsPath, updatedDefinitions);
  });

  return {
    pageKey: manifest.pageKey,
    projectId: projectPackage.projectId,
    routePath: `/p/${projectPackage.projectId}/${client}/${routePath}`,
    ...(useManagedHtml
      ? {
          sourceType: 'html-template',
          source: `projects/${projectPackage.projectId}/html-pages/${client}/${fileName}`,
        }
      : { view: `projects/${projectPackage.projectId}/views/${relativeView}` }),
    menuTitle,
    mode,
    backupId: backup?.id || null,
    sourceType: useManagedHtml
      ? 'html-template'
      : inspection.roundTrip && inspection.format === 'vue-sfc'
        ? 'html-export'
        : 'html-template',
    requiresReload: true,
  };
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let output = '';
    let errorOutput = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(output);
      reject(new Error((errorOutput || output || `命令执行失败，退出码 ${code}`).trim()));
    });
  });
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function relativeModuleImport(fromDirectory, targetPath) {
  const relativePath = toPosixPath(path.relative(fromDirectory, targetPath));
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
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
  if (!/\.html?$/i.test(fileName)) fileName = `${fileName}.html`;
  return fileName;
}

function pageFileName(page) {
  const fallback = `${page.client || 'page'}-${page.path || 'page'}.html`;
  const candidate =
    page.prototype?.fileName ||
    page.prototype?.htmlFileName ||
    page.htmlFileName ||
    page.fileName ||
    page.title ||
    page.name ||
    fallback;
  return normalizeHtmlFileName(candidate, fallback);
}

function uniquePageFileNames(pages) {
  const usedNames = new Set();
  return pages.map((page) => {
    const preferredName = pageFileName(page);
    const extensionMatch = preferredName.match(/(\.html?)$/i);
    const extension = extensionMatch?.[1] || '.html';
    const baseName = preferredName.slice(0, -extension.length);
    let fileName = preferredName;
    let suffix = 2;
    while (usedNames.has(fileName.toLowerCase())) {
      const disambiguator = page.client || page.path || 'page';
      fileName = normalizeHtmlFileName(`${baseName}-${disambiguator}-${suffix}${extension}`, preferredName);
      suffix += 1;
    }
    usedNames.add(fileName.toLowerCase());
    return { ...page, file: fileName };
  });
}

function configuredPrototypeSources(packageRoot, manifest) {
  const prototype = manifest.prototype || {};
  const configuredClients = prototype.clients;
  const entries = Array.isArray(configuredClients)
    ? configuredClients.map((item) => [item?.clientId || item?.id, item])
    : configuredClients && typeof configuredClients === 'object'
      ? Object.entries(configuredClients)
      : [];

  if (entries.length) {
    return entries
      .map(([clientId, item]) => ({
        clientId: String(item?.clientId || clientId || '').trim(),
        root: item?.root ? path.resolve(packageRoot, item.root) : '',
        enabled: item?.enabled !== false,
      }))
      .filter((item) => item.enabled && item.root);
  }

  const roots = [];
  if (prototype.enabled && prototype.root) roots.push(path.resolve(packageRoot, prototype.root));
  if (manifest.docs?.root) {
    const docsRoot = path.resolve(packageRoot, manifest.docs.root);
    roots.push(path.resolve(path.dirname(docsRoot), '原型'));
  }
  return [...new Set(roots)].map((root) => ({
    clientId: String(prototype.client || '').trim(),
    root,
    enabled: true,
  }));
}

function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function walkHtmlFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (['node_modules', 'dist', 'exports'].includes(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (/\.html?$/i.test(entry.name)) {
        files.push(absolutePath);
      }
    }
  }
  await visit(root);
  return files;
}

function absolutePathKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function createPrototypeSourceIndex(projectPackage, pages) {
  const requestedClients = new Set(
    pages.filter((page) => page.prototype?.sourceFile).map((page) => page.client),
  );
  if (!requestedClients.size) return [];

  const sources = configuredPrototypeSources(projectPackage.packageRoot, projectPackage.manifest).filter(
    (item) => !item.clientId || requestedClients.has(item.clientId),
  );
  const indexedSources = [];
  for (const source of sources) {
    const files = await walkHtmlFiles(source.root);
    const filesByName = new Map();
    for (const absolutePath of files) {
      const key = path.basename(absolutePath).toLowerCase();
      const candidates = filesByName.get(key) || [];
      candidates.push(absolutePath);
      filesByName.set(key, candidates);
    }
    indexedSources.push({ ...source, filesByName });
  }
  return indexedSources;
}

async function findPrototypeHtmlSource(projectPackage, page, sourceIndex) {
  if (!page.prototype?.sourceFile) return null;
  const sourceFile = String(page.prototype.sourceFile).trim();
  if (!sourceFile) return null;
  const expectedName = path.basename(sourceFile).toLowerCase();
  const sources = sourceIndex.filter((item) => !item.clientId || item.clientId === page.client);

  for (const source of sources) {
    const directPath = await resolveExistingPathInsideRoot(source.root, sourceFile, {
      allowedExtensions: new Set(['.html', '.htm']),
    });
    if (directPath) {
      return { absolutePath: directPath, root: source.root, source: await fsp.readFile(directPath, 'utf8') };
    }
    const candidates = source.filesByName.get(expectedName) || [];
    if (candidates.length === 1) {
      return {
        absolutePath: candidates[0],
        root: source.root,
        source: await fsp.readFile(candidates[0], 'utf8'),
      };
    }
    if (candidates.length > 1) {
      const client = projectPackage.manifest.clients?.find((item) => item.id === page.client);
      const clientKeys = [client?.id, client?.name, client?.shortName].filter(Boolean).map((value) =>
        String(value)
          .replace(/[^\p{L}\p{N}]+/gu, '')
          .toLowerCase(),
      );
      const matched = candidates.find((absolutePath) => {
        const relative = path.relative(source.root, absolutePath);
        const segments = relative
          .split(path.sep)
          .map((segment) => segment.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase());
        return segments.some((segment) => clientKeys.includes(segment));
      });
      if (matched) {
        return { absolutePath: matched, root: source.root, source: await fsp.readFile(matched, 'utf8') };
      }
    }
  }
  return null;
}

async function findManagedHtmlSource(projectPackage, page) {
  if (page?.sourceType !== 'html-template' || !page.source) return null;
  const managed = await resolveManagedHtmlPath(projectPackage, page.client, page.source, {
    mustExist: true,
  }).catch(() => null);
  if (!managed) return null;
  return {
    absolutePath: managed.target,
    root: managed.root,
    source: await fsp.readFile(managed.target, 'utf8'),
  };
}

async function findCatalogHtmlSource(projectPackage, page) {
  if (page?.sourceType !== 'html-direct' || !page.source) return null;
  const sources = configuredPrototypeSources(projectPackage.packageRoot, projectPackage.manifest).filter(
    (item) => !item.clientId || item.clientId === page.client,
  );
  for (const source of sources) {
    const candidate = await resolveExistingPathInsideRoot(source.root, page.source, {
      allowedExtensions: new Set(['.html', '.htm']),
    });
    if (!candidate) continue;
    return {
      absolutePath: candidate,
      root: source.root,
      source: await fsp.readFile(candidate, 'utf8'),
    };
  }
  return null;
}

function createPrototypeLinkIndex(selectedPages, sourceRecords) {
  const byAbsolutePath = new Map();
  const byClientFileName = new Map();
  const byFileName = new Map();
  for (const page of selectedPages) {
    const record = sourceRecords.get(page.file);
    if (!record) continue;
    byAbsolutePath.set(absolutePathKey(record.absolutePath), page.file);
    const fileName = path.basename(record.absolutePath).toLowerCase();
    const clientKey = `${page.client}:${fileName}`;
    byClientFileName.set(clientKey, [...(byClientFileName.get(clientKey) || []), page.file]);
    byFileName.set(fileName, [...(byFileName.get(fileName) || []), page.file]);
  }
  return { byAbsolutePath, byClientFileName, byFileName };
}

function rewritePrototypeLinks(source, page, selectedPages, sourceRecords) {
  const currentRecord = sourceRecords.get(page.file);
  if (!currentRecord) return String(source || '');
  const linkIndex = createPrototypeLinkIndex(selectedPages, sourceRecords);

  const rewrite = (value) => {
    const match = String(value || '').match(/^([^?#]*)([?#].*)?$/);
    const pathname = match?.[1] || '';
    const suffix = match?.[2] || '';
    if (!/\.html?$/i.test(pathname) || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(pathname)) {
      return value;
    }
    let decodedPath = pathname;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      // Keep malformed URL text unchanged and continue with its literal path.
    }
    const resolvedTarget = decodedPath.startsWith('/')
      ? path.resolve(currentRecord.root, decodedPath.replace(/^\/+/, ''))
      : path.resolve(path.dirname(currentRecord.absolutePath), decodedPath);
    const exactTarget = linkIndex.byAbsolutePath.get(absolutePathKey(resolvedTarget));
    const fileName = path.basename(decodedPath).toLowerCase();
    const clientCandidates = linkIndex.byClientFileName.get(`${page.client}:${fileName}`) || [];
    const globalCandidates = linkIndex.byFileName.get(fileName) || [];
    const target =
      exactTarget ||
      (clientCandidates.length === 1 ? clientCandidates[0] : '') ||
      (globalCandidates.length === 1 ? globalCandidates[0] : '');
    return target ? `./${target}${suffix}` : value;
  };

  return String(source || '')
    .replace(
      /(\b(?:href|formaction)=["'])([^"']+)(["'])/gi,
      (_match, prefix, value, suffix) => `${prefix}${rewrite(value)}${suffix}`,
    )
    .replace(
      /(window\.location(?:\.href)?\s*=\s*["'])([^"']+)(["'])/gi,
      (_match, prefix, value, suffix) => `${prefix}${rewrite(value)}${suffix}`,
    )
    .replace(
      /(window\.location\.(?:assign|replace)\(\s*["'])([^"']+)(["']\s*\))/gi,
      (_match, prefix, value, suffix) => `${prefix}${rewrite(value)}${suffix}`,
    );
}

function createMenuSource(clientDefinition, selectedPages) {
  const iconNames = new Set();
  const sections = clientDefinition.sections
    .map((section) => {
      const items = selectedPages
        .filter((page) => page.section === section.id && page.menu !== false)
        .map((page) => {
          const icon = allowedIcons.has(page.icon) ? page.icon : 'Document';
          iconNames.add(icon);
          return `{ label: ${JSON.stringify(page.title)}, path: ${JSON.stringify(page.fullPath)}, icon: ${icon} }`;
        });
      return items.length
        ? `{ title: ${JSON.stringify(section.title)}, items: [${items.join(', ')}] }`
        : null;
    })
    .filter(Boolean);

  return {
    icons: [...iconNames],
    source: `[${sections.join(', ')}]`,
  };
}

async function writeExportWorkspace({
  workDir,
  projectRoot,
  projectPackage,
  definitions,
  selectedPages,
  bundlePages = selectedPages,
  exportManifest,
  currentPage = bundlePages[0],
}) {
  await fsp.mkdir(workDir, { recursive: true });
  await fsp.writeFile(
    path.join(workDir, 'export-project-config.js'),
    `export const projectConfig = Object.freeze(${JSON.stringify({
      name: projectPackage.manifest.name,
      platformTitle: '项目页面演示',
    })});\n`,
    'utf8',
  );
  const exportProject = {
    id: projectPackage.projectId,
    name: projectPackage.manifest.name,
    shortName: projectPackage.manifest.shortName || projectPackage.manifest.name,
    clients: projectPackage.manifest.clients || [],
  };
  await fsp.writeFile(
    path.join(workDir, 'export-project-packages.js'),
    `const project = Object.freeze(${JSON.stringify(exportProject)});\nexport const installedProjects = Object.freeze([project]);\nexport function getProject(projectId) { return projectId === project.id ? project : null; }\n`,
    'utf8',
  );
  const projectConfigImport = './export-project-config.js';
  const projectPackagesImport = './export-project-packages.js';
  const exportI18nDir = path.join(workDir, 'export-i18n');
  await fsp.mkdir(exportI18nDir, { recursive: true });
  await fsp.writeFile(
    path.join(exportI18nDir, 'index.js'),
    `import { createI18n } from 'vue-i18n';\n\nconst messages = {\n  'zh-CN': {\n    common: { home: '首页', operation: '营运端', enterprise: '企业端', logout: '退出登录' },\n  },\n};\n\nexport const i18n = createI18n({ legacy: false, locale: 'zh-CN', fallbackLocale: 'zh-CN', messages });\nexport const localeOptions = [{ label: '简中', value: 'zh-CN' }];\nexport function setLocale(value) { i18n.global.locale.value = value; }\n`,
    'utf8',
  );
  await fsp.writeFile(
    path.join(exportI18nDir, 'legacy-localizer.js'),
    `export function translateStaticCopy(value) { return value; }\nexport function installLegacyLocalizer() {}\n`,
    'utf8',
  );
  const i18nImport = relativeModuleImport(workDir, path.join(exportI18nDir, 'index.js'));
  const localizerImport = relativeModuleImport(workDir, path.join(exportI18nDir, 'legacy-localizer.js'));
  const appShellSource = `<template>
  <div class="export-shell" :class="{ 'is-topnav': layoutType === 'topnav', 'is-bare': layoutType === 'bare' }">
    <aside v-if="hasSidebar" class="export-sidebar">
      <div class="export-brand" :title="appName">
        <span class="export-brand-mark">{{ appName.slice(0, 1) }}</span>
        <div>
          <strong>{{ appName }}</strong>
          <small>{{ clientName }}</small>
        </div>
      </div>
      <nav class="export-sidebar-nav" aria-label="页面导航">
        <section v-for="section in menus" :key="section.title" class="export-menu-section">
          <h2>{{ section.title }}</h2>
          <a
            v-for="item in section.items"
            :key="item.path"
            :href="exportFileFor(item.path)"
            class="export-menu-item"
            :class="{ 'is-active': route.path === item.path }"
            @click="handleNavigate"
          >
            <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </a>
        </section>
      </nav>
    </aside>
    <main class="export-main">
      <header v-if="hasPlatformTopbar" class="export-topbar">
        <strong>{{ appName }}</strong>
        <span>{{ clientName }}</span>
      </header>
      <div class="export-page-container"><RouterView /></div>
    </main>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const props = defineProps({
  appName: { type: String, default: '页面演示' },
  clientName: { type: String, default: '' },
  layoutType: { type: String, default: 'sidebar' },
  menus: { type: Array, default: () => [] },
});

const route = useRoute();
const appName = computed(() => props.appName);
const clientName = computed(() => props.clientName);
const layoutType = computed(() => props.layoutType);
const menus = computed(() => props.menus);
const hasSidebar = computed(() => !['topnav', 'none', 'bare'].includes(layoutType.value));
const hasPlatformTopbar = computed(() => layoutType.value !== 'bare');

function exportFileFor(target) {
  const normalized = String(target || '').replace(/^\\/+|\\/+$/g, '');
  const entry = window.__PROJECT_EXPORT__?.pages?.find((page) => page.path === normalized || page.routePath === normalized);
  return entry?.file ? './' + entry.file + '#' + normalized : '#' + normalized;
}

function handleNavigate() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<style>
:root {
  --export-primary: var(--app-color-primary, #1677ff);
  --export-surface: var(--app-color-surface, #ffffff);
  --export-page: var(--app-color-page, #f5f7fa);
  --export-text: var(--app-color-text-primary, rgb(0 0 0 / 88%));
  --export-muted: var(--app-color-text-secondary, rgb(0 0 0 / 65%));
  --export-border: var(--app-color-border-light, #f0f0f0);
}

html, body, #app { min-height: 100%; margin: 0; }
body { background: var(--export-page); color: var(--export-text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.export-shell { display: flex; min-height: 100vh; background: var(--export-page); }
.export-shell.is-topnav, .export-shell.is-bare { display: block; }
.export-sidebar { display: flex; width: 240px; flex: 0 0 240px; flex-direction: column; border-right: 1px solid var(--export-border); background: var(--export-surface); }
.export-brand { display: flex; gap: 10px; align-items: center; min-height: 64px; padding: 12px 18px; border-bottom: 1px solid var(--export-border); }
.export-brand-mark { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 8px; background: var(--export-primary); color: #fff; font-weight: 700; }
.export-brand strong, .export-brand small { display: block; }
.export-brand small { margin-top: 3px; color: var(--export-muted); font-size: 12px; }
.export-sidebar-nav { flex: 1; overflow: auto; padding: 14px 10px; }
.export-menu-section + .export-menu-section { margin-top: 14px; }
.export-menu-section h2 { margin: 0 10px 5px; color: var(--export-muted); font-size: 12px; font-weight: 500; }
.export-menu-item { display: flex; gap: 8px; align-items: center; min-height: 36px; padding: 0 10px; border-radius: 6px; color: var(--export-text); text-decoration: none; }
.export-menu-item:hover { background: color-mix(in srgb, var(--export-primary) 8%, transparent); }
.export-menu-item.is-active { background: color-mix(in srgb, var(--export-primary) 14%, transparent); color: var(--export-primary); font-weight: 600; }
.export-main { min-width: 0; flex: 1; }
.export-topbar { display: flex; min-height: 56px; align-items: center; gap: 12px; padding: 0 24px; border-bottom: 1px solid var(--export-border); background: var(--export-surface); }
.export-topbar span { color: var(--export-muted); }
.export-page-container { min-height: calc(100vh - 57px); }
.is-topnav .export-topbar { justify-content: center; }
.is-topnav .export-page-container, .is-bare .export-page-container { min-height: 100vh; }
@media (max-width: 800px) {
  .export-sidebar { width: 200px; flex-basis: 200px; }
  .export-topbar { padding: 0 16px; }
}
</style>
`;
  await fsp.writeFile(
    path.join(workDir, 'PrdReviewPanel.vue'),
    '<template><span class="export-prd-placeholder" aria-hidden="true"></span></template>\n',
    'utf8',
  );
  await fsp.writeFile(
    path.join(workDir, 'PrdAssociationLayer.vue'),
    '<template><span class="export-prd-association-placeholder" aria-hidden="true"></span></template>\n',
    'utf8',
  );
  const exportProjectSourcesImport = './export-project-sources.js';
  await fsp.writeFile(
    path.join(workDir, 'export-project-sources.js'),
    'export async function downloadProjectSource() { return false; }\n',
    'utf8',
  );
  const exportPlatformSettingsImport = './export-platform-settings.js';
  await fsp.writeFile(
    path.join(workDir, 'export-platform-settings.js'),
    `import { reactive } from 'vue';

export const canPersistPlatformSettings = false;
export const platformSettings = reactive({ developerMode: false, loaded: true });
export function loadPlatformSettings() { return Promise.resolve(platformSettings); }
export async function setPlatformDeveloperMode() { return platformSettings; }
`,
    'utf8',
  );
  const exportProjectNavigationImport = './export-project-navigation.js';
  const exportProjectNavigationSource = `
export function normalizePagePath(value) {
  return String(value || '').trim().replace(/^\\/+|\\/+$/g, '');
}
export function getClientDefaultPagePath(client) {
  const pages = Array.isArray(client?.definition?.pages) ? client.definition.pages : [];
  const configured = normalizePagePath(client?.defaultPage);
  if (configured && pages.some((page) => normalizePagePath(page?.path) === configured)) return configured;
  return normalizePagePath(pages.find((page) => page?.menu !== false)?.path || pages[0]?.path || '');
}
export function getProjectClientEntryPath(projectId, client) {
  const root = '/p/' + projectId + '/' + (client?.id || '');
  const page = getClientDefaultPagePath(client);
  return page ? root + '/' + page : root;
}
`;
  await fsp.writeFile(path.join(workDir, 'export-project-navigation.js'), exportProjectNavigationSource, 'utf8');
  await fsp.writeFile(
    path.join(workDir, 'export-router.js'),
    `const projectId = ${JSON.stringify(projectPackage.projectId)};

function exportPath(target) {
  const rawPath = typeof target === 'string' ? target : target?.path || '/';
  const normalizedPath = String(rawPath).startsWith('/') ? String(rawPath) : '/' + rawPath;
  return normalizedPath.startsWith('/p/') ? normalizedPath : '/p/' + projectId + normalizedPath;
}

function exportDestination(target) {
  const routePath = exportPath(target);
  const routeBase = routePath.split(/[?#]/, 1)[0];
  const page = window.__PROJECT_EXPORT__?.pages?.find((entry) => {
    const path = typeof entry === 'string' ? entry : entry?.path;
    return path === routeBase;
  });
  return page && typeof page === 'object' && page.file
    ? './' + page.file + '#' + routePath
    : '#' + routePath;
}

const router = {
  push(target) {
    window.location.href = exportDestination(target);
    return Promise.resolve();
  },
  replace(target) {
    window.location.replace(exportDestination(target));
    return Promise.resolve();
  },
};

export default router;
`,
    'utf8',
  );
  const exportSourceRoot = path.join(workDir, 'export-src');
  await fsp.mkdir(path.join(exportSourceRoot, 'components', 'ui'), { recursive: true });
  await fsp.mkdir(path.join(exportSourceRoot, 'services'), { recursive: true });
  await fsp.writeFile(
    path.join(exportSourceRoot, 'services', 'project-navigation.js'),
    exportProjectNavigationSource,
    'utf8',
  );
  await fsp.mkdir(path.join(exportSourceRoot, 'config'), { recursive: true });
  await fsp.writeFile(path.join(exportSourceRoot, 'config', 'theme.js'), 'export const theme = Object.freeze({});\n', 'utf8');
  await fsp.mkdir(path.join(exportSourceRoot, 'composables'), { recursive: true });
  await fsp.writeFile(
    path.join(exportSourceRoot, 'composables', 'useChartRegistry.js'),
    'export function useChartRegistry() { return { registerChart() {}, unregisterChart() {} }; }\n',
    'utf8',
  );
  await fsp.mkdir(path.join(exportSourceRoot, 'styles'), { recursive: true });
  await fsp.writeFile(
    path.join(exportSourceRoot, 'styles', 'tokens.css'),
    ':root { --app-color-primary: #1677ff; --app-color-page: #f5f7fa; --app-color-surface: #ffffff; --app-color-text-primary: rgb(0 0 0 / 88%); --app-color-text-secondary: rgb(0 0 0 / 65%); --app-color-border-light: #f0f0f0; }\n',
    'utf8',
  );
  await fsp.writeFile(
    path.join(exportSourceRoot, 'styles', 'base.css'),
    '*, *::before, *::after { box-sizing: border-box; } body { margin: 0; }\n',
    'utf8',
  );
  await fsp.mkdir(path.join(exportSourceRoot, 'router'), { recursive: true });
  await fsp.writeFile(
    path.join(exportSourceRoot, 'router', 'index.js'),
    "export { default } from '../../export-router.js';\n",
    'utf8',
  );
  const exportAppShellSource = appShellSource
    .replace("'../config/project.config'", JSON.stringify(projectConfigImport))
    .replace("'../config/project-packages'", JSON.stringify(projectPackagesImport))
    .replace("'../i18n'", JSON.stringify(i18nImport))
    .replace("'../i18n/legacy-localizer'", JSON.stringify(localizerImport))
    .replace("'../services/project-navigation'", JSON.stringify(exportProjectNavigationImport))
    .replace("'../services/project-sources'", JSON.stringify(exportProjectSourcesImport))
    .replace("'../services/platform-settings'", JSON.stringify(exportPlatformSettingsImport));
  await fsp.writeFile(path.join(workDir, 'ExportAppShell.vue'), exportAppShellSource, 'utf8');
  const appShellImport = './ExportAppShell.vue';
  const tokensImport = relativeModuleImport(workDir, path.join(exportSourceRoot, 'styles', 'tokens.css'));
  const baseStyleImport = relativeModuleImport(workDir, path.join(exportSourceRoot, 'styles', 'base.css'));

  const layoutImports = [];
  const routeGroups = [];
  const pageImports = [];
  let pageIndex = 0;

  for (const client of Object.keys(definitions)) {
    const clientPages = selectedPages.filter((page) => page.client === client);
    const bundleClientPages = bundlePages.filter((page) => page.client === client);
    if (!bundleClientPages.length) continue;

    const layoutName = `${toPascalCase(client)}ExportLayout`;
    const layoutFile = `${layoutName}.vue`;
    const menu = createMenuSource(definitions[client], clientPages);
    const iconImport = menu.icons.length
      ? `import { ${menu.icons.join(', ')} } from '@element-plus/icons-vue';\n`
      : '';
    const clientName = projectPackage.manifest.clients?.find((item) => item.id === client)?.name || client;
    const layoutType =
      projectPackage.manifest.clients?.find((item) => item.id === client)?.layout?.type || 'sidebar';
    const layoutSource = `<template>\n  <AppShell project-id="${projectPackage.projectId}" app-name="${String(projectPackage.manifest.name).replaceAll('"', '&quot;')}" client="${client}" client-name="${String(clientName).replaceAll('"', '&quot;')}" layout-type="${layoutType}" :menus="menus" />\n</template>\n\n<script setup>\nimport AppShell from ${JSON.stringify(appShellImport)};\n${iconImport}const menus = ${menu.source};\n</script>\n`;
    await fsp.writeFile(path.join(workDir, layoutFile), layoutSource, 'utf8');
    layoutImports.push(`import ${layoutName} from './${layoutFile}';`);

    const childRoutes = [];
    for (const page of bundleClientPages) {
      const pageVariable = `ExportPage${pageIndex}`;
      pageIndex += 1;
      const viewPath = await resolveProjectViewPath(projectRoot, projectPackage, page.view);
      const viewImport = relativeModuleImport(workDir, viewPath);
      pageImports.push(`import ${pageVariable} from ${JSON.stringify(viewImport)};`);
      childRoutes.push(
        `{ path: ${JSON.stringify(page.path)}, name: ${JSON.stringify(`export-${page.client}-${page.name}`)}, component: ${pageVariable}, meta: { title: ${JSON.stringify(page.title)}, projectId: ${JSON.stringify(projectPackage.projectId)}, clientId: ${JSON.stringify(page.client)}${page.legacy ? ', legacy: true' : ''} } }`,
      );
    }
    routeGroups.push(
      `{ path: ${JSON.stringify(`/p/${projectPackage.projectId}/${client}`)}, component: ${layoutName}, children: [${childRoutes.join(', ')}] }`,
    );
    if (projectPackage.manifest.compatibility?.legacyRoutes) {
      routeGroups.push(
        `{ path: ${JSON.stringify(`/${client}/:legacyPath(.*)*`)}, redirect: (to) => ({ path: ${JSON.stringify(`/p/${projectPackage.projectId}/${client}/`)} + (Array.isArray(to.params.legacyPath) ? to.params.legacyPath.join('/') : String(to.params.legacyPath || '')), query: to.query, hash: to.hash }) }`,
      );
    }
  }

  const defaultPath = currentPage.fullPath;
  const routerSource = `import { createRouter, createWebHashHistory } from 'vue-router';\n${layoutImports.join('\n')}\n${pageImports.join('\n')}\nimport { projectConfig } from ${JSON.stringify(projectConfigImport)};\n\nconst defaultPath = ${JSON.stringify(defaultPath)};\nconst router = createRouter({\n  history: createWebHashHistory(),\n  routes: [${routeGroups.join(', ')}, { path: '/:pathMatch(.*)*', redirect: defaultPath }],\n});\nrouter.afterEach((to) => { document.title = \`${'${to.meta.title || projectConfig.platformTitle}'} - ${'${projectConfig.name}'}\`; });\nexport default router;\n`;
  await fsp.writeFile(path.join(workDir, 'router.js'), routerSource, 'utf8');

  const appSource = `<template>\n  <RouterView />\n</template>\n`;
  await fsp.writeFile(path.join(workDir, 'App.vue'), appSource, 'utf8');

  const mainSource = `import { createApp } from 'vue';\nimport ElementPlus from 'element-plus';\nimport * as ElementPlusIconsVue from '@element-plus/icons-vue';\nimport App from './App.vue';\nimport router from './router.js';\nimport { i18n } from ${JSON.stringify(i18nImport)};\nimport { installLegacyLocalizer } from ${JSON.stringify(localizerImport)};\nimport ${JSON.stringify(tokensImport)};\nimport ${JSON.stringify(baseStyleImport)};\nconst theme = ${JSON.stringify(projectPackage.manifest.theme || {})};\nif (theme.primary) {\n  document.documentElement.style.setProperty('--app-color-primary', theme.primary);\n  const match = theme.primary.match(/^#([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i);\n  if (match) document.documentElement.style.setProperty('--app-color-primary-rgb', match.slice(1).map((value) => Number.parseInt(value, 16)).join(' '));\n}\nif (theme.primaryHover) document.documentElement.style.setProperty('--app-color-primary-hover', theme.primaryHover);\nif (theme.primaryActive) document.documentElement.style.setProperty('--app-color-primary-active', theme.primaryActive);\nif (theme.pageBackground) document.documentElement.style.setProperty('--app-color-page', theme.pageBackground);\nconst app = createApp(App);\nfor (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component);\napp.use(ElementPlus);\napp.use(i18n);\napp.use(router);\napp.mount('#app');\ninstallLegacyLocalizer();\n`;
  await fsp.writeFile(path.join(workDir, 'main.js'), mainSource, 'utf8');

  const htmlSource = `<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <link rel="stylesheet" href="https://unpkg.com/element-plus@2.14.2/dist/index.css" />\n  <script src="https://cdn.tailwindcss.com"></script>\n  <script src="https://unpkg.com/vue@3.5.39/dist/vue.global.prod.js"></script>\n  <script src="https://unpkg.com/vue-router@4.6.4/dist/vue-router.global.prod.js"></script>\n  <script src="https://unpkg.com/vue-i18n@11.4.6/dist/vue-i18n.global.prod.js"></script>\n  <script src="https://unpkg.com/element-plus@2.14.2/dist/index.full.min.js"></script>\n  <script src="https://unpkg.com/@element-plus/icons-vue@2.3.2/dist/index.iife.min.js"></script>\n  <script>window.__PROJECT_EXPORT__=__EXPORT_MANIFEST__;if(!window.location.hash){window.location.hash='#__CURRENT_PATH__';}</script>\n  <title>页面演示</title>\n</head>\n<body>\n  <div id="app"></div>\n  <script type="module" src="./main.js"></script>\n</body>\n</html>\n`;
  await fsp.writeFile(path.join(workDir, 'index.html'), htmlSource, 'utf8');
  await fsp.writeFile(
    path.join(workDir, 'export-source.json'),
    JSON.stringify(exportManifest, null, 2),
    'utf8',
  );
}

function mimeTypeForAsset(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      '.avif': 'image/avif',
      '.gif': 'image/gif',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
    }[extension] || 'application/octet-stream'
  );
}

async function inlineCssAssets(css, cssPath, distDir) {
  const matches = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
  for (const match of matches) {
    const reference = match[2].trim();
    if (!reference || /^(?:data:|https?:|#)/i.test(reference)) continue;
    const cleanReference = reference.split(/[?#]/, 1)[0];
    const assetPath = cleanReference.startsWith('/')
      ? path.resolve(distDir, cleanReference.replace(/^\/+/, ''))
      : path.resolve(path.dirname(cssPath), cleanReference);
    if (!assetPath.startsWith(path.resolve(distDir) + path.sep) || !fs.existsSync(assetPath)) continue;
    const data = await fsp.readFile(assetPath);
    const dataUrl = `data:${mimeTypeForAsset(assetPath)};base64,${data.toString('base64')}`;
    css = css.replace(match[0], `url("${dataUrl}")`);
  }
  return css;
}

async function inlineViteOutput(distDir) {
  let html = await fsp.readFile(path.join(distDir, 'index.html'), 'utf8');
  const styleTags = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)];
  for (const match of styleTags) {
    const href = match[0].match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    if (/^https?:\/\//i.test(href)) continue;
    const cssPath = path.resolve(distDir, href.replace(/^\.\//, ''));
    const css = await inlineCssAssets(await fsp.readFile(cssPath, 'utf8'), cssPath, distDir);
    html = html.replace(match[0], `<style>${css}</style>`);
  }

  const scriptTags = [
    ...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*><\/script>/gi),
  ];
  for (const match of scriptTags) {
    const scriptPath = path.resolve(distDir, match[1].replace(/^\.\//, ''));
    const script = (await fsp.readFile(scriptPath, 'utf8')).replace(/<\/script/gi, '<\\/script');
    html = html.replace(match[0], `<script type="module">${script}</script>`);
  }

  html = html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/gi, '');
  const markupOnly = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join('\n');
  if (/(?:src|href)=["']\.\/assets\//i.test(markupOnly) || /url\(\s*["']?\.\/assets\//i.test(inlineStyles)) {
    throw new Error('单文件构建仍存在外部 assets 引用，已停止导出。');
  }
  return compactExportDocument(html);
}

// Keep the compiled Vue and CSS blocks intact, but remove indentation and blank
// space from the surrounding document so export size is not inflated by the
// generated HTML shell.
function compactExportDocument(source) {
  const protectedBlocks = [];
  const placeholderPrefix = '__EXPORT_BLOCK_';
  const markup = source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    const placeholder = `${placeholderPrefix}${protectedBlocks.length}__`;
    protectedBlocks.push(block);
    return placeholder;
  });
  let compacted = markup
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();

  protectedBlocks.forEach((block, index) => {
    compacted = compacted.replace(`${placeholderPrefix}${index}__`, block);
  });
  return compacted;
}

function materializeExportHtml(baseHtml, manifest, currentPath) {
  const runtimeManifest = { ...manifest, defaultPath: currentPath };
  const serializedManifest = JSON.stringify(runtimeManifest).replaceAll('<', '\\u003c');
  return baseHtml
    .replace('__EXPORT_MANIFEST__', serializedManifest)
    .replaceAll('__CURRENT_PATH__', currentPath);
}

function exportPageKey(page) {
  const raw = String(page.prototype?.pageKey || page.path || 'exported-page')
    .trim()
    .toLowerCase();
  return (
    raw
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-') || 'exported-page'
  );
}

function createRoundTripManifest(page, exportFormat = 'vue-sfc') {
  return {
    templateVersion: 1,
    exportFormat,
    ...(page.prototype?.scriptMode ? { scriptMode: page.prototype.scriptMode } : {}),
    fileName: page.file || pageFileName(page),
    pageKey: exportPageKey(page),
    pageTitle: page.title,
    pageType: page.prototype?.pageType || 'custom',
    pageHeaderMode: page.prototype?.pageHeaderMode || 'standard',
    client: page.client,
    routePath: `/${page.client}/${page.path}`,
    menuSection: page.section || null,
    menuTitle: page.title,
    menuIcon: page.icon || 'Document',
    menu: page.menu !== false,
  };
}

const MANAGED_EXPORT_SCRIPT_IDS = [
  'prototype-page-manifest',
  'prototype-export-config',
  'prototype-editable-template',
  'prototype-editable-script',
  'prototype-editable-style',
];

function escapeHtmlAttribute(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function removeElementById(source, tagName, elementId) {
  const pattern = new RegExp(
    `<${tagName}\\b(?=[^>]*\\bid=["']${escapeRegExp(elementId)}["'])[^>]*>[\\s\\S]*?<\\/${tagName}>\\s*`,
    'gi',
  );
  return String(source || '').replace(pattern, '');
}

function removeManagedExportArtifacts(source) {
  let cleaned = String(source || '');
  for (const scriptId of MANAGED_EXPORT_SCRIPT_IDS) {
    cleaned = removeElementById(cleaned, 'script', scriptId);
  }
  return removeElementById(cleaned, 'style', 'platform-html-content-only');
}

function insertBeforeClosingTag(source, tagName, content) {
  const closingPattern = new RegExp(`<\\/${tagName}>`, 'i');
  if (closingPattern.test(source)) return source.replace(closingPattern, `${content}</${tagName}>`);
  return `${source}${content}`;
}

function buildEditableSourceBlocks(source) {
  const template = extractSfcTag(source, 'template');
  if (!template) return '';
  const script = extractSfcTag(source, 'script');
  const style = extractSfcTag(source, 'style');
  const safe = (value) => String(value || '').replace(/<\/script/gi, '<\\/script');
  const scriptAttributes = script?.attributes || '';
  const styleAttributes = style?.attributes || '';
  const scriptLang = readSfcAttribute(scriptAttributes, 'lang');
  const styleLang = readSfcAttribute(styleAttributes, 'lang');
  const styleModule = /\bmodule\b/i.test(styleAttributes)
    ? readSfcAttribute(styleAttributes, 'module') || 'true'
    : '';
  const templateBlock = `<script id="prototype-editable-template" type="text/plain" data-source-format="vue-sfc-template">
<!-- [AI-EDIT] PAGE_CONTENT_START: 编辑 Vue template 内容；不要修改外围标记。 -->
${safe(template.content)}
<!-- PAGE_CONTENT_END -->
</script>`;
  const scriptBlock = script
    ? `<script id="prototype-editable-script" type="text/plain" data-source-format="vue-sfc-script" data-sfc-setup="${/\bsetup\b/i.test(scriptAttributes)}"${scriptLang ? ` data-sfc-lang="${scriptLang}"` : ''}>
/* [AI-EDIT] PAGE_LOGIC_START: 编辑 Vue script / script setup 内容。 */
${safe(script.content)}
/* PAGE_LOGIC_END */
</script>`
    : '';
  const styleBlock = style
    ? `<script id="prototype-editable-style" type="text/plain" data-source-format="vue-sfc-style" data-sfc-scoped="${/\bscoped\b/i.test(styleAttributes)}"${styleModule ? ` data-sfc-module="${escapeHtmlAttribute(styleModule)}"` : ''}${styleLang ? ` data-sfc-lang="${styleLang}"` : ''}>
/* [AI-EDIT] PAGE_STYLE_START: 编辑页面专属 CSS；选择器应保持页面根类隔离。 */
${safe(style.content)}
/* PAGE_STYLE_END */
</script>`
    : '';
  return `<!--
  PORTABLE HTML PROTOTYPE SOURCE
  编辑 prototype-editable-* 区块后重新导入；prototype-runtime 是生成的运行快照，不要直接修改。
-->
${[templateBlock, scriptBlock, styleBlock].filter(Boolean).join('\n\n')}`;
}

function materializeRoundTripSource(baseHtml, source, manifest) {
  const serializedManifest = JSON.stringify(manifest).replaceAll('<', '\\u003c');
  const manifestScript = `<script id="prototype-page-manifest" type="application/json">${serializedManifest}</script>`;
  const editableSource = buildEditableSourceBlocks(source);
  const cleanedHtml = removeManagedExportArtifacts(baseHtml);
  const withManifest = insertBeforeClosingTag(cleanedHtml, 'head', manifestScript);
  return insertBeforeClosingTag(withManifest, 'body', editableSource);
}

function materializeLightweightHtml({
  source,
  page,
  roundTripSource,
  roundTripManifest,
  exportManifest,
  selectedPages,
  sourceRecords,
}) {
  const rewrittenSource = rewritePrototypeLinks(source, page, selectedPages, sourceRecords);
  const htmlWithSource = materializeRoundTripSource(rewrittenSource, roundTripSource, roundTripManifest);
  const serializedExportManifest = JSON.stringify(exportManifest).replaceAll('<', '\\u003c');
  const exportConfigScript = `<script id="prototype-export-config">window.__PROJECT_EXPORT__=${serializedExportManifest};</script>`;
  return insertBeforeClosingTag(htmlWithSource, 'head', exportConfigScript);
}

async function loadVueExportCompiler() {
  try {
    const [{ default: vuePlugin }, { build: viteBuild }] = await Promise.all([
      import('@vitejs/plugin-vue'),
      import('vite'),
    ]);
    return { vuePlugin, viteBuild };
  } catch (error) {
    const wrapped = new Error(
      `Vue 页面导出需要 Vite 和 @vitejs/plugin-vue，请先执行 npm install。原始错误：${error.message}`,
    );
    wrapped.code = 'VUE_EXPORT_COMPILER_UNAVAILABLE';
    wrapped.cause = error;
    throw wrapped;
  }
}

async function buildExportPage({
  workDir,
  projectRoot,
  projectPackage,
  definitions,
  selectedPages,
  bundlePages,
  currentPage,
  exportManifest,
  compilerLoader = loadVueExportCompiler,
}) {
  const { vuePlugin, viteBuild } = await compilerLoader();
  const distDir = path.join(workDir, 'dist');
  const exportSourceRoot = path.join(workDir, 'export-src');
  await writeExportWorkspace({
    workDir,
    projectRoot,
    projectPackage,
    definitions,
    selectedPages,
    bundlePages,
    currentPage,
    exportManifest,
  });

  await viteBuild({
    root: workDir,
    configFile: false,
    publicDir: false,
    base: './',
    logLevel: 'silent',
    plugins: [vuePlugin()],
    resolve: {
      alias: [
        {
          find: path.resolve(projectRoot, 'src', 'router', 'index.js'),
          replacement: path.join(workDir, 'export-router.js'),
        },
        {
          find: path.resolve(projectRoot, 'src', 'config', 'project-packages.js'),
          replacement: path.join(workDir, 'export-project-packages.js'),
        },
        { find: '@', replacement: exportSourceRoot },
      ],
    },
    css: { postcss: PLATFORM_ROOT },
    build: {
      outDir: distDir,
      emptyOutDir: true,
      minify: 'esbuild',
      sourcemap: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      cssCodeSplit: false,
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        external: (id) => {
          const normalizedId = id.replaceAll('\\\\', '/');
          const externalPackages = [
            'vue',
            'vue-router',
            'vue-i18n',
            'element-plus',
            '@element-plus/icons-vue',
          ];
          return externalPackages.some(
            (packageName) =>
              normalizedId === packageName ||
              normalizedId.startsWith(`${packageName}/`) ||
              normalizedId.includes(`/node_modules/${packageName}/`),
          );
        },
        output: {
          inlineDynamicImports: true,
          format: 'iife',
          name: 'StandalonePrototypePage',
          globals: {
            vue: 'Vue',
            'vue-router': 'VueRouter',
            'vue-i18n': 'VueI18n',
            'element-plus': 'ElementPlus',
            '@element-plus/icons-vue': 'ElementPlusIconsVue',
          },
        },
      },
    },
  });

  return inlineViteOutput(distDir);
}

export async function createExportPackage({
  projectRoot,
  projectId,
  selectedPaths,
  packageName,
  mounts = {},
  compilerLoader = loadVueExportCompiler,
}) {
  const projectPackage = await loadProjectPackage(projectRoot, projectId, mounts);
  const definitions = projectPackage.definitions;
  const htmlPages = await htmlPagesForProject(projectRoot, projectId, mounts);
  const definitionPages = Object.keys(definitions).flatMap((client) =>
    routeDefinitionPages(definitions[client]).map((page) => ({
      ...page,
      client,
      fullPath: `/p/${projectPackage.projectId}/${client}/${page.path}`,
    })),
  );
  const prototypePages = Object.entries(htmlPages).flatMap(([client, pages]) =>
    pages.map((page) => ({
      ...page,
      client,
      fullPath: `/p/${projectPackage.projectId}/${client}/${page.path}`,
    })),
  );
  const allPages = [...definitionPages, ...prototypePages].filter(
    (page, index, pages) => pages.findIndex((candidate) => candidate.fullPath === page.fullPath) === index,
  );
  const selected = allPages.filter((page) => selectedPaths.includes(page.fullPath));
  if (!selected.length) throw new Error('至少选择一个可导出的页面。');
  if (selected.length !== selectedPaths.length) throw new Error('选择的页面中包含未注册路由。');

  const exportId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeName =
    String(packageName || `${projectPackage.manifest.name}-页面演示包`)
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || '页面演示包';
  const exportBoundary = await resolveWritablePathInsideRoot(
    projectRoot,
    path.posix.join('exports', projectPackage.projectId, '.boundary.html'),
    { allowedExtensions: new Set(['.html']) },
  );
  const workBoundary = await resolveWritablePathInsideRoot(
    projectRoot,
    path.posix.join('.page-transfer-work', exportId, '.boundary.json'),
    { allowedExtensions: new Set(['.json']) },
  );
  if (!exportBoundary || !workBoundary) throw new Error('导出目录或临时工作目录路径不安全。');
  const exportsRoot = path.dirname(exportBoundary);
  const workDir = path.dirname(workBoundary);
  await fsp.mkdir(exportsRoot, { recursive: true });

  const selectedWithFiles = uniquePageFileNames(selected);
  const roundTripSources = new Map();
  const sourceRecords = new Map();
  const prototypeSourceIndex = await createPrototypeSourceIndex(projectPackage, selectedWithFiles);
  for (const page of selectedWithFiles) {
    if (!page.view && !['html-template', 'html-direct'].includes(page.sourceType)) {
      throw new Error(`页面“${page.title}”没有 Vue 页面源文件，暂时无法生成可回导 HTML。`);
    }
    if (page.view) {
      const viewPath = await resolveProjectViewPath(projectRoot, projectPackage, page.view);
      const source = await fsp.readFile(viewPath, 'utf8');
      roundTripSources.set(page.file, await prettier.format(source, { parser: 'vue' }));
    }
    const prototypeSource =
      (await findManagedHtmlSource(projectPackage, page)) ||
      (await findCatalogHtmlSource(projectPackage, page)) ||
      (await findPrototypeHtmlSource(projectPackage, page, prototypeSourceIndex));
    if (prototypeSource) sourceRecords.set(page.file, prototypeSource);
  }
  const clients = [...new Set(selectedWithFiles.map((page) => page.client))];
  const exportManifest = {
    schemaVersion: 1,
    type: selected.length === 1 ? 'standalone-html' : 'standalone-html-set',
    generatedAt: new Date().toISOString(),
    projectId: projectPackage.projectId,
    projectName: projectPackage.manifest.name,
    clients,
    pages: selectedWithFiles.map((page) => ({
      path: page.fullPath,
      routePath: page.fullPath,
      name: page.name,
      title: page.title,
      pageKey: page.prototype?.pageKey || page.path,
      pageType: page.prototype?.pageType || 'vue-page',
      pageHeaderMode: page.prototype?.pageHeaderMode || null,
      templateVersion: page.prototype?.templateVersion || null,
      client: page.client,
      menuSection: page.section || null,
      menuTitle: page.title,
      menuIcon: page.icon || null,
      source: page.source || 'vue-page',
      file: page.file,
      fileName: page.file,
    })),
    defaultPath: selectedWithFiles[0].fullPath,
  };

  try {
    const pageBundles = [];
    for (const page of selectedWithFiles) {
      const roundTripSource = roundTripSources.get(page.file);
      const prototypeSource = sourceRecords.get(page.file);
      if (prototypeSource) {
        pageBundles.push({
          page,
          lightweightSource: prototypeSource.source,
          roundTripSource,
          roundTripManifest: createRoundTripManifest(page, 'html-template'),
        });
        continue;
      }
      const pageWorkDir = path.join(workDir, page.file.replace(/\.html$/i, ''));
      let baseHtml;
      try {
        baseHtml = await buildExportPage({
          workDir: pageWorkDir,
          projectRoot,
          projectPackage,
          definitions,
          selectedPages: selectedWithFiles,
          bundlePages: [page],
          currentPage: page,
          exportManifest,
          compilerLoader,
        });
      } catch (error) {
        const wrapped = new Error(`Vue 页面“${page.title}”导出编译失败：${error.message}`);
        wrapped.code = error.code || 'VUE_EXPORT_BUILD_FAILED';
        wrapped.cause = error;
        throw wrapped;
      }
      pageBundles.push({
        page,
        baseHtml,
        roundTripSource,
        roundTripManifest: createRoundTripManifest(page, 'vue-sfc'),
      });
    }

    if (selectedWithFiles.length === 1) {
      const { page, baseHtml, lightweightSource, roundTripManifest, roundTripSource } = pageBundles[0];
      const htmlPath = path.join(exportsRoot, page.file);
      const materializedHtml = lightweightSource
        ? materializeLightweightHtml({
            source: lightweightSource,
            page,
            roundTripSource,
            roundTripManifest,
            exportManifest,
            selectedPages: selectedWithFiles,
            sourceRecords,
          })
        : materializeRoundTripSource(
            materializeExportHtml(baseHtml, exportManifest, page.fullPath),
            roundTripSource,
            roundTripManifest,
          );
      await writeFileAtomic(htmlPath, materializedHtml, { encoding: 'utf8' });
      const relativeHtml = toPosixPath(path.relative(projectRoot, htmlPath));
      return {
        id: exportId,
        mode: 'single',
        preview: `/${relativeHtml}`,
        html: `/${relativeHtml}`,
        zip: null,
        files: [page.file],
        manifest: exportManifest,
      };
    }

    const exportDir = path.join(exportsRoot, `${safeName}-${exportId}`);
    const zipPath = `${exportDir}.zip`;
    try {
      await fsp.mkdir(exportDir, { recursive: true });
      for (const { page, baseHtml, lightweightSource, roundTripManifest, roundTripSource } of pageBundles) {
        const materializedHtml = lightweightSource
          ? materializeLightweightHtml({
              source: lightweightSource,
              page,
              roundTripSource,
              roundTripManifest,
              exportManifest,
              selectedPages: selectedWithFiles,
              sourceRecords,
            })
          : materializeRoundTripSource(
              materializeExportHtml(baseHtml, exportManifest, page.fullPath),
              roundTripSource,
              roundTripManifest,
            );
        await writeFileAtomic(path.join(exportDir, page.file), materializedHtml, { encoding: 'utf8' });
      }

      if (process.platform !== 'win32') throw new Error('当前多页面 ZIP 导出仅支持 Windows 环境。');
      const command = `Compress-Archive -Path ${quotePowerShell(path.join(exportDir, '*'))} -DestinationPath ${quotePowerShell(zipPath)} -Force`;
      await runCommand('powershell.exe', ['-NoProfile', '-Command', command], { cwd: projectRoot });
    } catch (error) {
      await Promise.all([
        fsp.rm(exportDir, { recursive: true, force: true }).catch(() => {}),
        fsp.rm(zipPath, { force: true }).catch(() => {}),
      ]);
      throw error;
    }
    const relativePreview = toPosixPath(
      path.relative(projectRoot, path.join(exportDir, selectedWithFiles[0].file)),
    );
    const relativeZip = toPosixPath(path.relative(projectRoot, zipPath));
    return {
      id: exportId,
      mode: 'multiple',
      preview: `/${relativePreview}`,
      html: null,
      zip: `/${relativeZip}`,
      files: selectedWithFiles.map((page) => page.file),
      manifest: exportManifest,
    };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
    const workRoot = path.dirname(workDir);
    const remainingEntries = await fsp.readdir(workRoot).catch(() => []);
    if (!remainingEntries.length) await fsp.rm(workRoot, { recursive: true, force: true });
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function isLocalRequest(req) {
  const address = req.socket?.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requireLocalRequest(req, res) {
  if (isLocalRequest(req)) return true;
  sendJson(res, 403, { ok: false, error: '页面导入导出仅允许在运行服务的本机使用。' });
  return false;
}

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (raw.length > 12 * 1024 * 1024) throw new Error('请求内容过大。');
  return JSON.parse(raw || '{}');
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.zip')) return 'application/zip';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function contentDispositionFor(filePath) {
  const fileName = path.basename(filePath);
  const fallbackName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\\r\n]/g, '_');
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function resolveExportFile(projectRoot, requestPath) {
  const relativePath = String(requestPath || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  if (!relativePath.startsWith('exports/')) throw new Error('文件路径不在导出目录内。');
  const target = await resolveExistingPathInsideRoot(projectRoot, relativePath, {
    allowedExtensions: new Set(['.html', '.json', '.zip']),
  });
  if (!target) throw new Error('导出文件不存在、越界或类型无效。');
  return target;
}

export function pageTransferPlugin({
  projectRoot = PLATFORM_ROOT,
  loadMounts = async () => ({ projects: {} }),
} = {}) {
  return {
    name: 'page-transfer',
    configureServer(server) {
      server.middlewares.use('/__page-transfer/inspect', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = inspectHtml(body.html);
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(res, 400, {
            ok: false,
            error: error.message,
            details: error.details || null,
            rollback: error.rollback || null,
          });
        }
      });

      server.middlewares.use('/__page-transfer/import', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = await importPage({ projectRoot, source: body.html, target: body.target || {} });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 400, {
            ok: false,
            error: error.message,
            details: error.details || null,
            rollback: error.rollback || null,
          });
        }
      });

      server.middlewares.use('/__page-transfer/routes', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const result = await listProjectRoutes({
            projectRoot,
            projectId: url.searchParams.get('projectId'),
            mounts: await loadMounts(),
          });
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });

      server.middlewares.use('/__page-transfer/route/create', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = await createProjectRoute({ projectRoot, target: body });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });

      server.middlewares.use('/__page-transfer/route/update', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = await updateProjectRoute({ projectRoot, target: body });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });

      server.middlewares.use('/__page-transfer/section/update', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = await updateProjectSections({
            projectRoot,
            target: body,
            mounts: await loadMounts(),
          });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });

      server.middlewares.use('/__page-transfer/route/order', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = await updateProjectRouteOrder({
            projectRoot,
            target: body,
            mounts: await loadMounts(),
          });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });

      server.middlewares.use('/__page-transfer/route/delete', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = await deleteProjectRoute({ projectRoot, target: body });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });

      server.middlewares.use('/__page-transfer/route/restore', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = await restoreProjectRoute({ projectRoot, target: body });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });

      server.middlewares.use('/__page-transfer/section/restore', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = await restoreProjectSections({ projectRoot, target: body });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });

      server.middlewares.use('/__page-transfer/export', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const result = await createExportPackage({
            projectRoot,
            projectId: body.projectId,
            selectedPaths: body.selectedPaths || [],
            packageName: body.packageName,
            mounts: await loadMounts(),
          });
          sendJson(res, 200, { ok: true, result });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });

      server.middlewares.use('/__page-transfer/download', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        if (!requireLocalRequest(req, res)) return;
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const filePath = await resolveExportFile(projectRoot, url.searchParams.get('path'));
          if (!fs.existsSync(filePath)) return next();
          res.statusCode = 200;
          res.setHeader('Content-Type', contentTypeFor(filePath));
          if (filePath.endsWith('.zip') || filePath.endsWith('.html')) {
            res.setHeader('Content-Disposition', contentDispositionFor(filePath));
          }
          fs.createReadStream(filePath).pipe(res);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message, rollback: error.rollback || null });
        }
      });
    },
  };
}
