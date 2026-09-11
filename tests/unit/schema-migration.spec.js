// @vitest-environment node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  LEGACY_PROJECT_SCHEMA_VERSION,
  applyProjectMigration,
  describeProjectSchemaVersion,
  diffProjectManifest,
  migrateProjectManifest,
  planProjectMigration,
  readProjectSchemaVersion,
  scanProjectSchemaVersions,
} from '../../packages/project-core/src/index.js';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createProjectsRoot() {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-schema-migration-'));
  temporaryRoots.push(root);
  return root;
}

async function writeProject(projectsRoot, projectId, manifest) {
  const projectRoot = path.join(projectsRoot, projectId);
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, 'project.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return projectRoot;
}

function legacyManifest(overrides = {}) {
  return { id: 'legacy-project', name: '旧版项目', version: '0.1.0', clients: [], ...overrides };
}

describe('SCHEMA-01 版本判定', () => {
  it('缺少 schemaVersion 视为 0 版', () => {
    expect(readProjectSchemaVersion(legacyManifest())).toBe(LEGACY_PROJECT_SCHEMA_VERSION);
    expect(readProjectSchemaVersion({ schemaVersion: 1 })).toBe(1);
  });

  it('非法版本字段返回 null', () => {
    expect(readProjectSchemaVersion({ schemaVersion: 'one' })).toBeNull();
    expect(readProjectSchemaVersion({ schemaVersion: 1.5 })).toBeNull();
    expect(readProjectSchemaVersion({ schemaVersion: -1 })).toBeNull();
    expect(readProjectSchemaVersion(null)).toBeNull();
  });

  it('按状态区分当前、可升级、过高与非法', () => {
    expect(describeProjectSchemaVersion({ schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION })).toMatchObject({
      status: 'current',
    });
    expect(describeProjectSchemaVersion(legacyManifest())).toMatchObject({ status: 'upgradable' });
    expect(describeProjectSchemaVersion({ schemaVersion: 99 })).toMatchObject({ status: 'unsupported' });
    expect(describeProjectSchemaVersion({ schemaVersion: 'x' })).toMatchObject({ status: 'invalid' });
  });

  it('迁移 0 版补齐版本标记且不丢字段', () => {
    const migrated = migrateProjectManifest(legacyManifest({ description: '保留' }));
    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migrated).toMatchObject({ id: 'legacy-project', name: '旧版项目', description: '保留' });
  });

  it('版本过高时拒绝迁移', () => {
    expect(() => migrateProjectManifest({ schemaVersion: 99 })).toThrow(/高于当前支持版本/u);
  });
});

describe('SCHEMA-01 差异展示', () => {
  it('区分新增、删除与修改', () => {
    const changes = diffProjectManifest(
      { keep: 1, drop: 2, change: 'before', nested: { a: 1 } },
      { keep: 1, add: 3, change: 'after', nested: { a: 2 } },
    );
    expect(changes).toEqual([
      { path: 'add', kind: 'added', after: 3 },
      { path: 'change', kind: 'changed', before: 'before', after: 'after' },
      { path: 'drop', kind: 'removed', before: 2 },
      { path: 'nested.a', kind: 'changed', before: 1, after: 2 },
    ]);
  });
});

describe('SCHEMA-01 扫描项目包版本', () => {
  it('空项目目录返回空结果', async () => {
    const projectsRoot = await createProjectsRoot();
    const report = await scanProjectSchemaVersions(projectsRoot);
    expect(report.projects).toEqual([]);
    expect(report.summary).toMatchObject({ total: 0, current: 0, upgradable: 0 });
  });

  it('同时列出当前版本、旧版本、过高版本与不可读项目包', async () => {
    const projectsRoot = await createProjectsRoot();
    await writeProject(projectsRoot, 'current-project', { schemaVersion: 1, id: 'current-project' });
    await writeProject(projectsRoot, 'legacy-project', legacyManifest());
    await writeProject(projectsRoot, 'future-project', { schemaVersion: 99, id: 'future-project' });
    await fs.mkdir(path.join(projectsRoot, 'empty-project'), { recursive: true });

    const report = await scanProjectSchemaVersions(projectsRoot);
    const byId = Object.fromEntries(report.projects.map((project) => [project.id, project]));
    expect(byId['current-project']).toMatchObject({ status: 'current', canMigrate: false, version: 1 });
    expect(byId['legacy-project']).toMatchObject({ status: 'upgradable', canMigrate: true, version: 0 });
    expect(byId['future-project']).toMatchObject({ status: 'unsupported', canMigrate: false });
    expect(byId['empty-project']).toMatchObject({ status: 'unreadable', canMigrate: false });
    expect(report.summary).toMatchObject({ total: 4, current: 1, upgradable: 1, unsupported: 1 });
  });
});

describe('SCHEMA-01 预览与写入', () => {
  it('预览给出差异和备份位置，且不修改任何文件', async () => {
    const projectsRoot = await createProjectsRoot();
    const projectRoot = await writeProject(projectsRoot, 'legacy-project', legacyManifest());
    const manifestPath = path.join(projectRoot, 'project.json');
    const before = await fs.readFile(manifestPath, 'utf8');

    const plan = await planProjectMigration(projectsRoot, 'legacy-project');
    expect(plan).toMatchObject({ canMigrate: true, fromVersion: 0, targetVersion: 1 });
    expect(plan.changes).toEqual([
      { path: 'schemaVersion', kind: 'added', after: CURRENT_PROJECT_SCHEMA_VERSION },
    ]);
    expect(plan.backupDirectory).toContain(path.join('.backups', 'schema'));

    expect(await fs.readFile(manifestPath, 'utf8')).toBe(before);
    await expect(fs.access(plan.backupDirectory)).rejects.toThrow();
  });

  it('确认后写入并留下可追溯备份', async () => {
    const projectsRoot = await createProjectsRoot();
    const projectRoot = await writeProject(projectsRoot, 'legacy-project', legacyManifest());
    const manifestPath = path.join(projectRoot, 'project.json');
    const before = await fs.readFile(manifestPath, 'utf8');

    const result = await applyProjectMigration(projectsRoot, 'legacy-project', {
      migratedAt: '2026-08-23T00:00:00.000Z',
    });
    expect(result).toMatchObject({ ok: true, fromVersion: 0, toVersion: 1 });

    const written = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    expect(written.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(written.name).toBe('旧版项目');

    expect(await fs.readFile(result.backupManifestPath, 'utf8')).toBe(before);
    const metadata = JSON.parse(
      await fs.readFile(path.join(result.backupDirectory, 'metadata.json'), 'utf8'),
    );
    expect(metadata).toMatchObject({
      kind: 'project-schema-migration',
      projectId: 'legacy-project',
      fromVersion: 0,
      toVersion: 1,
      migratedAt: '2026-08-23T00:00:00.000Z',
    });
  });

  it('重复执行不会二次迁移，也不会破坏已迁移的项目包', async () => {
    const projectsRoot = await createProjectsRoot();
    const projectRoot = await writeProject(projectsRoot, 'legacy-project', legacyManifest());
    const manifestPath = path.join(projectRoot, 'project.json');

    await applyProjectMigration(projectsRoot, 'legacy-project');
    const afterFirst = await fs.readFile(manifestPath, 'utf8');

    await expect(applyProjectMigration(projectsRoot, 'legacy-project')).rejects.toMatchObject({
      code: 'MIGRATION_NOT_APPLICABLE',
    });
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(afterFirst);

    const plan = await planProjectMigration(projectsRoot, 'legacy-project');
    expect(plan).toMatchObject({ status: 'current', canMigrate: false });
  });

  it('写入中途失败时自动恢复，磁盘保持迁移前状态', async () => {
    const projectsRoot = await createProjectsRoot();
    const projectRoot = await writeProject(projectsRoot, 'legacy-project', legacyManifest());
    const manifestPath = path.join(projectRoot, 'project.json');
    const before = await fs.readFile(manifestPath, 'utf8');

    await expect(
      applyProjectMigration(projectsRoot, 'legacy-project', {
        onBeforeCommit: () => Promise.reject(new Error('注入的提交失败')),
      }),
    ).rejects.toThrow('注入的提交失败');

    // project.json 未被改写。
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(before);
    // 版本状态仍是可升级，说明迁移确实没有生效。
    const plan = await planProjectMigration(projectsRoot, 'legacy-project');
    expect(plan).toMatchObject({ status: 'upgradable', fromVersion: 0 });
  });

  it('拒绝非法项目 ID 与不可迁移状态', async () => {
    const projectsRoot = await createProjectsRoot();
    await writeProject(projectsRoot, 'future-project', { schemaVersion: 99, id: 'future-project' });

    await expect(planProjectMigration(projectsRoot, '../escape')).rejects.toThrow(/项目 ID 无效/u);
    await expect(applyProjectMigration(projectsRoot, 'future-project')).rejects.toMatchObject({
      code: 'MIGRATION_NOT_APPLICABLE',
    });
  });
});
