// @vitest-environment node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  REVIEW_SNAPSHOT_ARTIFACT_TYPE,
  REVIEW_SNAPSHOT_FILE_NAME,
  REVIEW_SNAPSHOT_SCHEMA_VERSION,
  createReviewSnapshotManifest,
} from '../../packages/project-core/src/index.js';

const temporaryRoots = [];
const examplesRoot = path.resolve(process.cwd(), 'examples');

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function copyExamples() {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-review-snapshot-'));
  temporaryRoots.push(root);
  const projectsRoot = path.join(root, 'projects');
  await fs.cp(examplesRoot, projectsRoot, { recursive: true });
  return projectsRoot;
}

async function snapshotDirectory(root) {
  const entries = new Map();
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      const [stats, content] = await Promise.all([fs.stat(absolute), fs.readFile(absolute)]);
      entries.set(path.relative(root, absolute).replaceAll('\\', '/'), {
        size: stats.size,
        hash: content.toString('base64'),
      });
    }
  }
  await walk(root);
  return entries;
}

describe('REVIEW-01 静态评审快照清单', () => {
  it('固定快照时间并标记为只读产物', async () => {
    const manifest = await createReviewSnapshotManifest(examplesRoot, {
      base: '/review/',
      generatedAt: '2026-08-23T00:00:00.000Z',
    });
    expect(manifest).toMatchObject({
      schemaVersion: REVIEW_SNAPSHOT_SCHEMA_VERSION,
      artifactType: REVIEW_SNAPSHOT_ARTIFACT_TYPE,
      generatedAt: '2026-08-23T00:00:00.000Z',
      base: '/review/',
      editable: false,
    });
    expect(REVIEW_SNAPSHOT_FILE_NAME).toBe('review-manifest.json');
  });

  it('明确项目、客户端、页面、PRD 与关联范围', async () => {
    const manifest = await createReviewSnapshotManifest(examplesRoot);
    const project = manifest.projects.find((item) => item.id === 'sample-project');
    expect(project).toBeDefined();

    const client = project.clients.find((item) => item.id === 'admin');
    expect(client).toMatchObject({ id: 'admin', name: '管理端', layout: 'sidebar' });
    expect(client.pages.length).toBeGreaterThan(0);

    // 页面必须带可直接跳转的路由，评审包才能形成有效链接。
    for (const page of client.pages) {
      expect(page.route).toBe(`/p/sample-project/${client.id}/${page.path}`);
      expect(page.source).toMatch(/\.html?$/iu);
      expect(page.title).toBeTruthy();
    }

    expect(project.documents.some((document) => document.path.endsWith('.md'))).toBe(true);
    expect(project.associations.componentBindings.length).toBeGreaterThan(0);
    for (const binding of project.associations.componentBindings) {
      expect(binding.document).toMatch(/\.md$/iu);
      expect(binding.pagePath).toBeTruthy();
    }
  });

  it('范围合计等于各项目累加，可用于核对快照覆盖面', async () => {
    const manifest = await createReviewSnapshotManifest(examplesRoot);
    const expected = manifest.projects.reduce(
      (total, project) => ({
        clients: total.clients + project.counts.clients,
        pages: total.pages + project.counts.pages,
        documents: total.documents + project.counts.documents,
        pageLinks: total.pageLinks + project.counts.pageLinks,
        componentBindings: total.componentBindings + project.counts.componentBindings,
      }),
      { clients: 0, pages: 0, documents: 0, pageLinks: 0, componentBindings: 0 },
    );
    expect(manifest.scope).toMatchObject({ projects: manifest.projects.length, ...expected });
  });

  it('生成过程完全不修改源项目', async () => {
    const projectsRoot = await copyExamples();
    const before = await snapshotDirectory(projectsRoot);
    await createReviewSnapshotManifest(projectsRoot);
    const after = await snapshotDirectory(projectsRoot);

    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [file, state] of before) expect(after.get(file)).toEqual(state);
  });

  it('相同输入产生稳定结果，可重复生成', async () => {
    const options = { generatedAt: '2026-08-23T00:00:00.000Z' };
    const first = await createReviewSnapshotManifest(examplesRoot, options);
    const second = await createReviewSnapshotManifest(examplesRoot, options);
    expect(second).toEqual(first);
  });

  it('空项目目录返回空范围而不报错', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-review-empty-'));
    temporaryRoots.push(root);
    const manifest = await createReviewSnapshotManifest(root);
    expect(manifest.projects).toEqual([]);
    expect(manifest.scope).toMatchObject({ projects: 0, pages: 0, documents: 0 });
  });

  it('关联配置损坏时按空范围记录且不中断生成', async () => {
    const projectsRoot = await copyExamples();
    const platformRoot = path.join(projectsRoot, 'sample-project', '.platform');
    await fs.mkdir(platformRoot, { recursive: true });
    await fs.writeFile(path.join(platformRoot, 'prd-bindings.json'), '{ not json', 'utf8');

    const manifest = await createReviewSnapshotManifest(projectsRoot);
    const project = manifest.projects.find((item) => item.id === 'sample-project');
    expect(project.associations.componentBindings).toEqual([]);
    expect(manifest.scope.componentBindings).toBe(0);
  });
});
