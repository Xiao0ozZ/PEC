import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { createPlatformServer } from '../../packages/platform-server/src/index.js';

const servers = [];
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createWritableFixture() {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-platform-server-'));
  temporaryRoots.push(root);
  await fs.cp(path.resolve(process.cwd(), 'examples/sample-project'), path.join(root, 'sample-project'), {
    recursive: true,
  });
  const settingsPath = path.join(root, 'platform-settings.json');
  await fs.writeFile(settingsPath, '{"developerMode":false}\n', 'utf8');
  return {
    projectsRoot: root,
    settingsPath,
    projectRoot: path.join(root, 'sample-project'),
  };
}

async function createRouteFixture() {
  const platformRoot = await fs.mkdtemp(path.join(process.cwd(), '.tmp-platform-routes-'));
  temporaryRoots.push(platformRoot);
  const projectsRoot = path.join(platformRoot, 'projects');
  await fs.mkdir(projectsRoot, { recursive: true });
  await fs.cp(
    path.resolve(process.cwd(), 'examples/sample-project'),
    path.join(projectsRoot, 'sample-project'),
    { recursive: true },
  );
  return { platformRoot, projectsRoot };
}

describe('platform local server', () => {
  it('serves project, HTML prototype and PRD read APIs without Vite', async () => {
    const projectsRoot = path.resolve(process.cwd(), 'examples');
    const service = createPlatformServer({ projectsRoot, port: 0 });
    servers.push(service);
    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${baseUrl}/__platform/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, readOnly: true });

    const manifest = await fetch(`${baseUrl}/__projects/manifest`);
    expect(manifest.status).toBe(200);
    const manifestPayload = await manifest.json();
    expect(manifestPayload.projects[0]).toMatchObject({ id: 'sample-project', name: '示例产品' });

    const catalog = await fetch(`${baseUrl}/__projects/html-pages`);
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).projects['sample-project'].admin[0]).toMatchObject({ title: '发布看板' });

    const bindings = await fetch(`${baseUrl}/__projects/prd-bindings?project=sample-project`);
    expect(bindings.status).toBe(200);
    expect((await bindings.json()).bindings.length).toBeGreaterThan(0);

    const documentManifest = await fetch(`${baseUrl}/__prd/manifest?project=sample-project`);
    expect(documentManifest.status).toBe(200);
    expect((await documentManifest.json()).documents[0]).toMatchObject({ path: '01_产品概览.md' });

    const html = await fetch(`${baseUrl}/__projects/html-content/sample-project/admin/release-board.html`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('发布看板');
  });

  it('reads explicitly configured external PRD and HTML roots while blocking junction escapes', async () => {
    const fixture = await createWritableFixture();
    const externalDocs = path.join(fixture.projectsRoot, 'external-docs');
    const externalPrototype = path.join(fixture.projectsRoot, 'external-prototype');
    const outsideAssets = path.join(fixture.projectsRoot, 'outside-assets');
    await fs.mkdir(externalDocs);
    await fs.mkdir(externalPrototype);
    await fs.mkdir(outsideAssets);
    await fs.writeFile(path.join(externalDocs, '外置说明.md'), '# 外置 PRD\n', 'utf8');
    await fs.writeFile(
      path.join(externalPrototype, 'external-page.html'),
      '<!doctype html><html><head><title>外置原型</title></head><body>外置原型内容</body></html>',
      'utf8',
    );
    await fs.writeFile(path.join(outsideAssets, 'secret.html'), 'outside secret', 'utf8');
    const manifestPath = path.join(fixture.projectRoot, 'project.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.docs = { enabled: true, root: externalDocs };
    manifest.prototype = {
      enabled: true,
      root: externalPrototype,
      client: 'admin',
      clients: {},
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await fs.mkdir(path.join(fixture.projectRoot, 'assets'), { recursive: true });
    await fs.symlink(outsideAssets, path.join(fixture.projectRoot, 'assets', 'linked'), 'junction');

    const service = createPlatformServer({ projectsRoot: fixture.projectsRoot, port: 0 });
    servers.push(service);
    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const documentManifest = await fetch(`${baseUrl}/__prd/manifest?project=sample-project`);
    expect(documentManifest.status).toBe(200);
    expect((await documentManifest.json()).documents[0]).toMatchObject({ path: '外置说明.md' });

    const catalog = await fetch(`${baseUrl}/__projects/html-pages`);
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).projects['sample-project'].admin[0]).toMatchObject({
      source: 'external-page.html',
      title: '外置原型',
    });

    const escapedAsset = await fetch(
      `${baseUrl}/__projects/file?project=sample-project&path=assets/linked/secret.html`,
    );
    expect(escapedAsset.status).toBe(404);
    expect(await escapedAsset.text()).not.toContain('outside secret');
  });

  it('writes settings and both association files atomically for local requests', async () => {
    const fixture = await createWritableFixture();
    const service = createPlatformServer({
      projectsRoot: fixture.projectsRoot,
      settingsPath: fixture.settingsPath,
      writeEnabled: true,
      port: 0,
    });
    servers.push(service);
    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    expect(await (await fetch(`${baseUrl}/__platform/health`)).json()).toMatchObject({
      readOnly: false,
      writeEnabled: true,
    });

    const pageLinksResponse = await fetch(`${baseUrl}/__projects/page-prd-links?project=sample-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'sample-project',
        links: { admin: { overview: '01_产品概览.md' } },
      }),
    });
    expect(pageLinksResponse.status).toBe(200);
    expect(await pageLinksResponse.json()).toEqual({ admin: { overview: '01_产品概览.md' } });
    expect(
      JSON.parse(await fs.readFile(path.join(fixture.projectRoot, '.platform/page-prd-links.json'), 'utf8')),
    ).toEqual({
      schemaVersion: 1,
      projectId: 'sample-project',
      links: { admin: { overview: '01_产品概览.md' } },
    });

    const binding = {
      id: 'sample-binding',
      pagePath: '/p/sample-project/admin/overview',
      target: { domPath: [], tag: 'H1', text: '项目概览' },
      prd: { document: '01_产品概览.md', anchor: '验收要点' },
    };
    const bindingsResponse = await fetch(`${baseUrl}/__projects/prd-bindings?project=sample-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'sample-project', bindings: [binding] }),
    });
    expect(bindingsResponse.status).toBe(200);
    expect(await bindingsResponse.json()).toEqual({ schemaVersion: 1, bindings: [binding] });
    expect(
      JSON.parse(await fs.readFile(path.join(fixture.projectRoot, '.platform/prd-bindings.json'), 'utf8')),
    ).toEqual({
      schemaVersion: 1,
      projectId: 'sample-project',
      bindings: [binding],
    });

    const settingsResponse = await fetch(`${baseUrl}/__platform/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ developerMode: true }),
    });
    expect(settingsResponse.status).toBe(200);
    expect(await settingsResponse.json()).toMatchObject({ ok: true, settings: { developerMode: true } });
    expect(JSON.parse(await fs.readFile(fixture.settingsPath, 'utf8'))).toEqual({ developerMode: true });

    const previousPageLinks = await fs.readFile(
      path.join(fixture.projectRoot, '.platform/page-prd-links.json'),
      'utf8',
    );
    const invalidResponse = await fetch(`${baseUrl}/__projects/page-prd-links?project=sample-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'sample-project',
        links: { admin: { overview: '../outside.md' } },
      }),
    });
    expect(invalidResponse.status).toBe(400);
    expect(await fs.readFile(path.join(fixture.projectRoot, '.platform/page-prd-links.json'), 'utf8')).toBe(
      previousPageLinks,
    );
  });

  it('keeps project create and update behavior available through the local service', async () => {
    const fixture = await createWritableFixture();
    const service = createPlatformServer({
      projectsRoot: fixture.projectsRoot,
      settingsPath: fixture.settingsPath,
      writeEnabled: true,
      port: 0,
    });
    servers.push(service);
    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const project = {
      id: 'local-project',
      name: '本地项目',
      shortName: '本地',
      description: '独立服务写入测试。',
      version: '0.1.0',
      defaultLocale: 'zh-CN',
      primary: '#2563eb',
      pageBackground: '#f5f7fb',
      clients: [
        {
          id: 'admin',
          name: '管理端',
          entry: { mode: 'direct' },
          layout: { type: 'sidebar' },
        },
      ],
      entries: [
        {
          id: 'admin',
          kind: 'client',
          clientId: 'admin',
          name: '管理端',
          order: 10,
        },
        { id: 'docs', kind: 'docs', name: '产品文档', order: 20 },
      ],
      docs: { enabled: true, root: 'docs' },
      prototype: { enabled: false, root: 'prototype', clients: {} },
      mobile: { enabled: false },
      homepage: { visible: true },
      features: { designSystem: true },
    };

    const createResponse = await fetch(`${baseUrl}/__projects/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    expect(createResponse.status).toBe(200);
    expect(await createResponse.json()).toMatchObject({ ok: true, project: { id: 'local-project' } });

    const updateResponse = await fetch(`${baseUrl}/__projects/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...project, name: '本地项目（已更新）' }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      ok: true,
      project: { id: 'local-project', name: '本地项目（已更新）' },
    });
    expect(
      JSON.parse(await fs.readFile(path.join(fixture.projectsRoot, 'local-project/project.json'), 'utf8')),
    ).toMatchObject({ id: 'local-project', name: '本地项目（已更新）' });
  });

  it('serves route data without loading the Vite development server', async () => {
    const fixture = await createRouteFixture();
    const service = createPlatformServer({
      projectsRoot: fixture.projectsRoot,
      platformRoot: fixture.platformRoot,
      writeEnabled: true,
      port: 0,
    });
    servers.push(service);
    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const routesResponse = await fetch(`${baseUrl}/__project-routes?projectId=sample-project`);
    expect(routesResponse.status).toBe(200);
    expect(await routesResponse.json()).toMatchObject({
      ok: true,
      project: { id: 'sample-project' },
      clients: [{ id: 'admin' }],
    });

  });

  it('rejects association writes from non-local requests', async () => {
    const fixture = await createWritableFixture();
    const service = createPlatformServer({
      projectsRoot: fixture.projectsRoot,
      settingsPath: fixture.settingsPath,
      writeEnabled: true,
      getClientAddress: () => '192.168.1.20',
      port: 0,
    });
    servers.push(service);
    const address = await service.start();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/__projects/prd-bindings?project=sample-project`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'sample-project', bindings: [] }),
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      JSON.parse(await fs.readFile(path.join(fixture.projectRoot, '.platform/prd-bindings.json'), 'utf8')),
    ).toMatchObject({ bindings: [{ id: 'sample-overview-acceptance' }] });
  });

  it('keeps the service read-only when writeEnabled is false and enforces body limits', async () => {
    const fixture = await createWritableFixture();
    const readOnlyService = createPlatformServer({
      projectsRoot: fixture.projectsRoot,
      settingsPath: fixture.settingsPath,
      port: 0,
    });
    servers.push(readOnlyService);
    const readOnlyAddress = await readOnlyService.start();
    const readOnlyResponse = await fetch(
      `http://127.0.0.1:${readOnlyAddress.port}/__projects/page-prd-links?project=sample-project`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'sample-project', links: {} }),
      },
    );
    expect(readOnlyResponse.status).toBe(403);
    expect(await readOnlyResponse.json()).toMatchObject({ code: 'LOCAL_SERVER_READ_ONLY' });
    await readOnlyService.close();

    const writableService = createPlatformServer({
      projectsRoot: fixture.projectsRoot,
      settingsPath: fixture.settingsPath,
      writeEnabled: true,
      port: 0,
    });
    servers.push(writableService);
    const writableAddress = await writableService.start();
    const oversizedResponse = await fetch(`http://127.0.0.1:${writableAddress.port}/__platform/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ developerMode: true, padding: 'x'.repeat(17 * 1024) }),
    });
    expect(oversizedResponse.status).toBe(413);
    expect(JSON.parse(await fs.readFile(fixture.settingsPath, 'utf8'))).toEqual({ developerMode: false });
  });

  it('mounts, checks and safely unmounts an external project folder', async () => {
    const platformRoot = await fs.mkdtemp(path.join(process.cwd(), '.tmp-platform-mount-'));
    temporaryRoots.push(platformRoot);
    const projectsRoot = path.join(platformRoot, 'projects');
    const externalRoot = path.join(platformRoot, 'external', 'renamed-folder');
    const mountsPath = path.join(platformRoot, 'project-mounts.local.json');
    await fs.mkdir(projectsRoot, { recursive: true });
    await fs.cp(path.resolve(process.cwd(), 'examples/sample-project'), externalRoot, { recursive: true });

    const service = createPlatformServer({
      projectsRoot,
      platformRoot,
      mountsPath,
      writeEnabled: true,
      selectDirectory: async () => externalRoot,
      port: 0,
    });
    servers.push(service);
    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    expect(await (await fetch(`${baseUrl}/__platform/bootstrap`)).json()).toMatchObject({
      runtime: { writeEnabled: true },
      workspace: { projects: 0, needsOnboarding: true },
    });
    expect(
      await (
        await fetch(`${baseUrl}/__platform/select-directory`, { method: 'POST' })
      ).json(),
    ).toMatchObject({ ok: true, path: externalRoot });

    const inspectResponse = await fetch(`${baseUrl}/__projects/mount/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: externalRoot }),
    });
    expect(inspectResponse.status).toBe(200);
    expect(await inspectResponse.json()).toMatchObject({ ok: true, project: { id: 'sample-project' } });

    const mountResponse = await fetch(`${baseUrl}/__projects/mount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: externalRoot }),
    });
    expect(mountResponse.status).toBe(200);
    expect(JSON.parse(await fs.readFile(mountsPath, 'utf8'))).toMatchObject({
      projects: { 'sample-project': { root: path.resolve(externalRoot) } },
    });
    expect((await (await fetch(`${baseUrl}/__projects/manifest`)).json()).projects[0]).toMatchObject({
      id: 'sample-project',
      mounted: true,
    });
    const health = await (await fetch(`${baseUrl}/__projects/health`)).json();
    expect(health.projects[0]).toMatchObject({ project: { id: 'sample-project', mounted: true } });

    const unmountResponse = await fetch(`${baseUrl}/__projects/unmount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'sample-project' }),
    });
    expect(unmountResponse.status).toBe(200);
    expect(JSON.parse(await fs.readFile(mountsPath, 'utf8')).projects).toEqual({});
    expect(await fs.stat(path.join(externalRoot, 'project.json'))).toBeTruthy();
  });
});
