// @vitest-environment node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildVueSource,
  createExportPackage,
  createProjectRoute,
  importPage,
  inspectHtml,
  listProjectRoutes,
  restoreProjectRoute,
} from '../../packages/platform-transfer/src/index.js';
import { applyContentOnlyMode, scanHtmlPrototypePages } from '../../packages/project-core/src/index.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const temporaryRoots = [];

async function createPlatformFixture() {
  const fixtureParent = path.join(projectRoot, '.test-page-transfer');
  await fs.mkdir(fixtureParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(fixtureParent, 'fixture-'));
  temporaryRoots.push(root);
  const packageRoot = path.join(root, 'projects', 'sample-project');
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, 'project.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'sample-project',
      name: '示例项目',
      pageDefinitions: 'page-definitions.js',
      clients: [{ id: 'admin', name: '管理端', defaultPage: 'home' }],
      entries: [{ id: 'admin', kind: 'client', clientId: 'admin', name: '管理端' }],
      features: { pageTransfer: true },
    }),
    'utf8',
  );
  await fs.writeFile(
    path.join(packageRoot, 'page-definitions.js'),
    `export const clientPageDefinitions = {\n  admin: {\n    sections: [{ id: 'workspace', title: '工作区' }],\n    pages: [\n      // <generator:admin-pages>\n    ],\n  },\n};\n`,
    'utf8',
  );
  return { root, packageRoot };
}

async function createLightweightFixture() {
  const fixture = await createPlatformFixture();
  const prototypeRoot = path.join(fixture.packageRoot, 'prototype');
  await fs.mkdir(prototypeRoot, { recursive: true });
  const projectManifestPath = path.join(fixture.packageRoot, 'project.json');
  const projectManifest = JSON.parse(await fs.readFile(projectManifestPath, 'utf8'));
  projectManifest.prototype = { enabled: true, root: 'prototype', client: 'admin' };
  await fs.writeFile(projectManifestPath, JSON.stringify(projectManifest), 'utf8');
  return { ...fixture, prototypeRoot };
}

function createLightweightHtml({ title, subtitle, link }) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      .lightweight-page { padding: 28px; color: #0f172a; }
      .lightweight-page h1 { margin: 0; font-size: 24px; line-height: 32px; }
      .lightweight-page .subtitle { margin: 8px 0 20px; color: #64748b; font-size: 14px; }
    </style>
  </head>
  <body>
    <div id="app" class="prototype-app">
      <aside class="prototype-sidebar"><a href="${link}">切换页面</a></aside>
      <div class="prototype-workspace">
        <header class="prototype-topbar">示例项目</header>
        <main class="prototype-main">
          <section class="lightweight-page" data-page-content>
            <h1>${title}</h1>
            <p class="subtitle">${subtitle}</p>
            <el-button type="primary" @click="dialogVisible = true">打开弹窗</el-button>
            <el-dialog v-model="dialogVisible" title="页面弹窗">
              <p>弹窗内容</p>
            </el-dialog>
          </section>
        </main>
      </div>
    </div>
    <script src="https://unpkg.com/vue@3.4.21/dist/vue.global.prod.js"></script>
    <script src="https://unpkg.com/element-plus@2.8.0/dist/index.full.min.js"></script>
    <script>
      Vue.createApp({
        setup() {
          const dialogVisible = Vue.ref(false);
          return { dialogVisible };
        },
      }).use(ElementPlus).mount('#app');
    </script>
  </body>
</html>`;
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
  await fs.rm(path.join(projectRoot, '.test-page-transfer'), {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 50,
  });
});

describe('page transfer', () => {
  it('imports an Options API template page without converting its component model', async () => {
    const manifest = {
      templateVersion: 1,
      scriptMode: 'options-api',
      pageKey: 'options-page',
      pageTitle: 'Options 页面',
      pageType: 'list',
      pageHeaderMode: 'standard',
      client: 'admin',
      routePath: '/admin/options-page',
      menuSection: 'workspace',
      menuTitle: 'Options 页面',
      menuIcon: 'Document',
    };
    const source = [
      `<script type="application/json" id="prototype-page-manifest">${JSON.stringify(manifest)}</script>`,
      '<!-- [AI-EDIT] PAGE_CONTENT_START -->',
      '<section data-page-content><div data-business-content>Options 内容</div></section>',
      '<!-- PAGE_CONTENT_END -->',
      '<!-- [AI-EDIT] PAGE_OVERLAYS_START -->',
      '<div data-page-overlay="dialog"><el-dialog v-model="visible">弹窗</el-dialog></div>',
      '<!-- PAGE_OVERLAYS_END -->',
      '<script>/* [AI-EDIT] PAGE_LOGIC_START */\nconst pageOptions = { data() { return { visible: false }; } };\n/* PAGE_LOGIC_END */</script>',
    ].join('\n');
    const { root, packageRoot } = await createPlatformFixture();

    expect(inspectHtml(source)).toMatchObject({ valid: true, format: 'html-template' });
    expect(buildVueSource(source, manifest)).toContain('export default pageOptions;');
    await importPage({
      projectRoot: root,
      source,
      target: {
        projectId: 'sample-project',
        client: 'admin',
        routePath: 'options-page',
        menuSection: 'workspace',
        menuTitle: 'Options 页面',
      },
    });
    expect(
      await fs.readFile(path.join(packageRoot, 'views', 'admin', 'OptionsPageView.vue'), 'utf8'),
    ).toContain('export default pageOptions;');
  });

  it('keeps Element Plus icon imports separate and maps imported primary colors to the project theme', () => {
    const manifest = {
      templateVersion: 1,
      scriptMode: 'composition-api',
      pageKey: 'themed-page',
      pageTitle: '主题页面',
      pageType: 'custom',
      pageHeaderMode: 'standard',
      client: 'admin',
      routePath: '/admin/themed-page',
      menuSection: 'workspace',
      menuTitle: '主题页面',
      menuIcon: 'Document',
    };
    const source = [
      `<style data-page-style>:root { --app-color-primary: #00689E; --app-color-primary-hover: #005B8A; --app-color-primary-active: #004F78; } .page { color: #00689E; }</style>`,
      '<!-- [AI-EDIT] PAGE_CONTENT_START -->',
      '<section data-page-content><el-button color="#00689E"><Plus /></el-button></section>',
      '<!-- PAGE_CONTENT_END -->',
      '<!-- [AI-EDIT] PAGE_OVERLAYS_START -->',
      '<div data-page-overlay="dialog"></div>',
      '<!-- PAGE_OVERLAYS_END -->',
      '<script>/* [AI-EDIT] PAGE_LOGIC_START */\nfunction pageSetup() {\n  const { createApp } = Vue;\n  const { Plus, Refresh } = ElementPlusIconsVue;\n  const { ElMessage } = ElementPlus;\n  const statusIcon = "Refresh";\n  return { createApp, ElMessage, statusIcon };\n}\n/* PAGE_LOGIC_END */</script>',
    ].join('\n');

    const generated = buildVueSource(source, manifest, {
      primary: '#ba00c3',
      primaryHover: '#a700b0',
      primaryActive: '#8c0092',
    });

    expect(generated).toContain("import { ElMessage } from 'element-plus';");
    expect(generated).not.toContain("import { Plus } from '@element-plus/icons-vue';");
    expect(generated).not.toMatch(/import\s+\{\s*Plus\s*\}\s+from\s+['"]element-plus['"]/u);
    expect(generated).not.toContain('IconsVue;');
    expect(generated).toContain('color="#ba00c3"');
    expect(generated).toContain('--app-color-primary: #ba00c3;');
    expect(generated).not.toContain('#00689E');
  });

  it('imports a valid HTML template into the selected project package', async () => {
    const source = await fs.readFile(path.join(projectRoot, 'templates', 'html-prototype-page.html'), 'utf8');
    expect(inspectHtml(source)).toMatchObject({ valid: true, warnings: [] });
    const { root, packageRoot } = await createPlatformFixture();

    const result = await importPage({
      projectRoot: root,
      source,
      target: {
        projectId: 'sample-project',
        client: 'admin',
        routePath: 'imported-page',
        menuSection: 'workspace',
        menuTitle: '导入页面',
        sourceFile: 'prototype.html',
        fileName: '客户等级方案.html',
      },
    });

    expect(result.routePath).toBe('/p/sample-project/admin/imported-page');
    const generatedView = path.join(packageRoot, 'views', 'admin', 'ImportedPageView.vue');
    expect(await fs.readFile(generatedView, 'utf8')).toContain('<style scoped>');
    expect(await fs.readFile(path.join(packageRoot, 'page-definitions.js'), 'utf8')).toContain(
      '"path":"imported-page"',
    );
    expect(await fs.readFile(path.join(packageRoot, 'page-definitions.js'), 'utf8')).toContain(
      '"fileName":"客户等级方案.html"',
    );
  });

  it('keeps React runtime HTML imports in a managed source directory and exports them again', async () => {
    const source = await fs.readFile(path.join(projectRoot, 'templates', 'html-prototype-page.html'), 'utf8');
    const { root, packageRoot } = await createPlatformFixture();

    const result = await importPage({
      projectRoot: root,
      source,
      target: {
        projectId: 'sample-project',
        client: 'admin',
        routePath: 'managed-page',
        menuSection: 'workspace',
        menuTitle: '托管页面',
        menuIcon: 'Document',
        fileName: 'managed-page.html',
        sourceFile: 'managed-page.html',
        runtime: 'html',
      },
    });

    expect(result).toMatchObject({ sourceType: 'html-template', mode: 'create' });
    const managedPath = path.join(packageRoot, 'html-pages', 'admin', 'managed-page.html');
    expect(await fs.readFile(managedPath, 'utf8')).toBe(source);

    const catalog = await scanHtmlPrototypePages(path.join(root, 'projects'));
    expect(catalog.projects['sample-project'].admin).toHaveLength(1);
    expect(catalog.projects['sample-project'].admin[0]).toMatchObject({
      path: 'managed-page',
      sourceType: 'html-template',
      source: 'managed-page.html',
    });

    const replacement = await importPage({
      projectRoot: root,
      source: source.replace('页面标题', '替换后的页面标题'),
      target: {
        projectId: 'sample-project',
        client: 'admin',
        mode: 'replace',
        replacePagePath: 'managed-page',
        routePath: 'managed-page',
        menuSection: 'workspace',
        menuTitle: '托管页面',
        menuIcon: 'Document',
        fileName: 'managed-page.html',
        runtime: 'html',
      },
    });
    expect(replacement.backupId).toBeTruthy();
    await restoreProjectRoute({
      projectRoot: root,
      target: { projectId: 'sample-project', backupId: replacement.backupId },
    });
    expect(await fs.readFile(managedPath, 'utf8')).toBe(source);
    const restoredMetadata = JSON.parse(
      await fs.readFile(
        path.join(packageRoot, '.backups', 'pages', replacement.backupId, 'metadata.json'),
        'utf8',
      ),
    );
    expect(restoredMetadata.restoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    await expect(
      restoreProjectRoute({
        projectRoot: root,
        target: { projectId: 'sample-project', backupId: replacement.backupId },
      }),
    ).rejects.toThrow('该备份已经还原。');

    const routes = await listProjectRoutes({ projectRoot: root, projectId: 'sample-project' });
    expect(routes.clients[0].pages).toHaveLength(1);
    expect(routes.clients[0].pages[0]).toMatchObject({ path: 'managed-page', sourceType: 'html-template' });

    const exported = await createExportPackage({
      projectRoot: root,
      projectId: 'sample-project',
      selectedPaths: ['/p/sample-project/admin/managed-page'],
      packageName: '托管页面闭环测试',
    });
    const exportedHtml = await fs.readFile(path.join(root, exported.html.replace(/^\//u, '')), 'utf8');
    expect(inspectHtml(exportedHtml)).toMatchObject({ valid: true, format: 'html-template' });
    expect(exportedHtml).toContain('managed-page');
  });

  it('creates React route placeholders as reusable managed HTML pages', async () => {
    const { root, packageRoot } = await createPlatformFixture();

    const result = await createProjectRoute({
      projectRoot: root,
      target: {
        projectId: 'sample-project',
        client: 'admin',
        routePath: 'new-route',
        pageTitle: '新增页面',
        menuSection: 'workspace',
        menuIcon: 'Document',
        runtime: 'html',
      },
    });

    expect(result.page).toMatchObject({
      path: 'new-route',
      sourceType: 'html-template',
      source: '新增页面.html',
    });
    const source = await fs.readFile(path.join(packageRoot, 'html-pages', 'admin', '新增页面.html'), 'utf8');
    expect(inspectHtml(source)).toMatchObject({ valid: true, format: 'html-template' });

    const catalog = await scanHtmlPrototypePages(path.join(root, 'projects'));
    expect(catalog.projects['sample-project'].admin[0]).toMatchObject({
      path: 'new-route',
      title: '新增页面',
      sourceType: 'html-template',
    });
  });

  it('keeps the HTML template AI contract and page identity synchronized', async () => {
    const source = await fs.readFile(path.join(projectRoot, 'templates', 'html-prototype-page.html'), 'utf8');
    const manifestSource = source.match(
      /<script\b[^>]*\bid=["']prototype-page-manifest["'][^>]*>([\s\S]*?)<\/script>/u,
    )?.[1];
    if (!manifestSource) throw new Error('模板缺少 prototype-page-manifest。');
    const manifest = JSON.parse(manifestSource.trim());
    const htmlWithoutComments = source.replace(/<!--[\s\S]*?-->/gu, '');

    expect(source).toContain('HTML 原型 AI 编写协议 v1.9');
    expect(source).toContain('以本模板作为唯一的结构与实现基准');
    expect(source).toContain('可将本模板复制为多个 HTML 文件组成多页面原型');
    expect(source).toContain('<!-- PROTOTYPE_AI_PROTOCOL_START -->');
    expect(source).toContain('<!-- PROTOTYPE_AI_PROTOCOL_END -->');
    expect(source).toContain('协议标题和全部正文必须完整保留');
    expect(source).toContain('现有内容只是一个可运行示例');
    expect(source).toContain('可以删除并完整替换');
    expect(source).toContain('一级列表页、二级详情页、二级新增/编辑页');
    expect(source).toContain('data-page-header 只能保留返回入口');
    expect(source).toContain('返回入口后直接进入表单或流程内容');
    expect(source).toContain('删除模板演示切换器、其余示例分支');
    expect(source).toContain('class="template-demo-switch"');
    expect(source).toContain("{ label: '一级列表', value: 'primary' }");
    expect(source).toContain("{ label: '二级详情', value: 'detail' }");
    expect(source).toContain("{ label: '二级新增/编辑', value: 'form' }");
    expect(source).toContain('data-page-header="back-only"');
    expect(source).toContain('class="secondary-object-summary"');
    expect(source).toContain('class="secondary-form-layout"');
    expect(source).toContain('<!-- [AI-EDIT] THEME_TOKENS_START:');
    expect(source).toContain('<!-- THEME_TOKENS_END -->');
    expect(source).toContain('--app-color-primary: #007aff;');
    expect(source).toContain('--app-color-sidebar: rgb(246 247 249 / 94%);');
    expect(source).toContain('background: var(--app-color-sidebar);');
    expect(source).toMatch(
      /\.prototype-menu-item\.is-active\s*\{[^}]*color:\s*var\(--app-color-primary\);[^}]*background:\s*var\(--app-color-primary-light-9\);/su,
    );
    expect(source).not.toMatch(/\.prototype-sidebar\s*\{[^}]*background:\s*var\(--app-color-primary\);/su);
    expect(source.match(/<!-- PROTOTYPE_STYLE_DEPENDENCIES_START -->/gu)).toHaveLength(1);
    expect(source.match(/<!-- PROTOTYPE_STYLE_DEPENDENCIES_END -->/gu)).toHaveLength(1);
    expect(source.match(/<!-- PROTOTYPE_SCRIPT_DEPENDENCIES_START -->/gu)).toHaveLength(1);
    expect(source.match(/<!-- PROTOTYPE_SCRIPT_DEPENDENCIES_END -->/gu)).toHaveLength(1);
    expect(source).not.toContain('<!-- PROTOTYPE_DEPENDENCIES_START -->');
    expect(source).not.toContain('<!-- PROTOTYPE_DEPENDENCIES_END -->');
    expect(source).not.toMatch(/<component\b[^>]*\/>/u);
    expect(source).toContain('aria-current="page"');
    expect(source).toMatch(/\.prototype-sidebar\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/su);
    expect(source).not.toContain('secondary-flow-heading');
    expect(source).not.toContain('四个统计卡片');
    expect(source).not.toContain('统计摘要仅在业务需要');
    expect(source).toContain('<a href="./目标页面.html">');
    expect(source).not.toMatch(/历史\s*HTML|旧\s*HTML|旧页面|legacy|迁移|转换生成|模板化副本/iu);
    expect(source).not.toMatch(
      /平台|导入器|正式导入|直接读取|独立预览|导入时|提取此节点|回导|直读|Vue\s*工程|data-preview/iu,
    );
    expect(source).toContain('不可破坏的模板契约');
    expect(source).toContain('交付自检');
    expect(manifest).toMatchObject({
      templateVersion: 1,
      scriptMode: 'composition-api',
      menu: true,
      pageKey: 'business-page',
      pageType: 'custom',
      fileName: '资料管理.html',
      rootClass: 'business-page',
      overlayRootClass: 'business-page-dialog',
    });
    expect(manifest.rootClass).toBe(manifest.pageKey);
    expect(manifest.menuTitle).toBe(manifest.pageTitle);
    expect(manifest.routePath.split('/').filter(Boolean)[0]).toBe(manifest.client);
    expect(source).toContain(`<title>${manifest.pageTitle}</title>`);
    expect(source).toContain(`<h1>${manifest.pageTitle}</h1>`);
    expect(source).toContain(`data-shell-page-title`);
    expect(htmlWithoutComments).not.toContain(`href="./${manifest.fileName}"`);
    expect(htmlWithoutComments).toContain('aria-disabled="true"');
    expect(source).toContain('<!-- [AI-EDIT] SHELL_NAV_START:');
    expect(source).toContain('<!-- SHELL_NAV_END -->');
    expect(source).toContain(`class="${manifest.rootClass}"`);
    expect(source).toContain(`data-page-root="${manifest.rootClass}"`);
    expect(source).toContain(`data-page-key="${manifest.pageKey}"`);
    expect(source).toContain(`.${manifest.rootClass} {`);
    expect(source).toContain(`.${manifest.overlayRootClass} .el-dialog__body`);
    expect(htmlWithoutComments.match(/<[^>]*\bdata-page-content\b[^>]*>/gu)).toHaveLength(1);
    expect(htmlWithoutComments.match(/<[^>]*\bdata-business-content\b[^>]*>/gu)).toHaveLength(1);
    expect(source.match(/<!-- \[AI-EDIT\] PAGE_CONTENT_START:/gu)).toHaveLength(1);
    expect(source.match(/<!-- \[AI-EDIT\] PAGE_MANIFEST_START:/gu)).toHaveLength(1);
    expect(source.match(/<!-- PAGE_MANIFEST_END -->/gu)).toHaveLength(1);
    expect(source.match(/\/\* \[AI-EDIT\] PAGE_LOGIC_START:/gu)).toHaveLength(1);
    expect(source).not.toMatch(/\bon(?:click|change|input|submit)\s*=/iu);
    expect(source).not.toMatch(/<script[^>]+src=["'](?!https?:)/iu);
  });

  it('rejects a duplicate route in the same project client', async () => {
    const source = await fs.readFile(path.join(projectRoot, 'templates', 'html-prototype-page.html'), 'utf8');
    const { root } = await createPlatformFixture();
    const target = {
      projectId: 'sample-project',
      client: 'admin',
      routePath: 'imported-page',
      menuSection: 'workspace',
      menuTitle: '导入页面',
      sourceFile: 'prototype.html',
    };
    await importPage({ projectRoot: root, source, target });
    expect(
      await fs.readFile(path.join(root, 'projects', 'sample-project', 'page-definitions.js'), 'utf8'),
    ).toContain('"fileName":"prototype.html"');
    await expect(importPage({ projectRoot: root, source, target })).rejects.toThrow('目标页面已存在');
  });

  it('imports a new platform export from its editable Vue source blocks', async () => {
    const manifest = {
      templateVersion: 1,
      exportFormat: 'vue-sfc',
      pageKey: 'exported-page',
      pageTitle: '导出页面',
      pageType: 'custom',
      pageHeaderMode: 'standard',
      client: 'admin',
      routePath: '/admin/exported-page',
      menuSection: 'workspace',
      menuTitle: '导出页面',
      menuIcon: 'Document',
    };
    const templateSource = '<main class="exported-page">导出内容</main>';
    const scriptSource = 'const ready = true';
    const styleSource = '.exported-page { color: var(--app-color-primary); }';
    const source = [
      `<script type="application/json" id="prototype-page-manifest">${JSON.stringify(manifest)}</script>`,
      `<script type="text/plain" id="prototype-editable-template" data-source-format="vue-sfc-template">${templateSource}</script>`,
      `<script type="text/plain" id="prototype-editable-script" data-source-format="vue-sfc-script" data-sfc-setup="true">${scriptSource}</script>`,
      `<script type="text/plain" id="prototype-editable-style" data-source-format="vue-sfc-style" data-sfc-scoped="true" data-sfc-module="classes">${styleSource}</script>`,
    ].join('');
    const { root, packageRoot } = await createPlatformFixture();

    const inspection = inspectHtml(source);
    expect(inspection.valid).toBe(true);
    expect(inspection.format).toBe('vue-sfc');

    await importPage({
      projectRoot: root,
      source,
      target: {
        projectId: 'sample-project',
        client: 'admin',
        routePath: 'exported-page',
        menuSection: 'workspace',
        menuTitle: '导出页面',
      },
    });

    const generatedView = path.join(packageRoot, 'views', 'admin', 'ExportedPageView.vue');
    const generatedSource = await fs.readFile(generatedView, 'utf8');
    expect(generatedSource).toContain('导出内容');
    expect(generatedSource).toContain('<script setup>');
    expect(generatedSource).toMatch(/<style[^>]*\bscoped\b/u);
    expect(generatedSource).toContain('module="classes"');
    expect(await fs.readFile(path.join(packageRoot, 'page-definitions.js'), 'utf8')).toContain(
      '"source":"html-export"',
    );
    expect(inspection.format).toBe('vue-sfc');
  });

  it('keeps export, direct-read and re-import metadata in one loop', async () => {
    const { root, packageRoot } = await createPlatformFixture();
    await fs.mkdir(path.join(packageRoot, 'views', 'admin'), { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'page-definitions.js'),
      `export const clientPageDefinitions = {\n  admin: {\n    sections: [{ id: 'workspace', title: '工作区' }],\n    pages: [{ path: 'home', name: 'admin-home', title: '首页', view: 'admin/HomeView.vue', section: 'workspace', icon: 'House', menu: false }],\n  },\n};\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(packageRoot, 'views', 'admin', 'HomeView.vue'),
      '<template><main class="home-page">闭环内容</main></template>\n<script setup>const ready = true</script>\n<style scoped>\n.home-page { color: var(--app-color-primary); }\n</style>\n',
      'utf8',
    );

    const exported = await createExportPackage({
      projectRoot: root,
      projectId: 'sample-project',
      selectedPaths: ['/p/sample-project/admin/home'],
      packageName: '闭环测试',
    });
    expect(exported.files).toEqual(['首页.html']);
    const exportedPath = path.join(root, exported.result?.html || exported.html);
    const exportedHtml = await fs.readFile(exportedPath, 'utf8');
    const inspection = inspectHtml(exportedHtml);
    expect(inspection).toMatchObject({ valid: true, format: 'vue-sfc' });
    expect(exportedHtml).toContain('id="prototype-editable-template"');
    expect(exportedHtml).toContain('id="prototype-editable-script"');
    expect(exportedHtml).toContain('id="prototype-editable-style"');
    expect(exportedHtml).toContain('PORTABLE HTML PROTOTYPE SOURCE');
    const contentOnlyHtml = applyContentOnlyMode(exportedHtml);
    expect(contentOnlyHtml).toContain('id="platform-html-content-only"');
    expect(contentOnlyHtml).toContain('overflow-y: auto !important');
    expect(contentOnlyHtml).toContain('height: auto !important');
    expect(applyContentOnlyMode(contentOnlyHtml)).toBe(contentOnlyHtml);

    const directRoot = path.join(root, 'direct-html');
    await fs.mkdir(directRoot, { recursive: true });
    await fs.writeFile(path.join(directRoot, 'home.html'), exportedHtml, 'utf8');
    const projectManifestPath = path.join(packageRoot, 'project.json');
    const projectManifest = JSON.parse(await fs.readFile(projectManifestPath, 'utf8'));
    projectManifest.prototype = { enabled: true, root: directRoot, client: 'admin' };
    await fs.writeFile(projectManifestPath, JSON.stringify(projectManifest), 'utf8');

    const directRead = await scanHtmlPrototypePages(path.join(root, 'projects'));
    expect(directRead.projects['sample-project'].admin[0]).toMatchObject({
      path: 'home',
      sourceType: 'html-direct',
      renderMode: 'content-only',
      menu: false,
    });

    await importPage({
      projectRoot: root,
      source: exportedHtml,
      target: {
        projectId: 'sample-project',
        client: 'admin',
        mode: 'replace',
        replacePagePath: 'home',
        routePath: 'home',
        menuSection: 'workspace',
        menuTitle: '首页',
        menuIcon: 'House',
      },
    });
    expect(await fs.readFile(path.join(packageRoot, 'views', 'admin', 'HomeView.vue'), 'utf8')).toContain(
      '闭环内容',
    );

    const editableStart = exportedHtml.indexOf('<script id="prototype-editable-template"');
    const editableEnd = exportedHtml.indexOf('</script>', editableStart);
    const editedHtml = `${exportedHtml.slice(0, editableStart)}${exportedHtml
      .slice(editableStart, editableEnd)
      .replace('闭环内容', 'AI修改内容')}${exportedHtml.slice(editableEnd)}`;
    await importPage({
      projectRoot: root,
      source: editedHtml,
      target: {
        projectId: 'sample-project',
        client: 'admin',
        mode: 'replace',
        replacePagePath: 'home',
        routePath: 'home',
        menuSection: 'workspace',
        menuTitle: '首页',
        menuIcon: 'House',
      },
    });
    expect(await fs.readFile(path.join(packageRoot, 'views', 'admin', 'HomeView.vue'), 'utf8')).toContain(
      'AI修改内容',
    );
  }, 30000);

  it('exports multiple pages as independent round-trip HTML files', async () => {
    const { root, packageRoot } = await createPlatformFixture();
    await fs.mkdir(path.join(packageRoot, 'views', 'admin'), { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'page-definitions.js'),
      `export const clientPageDefinitions = {\n  admin: {\n    sections: [{ id: 'workspace', title: '工作区' }],\n    pages: [\n      { path: 'home', name: 'admin-home', title: '首页', view: 'admin/HomeView.vue', section: 'workspace', icon: 'House' },\n      { path: 'orders', name: 'admin-orders', title: '订单', view: 'admin/OrdersView.vue', section: 'workspace', icon: 'List' },\n    ],\n  },\n};\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(packageRoot, 'views', 'admin', 'HomeView.vue'),
      '<template><main>首页</main></template>\n<script setup>const page = "home"</script>\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(packageRoot, 'views', 'admin', 'OrdersView.vue'),
      '<template><main>订单</main></template>\n<script setup>const page = "orders"</script>\n',
      'utf8',
    );

    const exported = await createExportPackage({
      projectRoot: root,
      projectId: 'sample-project',
      selectedPaths: ['/p/sample-project/admin/home', '/p/sample-project/admin/orders'],
      packageName: '多页闭环测试',
    });

    expect(exported.mode).toBe('multiple');
    expect(exported.files).toEqual(['首页.html', '订单.html']);
    const zipPath = path.join(root, exported.zip);
    expect((await fs.stat(zipPath)).size).toBeGreaterThan(0);
    const exportDirectory = zipPath.replace(/\.zip$/u, '');
    for (const file of exported.files) {
      const html = await fs.readFile(path.join(exportDirectory, file), 'utf8');
      expect(inspectHtml(html)).toMatchObject({ valid: true, format: 'vue-sfc' });
    }
  }, 30000);

  it('rewrites same-name HTML links by their resolved source path', async () => {
    const { root, packageRoot, prototypeRoot } = await createLightweightFixture();
    await fs.mkdir(path.join(packageRoot, 'views', 'admin'), { recursive: true });
    await fs.mkdir(path.join(prototypeRoot, 'group-a'), { recursive: true });
    await fs.mkdir(path.join(prototypeRoot, 'group-b'), { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'page-definitions.js'),
      `export const clientPageDefinitions = {
  admin: {
    sections: [{ id: 'workspace', title: '工作区' }],
    pages: [
      { path: 'home', name: 'admin-home', title: '首页', view: 'admin/HomeView.vue', section: 'workspace', icon: 'House', source: 'html-template', prototype: { sourceFile: 'group-a/home.html' } },
      { path: 'detail-a', name: 'admin-detail-a', title: 'A 详情', view: 'admin/DetailAView.vue', section: 'workspace', icon: 'Document', source: 'html-template', prototype: { sourceFile: 'group-a/detail.html' } },
      { path: 'detail-b', name: 'admin-detail-b', title: 'B 详情', view: 'admin/DetailBView.vue', section: 'workspace', icon: 'Document', source: 'html-template', prototype: { sourceFile: 'group-b/detail.html' } },
    ],
  },
};
`,
      'utf8',
    );
    for (const [fileName, title] of [
      ['HomeView.vue', '首页'],
      ['DetailAView.vue', 'A 详情'],
      ['DetailBView.vue', 'B 详情'],
    ]) {
      await fs.writeFile(
        path.join(packageRoot, 'views', 'admin', fileName),
        `<template><main><h1>${title}</h1></main></template>\n`,
        'utf8',
      );
    }
    await fs.writeFile(
      path.join(prototypeRoot, 'group-a', 'home.html'),
      createLightweightHtml({ title: '首页', subtitle: '首页副标题', link: 'detail.html' }),
      'utf8',
    );
    await fs.writeFile(
      path.join(prototypeRoot, 'group-a', 'detail.html'),
      createLightweightHtml({ title: 'A 详情', subtitle: 'A 副标题', link: '../group-b/detail.html' }),
      'utf8',
    );
    await fs.writeFile(
      path.join(prototypeRoot, 'group-b', 'detail.html'),
      createLightweightHtml({ title: 'B 详情', subtitle: 'B 副标题', link: '../group-a/home.html' }),
      'utf8',
    );

    const exported = await createExportPackage({
      projectRoot: root,
      projectId: 'sample-project',
      selectedPaths: [
        '/p/sample-project/admin/home',
        '/p/sample-project/admin/detail-a',
        '/p/sample-project/admin/detail-b',
      ],
      packageName: '同名页面链接测试',
    });
    const exportDirectory = path.join(root, exported.zip.replace(/^\//u, '').replace(/\.zip$/u, ''));
    const homeHtml = await fs.readFile(path.join(exportDirectory, '首页.html'), 'utf8');
    const detailAHtml = await fs.readFile(path.join(exportDirectory, 'A 详情.html'), 'utf8');
    const detailBHtml = await fs.readFile(path.join(exportDirectory, 'B 详情.html'), 'utf8');

    expect(homeHtml).toContain('href="./A 详情.html"');
    expect(detailAHtml).toContain('href="./B 详情.html"');
    expect(detailBHtml).toContain('href="./首页.html"');
  }, 30000);

  it('exports existing HTML prototypes as lightweight editable files with rewritten links', async () => {
    const { root, packageRoot, prototypeRoot } = await createLightweightFixture();
    await fs.mkdir(path.join(packageRoot, 'views', 'admin'), { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'page-definitions.js'),
      `export const clientPageDefinitions = {
  admin: {
    sections: [{ id: 'workspace', title: '工作区' }],
    pages: [
      { path: 'home', name: 'admin-home', title: '首页', view: 'admin/HomeView.vue', section: 'workspace', icon: 'House', source: 'html-template', prototype: { sourceFile: 'home.html' } },
      { path: 'detail', name: 'admin-detail', title: '详情', view: 'admin/DetailView.vue', section: 'workspace', icon: 'Document', source: 'html-template', prototype: { sourceFile: 'detail.html' } },
      // <generator:admin-pages>
    ],
  },
};
`,
      'utf8',
    );
    await fs.writeFile(
      path.join(packageRoot, 'views', 'admin', 'HomeView.vue'),
      '<template><main class="lightweight-page"><h1>首页</h1><p>首页内容</p></main></template>\n<style scoped>.lightweight-page h1 { font-size: 24px; }</style>\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(packageRoot, 'views', 'admin', 'DetailView.vue'),
      '<template><main class="lightweight-page"><h1>详情</h1><p>详情内容</p></main></template>\n<style scoped>.lightweight-page h1 { font-size: 24px; }</style>\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(prototypeRoot, 'home.html'),
      createLightweightHtml({ title: '首页', subtitle: '首页副标题', link: 'detail.html' }),
      'utf8',
    );
    await fs.writeFile(
      path.join(prototypeRoot, 'detail.html'),
      createLightweightHtml({ title: '详情', subtitle: '详情副标题', link: 'home.html' }),
      'utf8',
    );
    const compilerLoader = vi.fn(async () => {
      throw new Error('轻量 HTML 导出不应加载 Vue 编译器。');
    });
    const exported = await createExportPackage({
      projectRoot: root,
      projectId: 'sample-project',
      selectedPaths: ['/p/sample-project/admin/home', '/p/sample-project/admin/detail'],
      packageName: '轻量 HTML 测试',
      compilerLoader,
    });
    expect(compilerLoader).not.toHaveBeenCalled();
    const exportDirectory = path.join(root, exported.zip.replace(/^\//, '').replace(/\.zip$/u, ''));
    const homeHtml = await fs.readFile(path.join(exportDirectory, '首页.html'), 'utf8');
    const detailHtml = await fs.readFile(path.join(exportDirectory, '详情.html'), 'utf8');

    expect(Buffer.byteLength(homeHtml)).toBeLessThan(100_000);
    expect(homeHtml).toContain('id="prototype-editable-template"');
    expect(homeHtml).toContain('id="prototype-page-manifest"');
    expect(homeHtml).toContain('href="./详情.html"');
    expect(detailHtml).toContain('href="./首页.html"');
    expect(homeHtml).not.toContain('StandalonePrototypePage');
    expect(inspectHtml(homeHtml)).toMatchObject({ valid: true, format: 'html-template', roundTrip: true });
    expect(applyContentOnlyMode(homeHtml)).toContain('.prototype-sidebar');
    await importPage({
      projectRoot: root,
      source: homeHtml,
      target: {
        projectId: 'sample-project',
        client: 'admin',
        routePath: 'imported-light',
        menuSection: 'workspace',
        menuTitle: '轻量回导页面',
      },
    });
    expect(
      await fs.readFile(path.join(packageRoot, 'views', 'admin', 'ImportedLightView.vue'), 'utf8'),
    ).toContain('首页');

    await fs.writeFile(path.join(prototypeRoot, 'home.html'), applyContentOnlyMode(homeHtml), 'utf8');
    const reExported = await createExportPackage({
      projectRoot: root,
      projectId: 'sample-project',
      selectedPaths: ['/p/sample-project/admin/home'],
      packageName: '轻量 HTML 再导出测试',
    });
    const reExportedHtml = await fs.readFile(path.join(root, reExported.html.replace(/^\//u, '')), 'utf8');
    for (const id of [
      'prototype-page-manifest',
      'prototype-export-config',
      'prototype-editable-template',
      'prototype-editable-style',
    ]) {
      expect(reExportedHtml.match(new RegExp(`id=["']${id}["']`, 'gu'))).toHaveLength(1);
    }
    expect(reExportedHtml).not.toContain('id="platform-html-content-only"');
    expect(inspectHtml(reExportedHtml)).toMatchObject({
      valid: true,
      format: 'html-template',
      roundTrip: true,
    });
  }, 30000);

  it('reports an actionable compiler error only when a Vue page requires compilation', async () => {
    const { root } = await createPlatformFixture();
    await createProjectRoute({
      projectRoot: root,
      target: {
        projectId: 'sample-project',
        client: 'admin',
        routePath: 'vue-only-page',
        pageTitle: 'Vue 编译页面',
        menuSection: 'workspace',
        menuIcon: 'Document',
      },
    });
    const compilerLoader = vi.fn(async () => {
      const error = new Error('未安装测试编译器');
      error.code = 'VUE_EXPORT_COMPILER_UNAVAILABLE';
      throw error;
    });

    await expect(
      createExportPackage({
        projectRoot: root,
        projectId: 'sample-project',
        selectedPaths: ['/p/sample-project/admin/vue-only-page'],
        packageName: 'Vue 编译失败测试',
        compilerLoader,
      }),
    ).rejects.toMatchObject({
      code: 'VUE_EXPORT_COMPILER_UNAVAILABLE',
      message: expect.stringContaining('Vue 页面“Vue 编译页面”导出编译失败：未安装测试编译器'),
    });
    expect(compilerLoader).toHaveBeenCalledTimes(1);
  });
});
