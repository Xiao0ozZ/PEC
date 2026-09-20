import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { applyContentOnlyMode, scanHtmlPrototypePages } from '../../packages/project-core/src/index.js';
import { scanProjectPackages } from '../../packages/project-core/src/index.js';

const temporaryRoots = [];
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function createProjectFixture() {
  const fixtureParent = path.join(projectRoot, '.test-project-packages');
  await fs.mkdir(fixtureParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(fixtureParent, 'fixture-'));
  temporaryRoots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}', 'utf8');
  const projectsRoot = path.join(root, 'projects');
  const packageRoot = path.join(projectsRoot, 'sample-project');
  await fs.mkdir(path.join(packageRoot, 'html-pages', 'admin'), { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, 'project.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'sample-project',
      name: '示例项目',
      pageDefinitions: 'page-definitions.js',
      clients: [{ id: 'admin', name: '管理端', defaultPage: 'home' }],
      entries: [{ id: 'admin', kind: 'client', clientId: 'admin', name: '管理端' }],
      features: { designSystem: true },
    }),
    'utf8',
  );
  await fs.writeFile(
    path.join(packageRoot, 'page-definitions.js'),
    `export const clientPageDefinitions = { admin: { sections: [{ id: 'workspace', title: '工作区' }], pages: [{ path: 'home', name: 'admin-home', title: '首页', sourceType: 'html-template', source: 'home.html', section: 'workspace', icon: 'House' }] } };\n// <generator:admin-pages>\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(packageRoot, 'html-pages', 'admin', 'home.html'),
    '<!doctype html><html><head><meta charset="UTF-8"><title>首页</title></head><body><main>首页</main></body></html>',
    'utf8',
  );
  return { projectsRoot, packageRoot };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  await fs.rm(path.join(projectRoot, '.test-project-packages'), { recursive: true, force: true });
});

describe('project package scanner', () => {
  it('discovers a complete project package', async () => {
    const { projectsRoot } = await createProjectFixture();
    const result = await scanProjectPackages(projectsRoot);
    expect(result.invalidProjects).toEqual([]);
    expect(result.projects.map((project) => project.id)).toEqual(['sample-project']);
  });

  it('rejects a package with a missing registered HTML page', async () => {
    const { projectsRoot, packageRoot } = await createProjectFixture();
    await fs.rm(path.join(packageRoot, 'html-pages', 'admin', 'home.html'));
    const result = await scanProjectPackages(projectsRoot);
    expect(result.projects).toEqual([]);
    expect(result.invalidProjects[0].errors).toContain('HTML 页面文件不存在：admin/home.html。');
  });

  it('rejects an unregistered custom client entry page', async () => {
    const { projectsRoot, packageRoot } = await createProjectFixture();
    const manifestPath = path.join(packageRoot, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.clients[0].entry = { mode: 'custom-page', page: 'missing-page' };
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    const result = await scanProjectPackages(projectsRoot);
    expect(result.projects).toEqual([]);
    expect(result.invalidProjects[0].errors).toContain('客户端 admin 的自定义入口页面未登记：missing-page。');
  });

  it('ignores unused client definition skeletons outside the manifest', async () => {
    const { projectsRoot, packageRoot } = await createProjectFixture();
    const definitionsPath = path.join(packageRoot, 'page-definitions.js');
    await fs.writeFile(
      definitionsPath,
      `export const clientPageDefinitions = {\n  admin: { sections: [{ id: 'workspace', title: '工作区' }], pages: [{ path: 'home', name: 'admin-home', title: '首页', sourceType: 'html-template', source: 'home.html', section: 'workspace', icon: 'House' }] },\n  legacy: { sections: [{ id: 'workspace', title: '旧客户端' }], pages: [] },\n};\n// <generator:admin-pages>\n`,
      'utf8',
    );
    const result = await scanProjectPackages(projectsRoot);
    expect(result.invalidProjects).toEqual([]);
    expect(result.projects.map((project) => project.id)).toEqual(['sample-project']);
  });

  it('accepts a PRD directory outside the project package', async () => {
    const { projectsRoot, packageRoot } = await createProjectFixture();
    const externalDocsRoot = path.join(path.dirname(projectsRoot), 'prd-source');
    await fs.mkdir(externalDocsRoot, { recursive: true });
    await fs.writeFile(path.join(externalDocsRoot, 'overview.md'), '# Overview\n', 'utf8');
    await fs.writeFile(
      path.join(packageRoot, 'project.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'sample-project',
        name: '示例项目',
        pageDefinitions: 'page-definitions.js',
        clients: [{ id: 'admin', name: '管理端', defaultPage: 'home' }],
        entries: [
          { id: 'admin', kind: 'client', clientId: 'admin', name: '管理端' },
          { id: 'docs', kind: 'docs', name: '产品文档' },
        ],
        docs: { enabled: true, root: externalDocsRoot },
        features: { designSystem: true },
      }),
      'utf8',
    );

    const result = await scanProjectPackages(projectsRoot);
    expect(result.invalidProjects).toEqual([]);
    expect(result.projects[0].docs.root).toBe(externalDocsRoot);
  });

  it('scans HTML prototypes and derives stable page metadata', async () => {
    const { projectsRoot, packageRoot } = await createProjectFixture();
    const prototypeRoot = path.join(path.dirname(projectsRoot), 'html-prototypes');
    await fs.mkdir(path.join(prototypeRoot, 'admin'), { recursive: true });
    await fs.writeFile(
      path.join(prototypeRoot, 'admin', 'dashboard.html'),
      '<!doctype html><html><head><title>示例仪表板</title></head><body><h1>示例仪表板</h1></body></html>',
      'utf8',
    );
    await fs.writeFile(
      path.join(packageRoot, 'project.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'sample-project',
        name: '示例项目',
        pageDefinitions: 'page-definitions.js',
        clients: [{ id: 'admin', name: '管理端', defaultPage: 'dashboard' }],
        entries: [{ id: 'admin', kind: 'client', clientId: 'admin', name: '管理端' }],
        prototype: { enabled: true, root: prototypeRoot },
      }),
      'utf8',
    );

    const result = await scanHtmlPrototypePages(projectsRoot);
    const page = result.projects['sample-project'].admin[0];
    expect(page).toMatchObject({
      path: 'dashboard',
      title: '示例仪表板',
      sourceType: 'html-direct',
      source: 'admin/dashboard.html',
      section: 'workspace',
    });
    const packageScan = await scanProjectPackages(projectsRoot);
    expect(packageScan.invalidProjects).toEqual([]);
    expect(packageScan.projects.map((project) => project.id)).toEqual(['sample-project']);
  });

  it('scans a separate HTML source folder for each client', async () => {
    const { projectsRoot, packageRoot } = await createProjectFixture();
    const adminPrototypeRoot = path.join(path.dirname(projectsRoot), 'admin-html');
    await fs.mkdir(adminPrototypeRoot, { recursive: true });
    await fs.writeFile(
      path.join(adminPrototypeRoot, 'dashboard.html'),
      '<!doctype html><html><head><title>管理端仪表板</title></head><body></body></html>',
      'utf8',
    );
    await fs.writeFile(
      path.join(packageRoot, 'project.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'sample-project',
        name: '示例项目',
        pageDefinitions: 'page-definitions.js',
        clients: [{ id: 'admin', name: '管理端', defaultPage: 'home' }],
        prototype: {
          enabled: true,
          clients: { admin: { enabled: true, root: adminPrototypeRoot, section: 'workspace' } },
        },
      }),
      'utf8',
    );

    const result = await scanHtmlPrototypePages(projectsRoot);
    const page = result.projects['sample-project'].admin[0];
    expect(page).toMatchObject({
      path: 'dashboard',
      title: '管理端仪表板',
      source: 'dashboard.html',
      sourceRoot: 'admin',
    });
    expect(result.roots['sample-project'][0]).toMatchObject({ clientId: 'admin' });
  });

  it('marks template HTML for content-only shell rendering', async () => {
    const { projectsRoot, packageRoot } = await createProjectFixture();
    const prototypeRoot = path.join(path.dirname(projectsRoot), 'template-html');
    await fs.mkdir(prototypeRoot, { recursive: true });
    await fs.writeFile(
      path.join(prototypeRoot, 'dashboard.html'),
      '<script type="application/json" id="prototype-page-manifest">{"templateVersion":1,"pageKey":"template-dashboard","pageTitle":"模板仪表板","menuTitle":"模板仪表板菜单","menuSection":"workspace","menuIcon":"DataBoard","menu":false,"client":"admin","routePath":"/admin/template-dashboard"}</script><script type="text/plain" id="prototype-editable-template"><main /></script>',
      'utf8',
    );
    await fs.writeFile(
      path.join(packageRoot, 'project.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'sample-project',
        name: '示例项目',
        pageDefinitions: 'page-definitions.js',
        clients: [{ id: 'admin', name: '管理端', defaultPage: 'home' }],
        prototype: { enabled: true, root: prototypeRoot },
      }),
      'utf8',
    );

    const result = await scanHtmlPrototypePages(projectsRoot);
    expect(result.projects['sample-project'].admin[0]).toMatchObject({
      path: 'template-dashboard',
      title: '模板仪表板',
      sourceType: 'html-direct',
      renderMode: 'content-only',
      section: 'workspace',
      icon: 'DataBoard',
      menu: false,
    });
  });

  it('treats template HTML as content-only shell pages', async () => {
    const { projectsRoot, packageRoot } = await createProjectFixture();
    const prototypeRoot = path.join(path.dirname(projectsRoot), 'templateized-html');
    await fs.mkdir(prototypeRoot, { recursive: true });
    const source = `<!doctype html>
<html><head><title>旧页面标题</title></head><body>
  <aside class="prototype-sidebar">旧页面菜单</aside>
  <header class="prototype-topbar">旧页面顶栏</header>
  <main class="prototype-main"><h1>旧页面内容</h1></main>
  <script id="prototype-page-manifest" type="application/json">${JSON.stringify({
    templateVersion: 1,
    pageKey: 'legacy-dashboard',
    pageTitle: '模板化仪表板',
    menuTitle: '模板化菜单',
    menuSection: 'workspace',
    menuIcon: 'DataBoard',
    menu: true,
    client: 'admin',
    routePath: '/admin/legacy-dashboard',
  })}</script>
</body></html>`;
    await fs.writeFile(path.join(prototypeRoot, 'legacy-dashboard.html'), source, 'utf8');
    await fs.writeFile(
      path.join(packageRoot, 'project.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'sample-project',
        name: '示例项目',
        pageDefinitions: 'page-definitions.js',
        clients: [{ id: 'admin', name: '管理端', defaultPage: 'home' }],
        prototype: { enabled: true, root: prototypeRoot },
      }),
      'utf8',
    );

    const result = await scanHtmlPrototypePages(projectsRoot);
    expect(result.projects['sample-project'].admin[0]).toMatchObject({
      path: 'legacy-dashboard',
      title: '模板化仪表板',
      sourceType: 'html-direct',
      renderMode: 'content-only',
      section: 'workspace',
      icon: 'DataBoard',
      menu: true,
    });
    expect(applyContentOnlyMode(source)).toContain('id="platform-html-content-only"');
  });

  it('can preserve the complete shell of a templateized HTML source', async () => {
    const { projectsRoot, packageRoot } = await createProjectFixture();
    const prototypeRoot = path.join(path.dirname(projectsRoot), 'full-shell-html');
    await fs.mkdir(prototypeRoot, { recursive: true });
    const source = `<!doctype html><html><head><title>完整外壳页面</title></head><body>
      <aside class="prototype-sidebar">原页面菜单</aside>
      <main data-page-content><div data-business-content>页面内容</div></main>
      <script id="prototype-page-manifest" type="application/json">${JSON.stringify({
        templateVersion: 1,
        pageKey: 'full-shell-page',
        pageTitle: '完整外壳页面',
        client: 'admin',
        routePath: '/admin/full-shell-page',
      })}</script>
    </body></html>`;
    await fs.writeFile(path.join(prototypeRoot, 'full-shell-page.html'), source, 'utf8');
    const manifestPath = path.join(packageRoot, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.prototype = {
      enabled: true,
      clients: {
        admin: { enabled: true, root: prototypeRoot, shellMode: 'full' },
      },
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    const result = await scanHtmlPrototypePages(projectsRoot);
    expect(result.projects['sample-project'].admin[0]).toMatchObject({
      path: 'full-shell-page',
      renderMode: 'full',
      sourceType: 'html-direct',
    });
    expect(result.roots['sample-project'][0]).toMatchObject({
      clientId: 'admin',
      shellMode: 'full',
    });
  });
});
