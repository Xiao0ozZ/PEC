// @vitest-environment node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { createPlatformServer } from '../../packages/platform-server/src/index.js';

const services = [];
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function startWritableService() {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-scan-cache-'));
  temporaryRoots.push(root);
  await fs.cp(path.resolve(process.cwd(), 'examples/sample-project'), path.join(root, 'sample-project'), {
    recursive: true,
  });
  const service = createPlatformServer({ projectsRoot: root, port: 0, writeEnabled: true });
  services.push(service);
  const address = await service.start();
  return { service, projectsRoot: root, baseUrl: `http://127.0.0.1:${address.port}` };
}

function readManifest(baseUrl) {
  return fetch(`${baseUrl}/__projects/manifest`).then((response) => response.json());
}

describe('扫描缓存', () => {
  it('重复读取返回一致结果', async () => {
    const { baseUrl } = await startWritableService();
    const first = await readManifest(baseUrl);
    const second = await readManifest(baseUrl);
    expect(second).toEqual(first);
    expect(first.projects[0]).toMatchObject({ id: 'sample-project' });
  });

  it('写入后立即读取必须反映最新数据，不能命中过期缓存', async () => {
    const { baseUrl, projectsRoot } = await startWritableService();

    const before = await readManifest(baseUrl);
    expect(before.projects[0].name).toBe('示例产品');

    const manifestPath = path.join(projectsRoot, 'sample-project', 'project.json');
    const project = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const update = await fetch(`${baseUrl}/__projects/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...project, name: '示例产品（已改名）' }),
    });
    expect(update.status).toBe(200);

    // 不等待 TTL：写请求通过权限校验时就应清空扫描缓存。
    const after = await readManifest(baseUrl);
    expect(after.projects[0].name).toBe('示例产品（已改名）');
  });

  it('被拒绝的写入不会影响后续读取结果', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-scan-cache-ro-'));
    temporaryRoots.push(root);
    await fs.cp(path.resolve(process.cwd(), 'examples/sample-project'), path.join(root, 'sample-project'), {
      recursive: true,
    });
    const service = createPlatformServer({ projectsRoot: root, port: 0, writeEnabled: false });
    services.push(service);
    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const before = await readManifest(baseUrl);
    const rejected = await fetch(`${baseUrl}/__projects/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'sample-project', name: '不应生效' }),
    });
    expect(rejected.status).toBe(403);
    expect(await readManifest(baseUrl)).toEqual(before);
  });

  it('HTML 目录与项目清单分别缓存，互不串扰', async () => {
    const { baseUrl } = await startWritableService();
    const catalog = await fetch(`${baseUrl}/__projects/html-pages`).then((response) => response.json());
    const manifest = await readManifest(baseUrl);
    expect(catalog.projects['sample-project']).toBeDefined();
    expect(manifest.projects[0].id).toBe('sample-project');
    // 再各读一次，确认缓存命中后结构依然完整。
    const catalogAgain = await fetch(`${baseUrl}/__projects/html-pages`).then((r) => r.json());
    expect(catalogAgain.projects).toEqual(catalog.projects);
  });
});
