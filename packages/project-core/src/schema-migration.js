import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CURRENT_PROJECT_SCHEMA_VERSION, PROJECT_ID_PATTERN } from './constants.js';
import { readJsonFile, withFileRollback, writeJsonAtomic } from './filesystem.js';
import { describeProjectSchemaVersion, migrateProjectManifest } from './migrations.js';
import { resolveProjectRoot } from './project-mounts.js';

const MANIFEST_FILE_NAME = 'project.json';

function manifestPathFor(projectsRoot, projectId, mounts) {
  return path.join(resolveProjectRoot(projectsRoot, projectId, mounts), MANIFEST_FILE_NAME);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 逐字段对比迁移前后的 Manifest，生成可展示的差异列表。
 * 只描述 added / removed / changed，不改写任何数据。
 */
export function diffProjectManifest(before, after, basePath = '') {
  const changes = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of [...keys].sort()) {
    const pointer = basePath ? `${basePath}.${key}` : key;
    const left = before?.[key];
    const right = after?.[key];
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    if (left === undefined) {
      changes.push({ path: pointer, kind: 'added', after: right });
      continue;
    }
    if (right === undefined) {
      changes.push({ path: pointer, kind: 'removed', before: left });
      continue;
    }
    if (isPlainObject(left) && isPlainObject(right)) {
      changes.push(...diffProjectManifest(left, right, pointer));
      continue;
    }
    changes.push({ path: pointer, kind: 'changed', before: left, after: right });
  }
  return changes;
}

async function listProjectDirectories(projectsRoot) {
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * 扫描全部项目包的 Schema 版本状态。只读取 project.json，不做完整业务校验，
 * 因此版本过旧或过新的项目包也能被列出，而不是被笼统归为「项目不可用」。
 */
export async function scanProjectSchemaVersions(
  projectsRoot,
  { mounts = {}, targetVersion = CURRENT_PROJECT_SCHEMA_VERSION } = {},
) {
  const root = path.resolve(projectsRoot);
  const mountedIds = Object.keys(mounts?.projects || {}).filter((id) => PROJECT_ID_PATTERN.test(id));
  const ids = [...new Set([...(await listProjectDirectories(root)), ...mountedIds])].sort();

  const projects = [];
  for (const id of ids) {
    const manifestPath = manifestPathFor(root, id, mounts);
    let manifest = null;
    let error = '';
    try {
      manifest = await readJsonFile(manifestPath);
    } catch (cause) {
      error = cause.message;
    }
    if (!manifest) {
      projects.push({
        id,
        manifestPath,
        version: null,
        targetVersion,
        status: 'unreadable',
        canMigrate: false,
        error: error || `${MANIFEST_FILE_NAME} 不存在。`,
      });
      continue;
    }
    const described = describeProjectSchemaVersion(manifest, targetVersion);
    projects.push({
      id,
      name: typeof manifest.name === 'string' ? manifest.name : '',
      manifestPath,
      version: described.version,
      targetVersion,
      status: described.status,
      canMigrate: described.status === 'upgradable',
      error: '',
    });
  }

  const summary = projects.reduce(
    (total, project) => ({ ...total, [project.status]: (total[project.status] || 0) + 1 }),
    {},
  );
  return {
    targetVersion,
    projects,
    summary: {
      total: projects.length,
      current: summary.current || 0,
      upgradable: summary.upgradable || 0,
      unsupported: summary.unsupported || 0,
      blocked: summary.blocked || 0,
      invalid: summary.invalid || 0,
      unreadable: summary.unreadable || 0,
    },
  };
}

function backupDirectoryFor(manifestPath, migrationId) {
  return path.join(path.dirname(manifestPath), '.backups', 'schema', migrationId);
}

/**
 * 生成迁移预览：给出版本区间、逐字段差异和备份位置，但不写入任何文件。
 */
export async function planProjectMigration(
  projectsRoot,
  projectId,
  { mounts = {}, targetVersion = CURRENT_PROJECT_SCHEMA_VERSION, migrationId = '' } = {},
) {
  if (!PROJECT_ID_PATTERN.test(String(projectId || ''))) {
    throw new Error('项目 ID 无效，无法生成迁移预览。');
  }
  const manifestPath = manifestPathFor(path.resolve(projectsRoot), projectId, mounts);
  const manifest = await readJsonFile(manifestPath);
  const described = describeProjectSchemaVersion(manifest, targetVersion);

  const base = {
    projectId,
    manifestPath,
    fromVersion: described.version,
    targetVersion,
    status: described.status,
  };
  if (described.status !== 'upgradable') {
    return { ...base, canMigrate: false, changes: [], backupDirectory: '', migrated: null };
  }

  const migrated = migrateProjectManifest(manifest, targetVersion);
  const id = migrationId || `v${described.version}-to-v${targetVersion}`;
  return {
    ...base,
    canMigrate: true,
    changes: diffProjectManifest(manifest, migrated),
    backupDirectory: backupDirectoryFor(manifestPath, id),
    migrated,
  };
}

/**
 * 执行迁移：先备份原文件，再原子替换 project.json。
 * 任一步失败都会回滚 project.json 与备份文件，磁盘保持迁移前状态。
 */
export async function applyProjectMigration(
  projectsRoot,
  projectId,
  {
    mounts = {},
    targetVersion = CURRENT_PROJECT_SCHEMA_VERSION,
    migrationId = '',
    migratedAt = new Date().toISOString(),
    onBeforeCommit = null,
  } = {},
) {
  const plan = await planProjectMigration(projectsRoot, projectId, {
    mounts,
    targetVersion,
    migrationId,
  });
  if (!plan.canMigrate) {
    const error = new Error(
      plan.status === 'current'
        ? `项目 ${projectId} 已是 schemaVersion ${targetVersion}，无需迁移。`
        : `项目 ${projectId} 当前状态为 ${plan.status}，不能自动迁移。`,
    );
    error.code = 'MIGRATION_NOT_APPLICABLE';
    error.plan = plan;
    throw error;
  }

  const backupManifestPath = path.join(plan.backupDirectory, MANIFEST_FILE_NAME);
  const backupMetadataPath = path.join(plan.backupDirectory, 'metadata.json');
  const original = await fs.readFile(plan.manifestPath);

  await withFileRollback([plan.manifestPath, backupManifestPath, backupMetadataPath], async () => {
    await fs.mkdir(plan.backupDirectory, { recursive: true });
    await writeJsonAtomic(backupMetadataPath, {
      kind: 'project-schema-migration',
      projectId,
      fromVersion: plan.fromVersion,
      toVersion: targetVersion,
      migratedAt,
      manifestPath: plan.manifestPath,
    });
    await fs.writeFile(backupManifestPath, original);
    // 故障注入点：验证提交前失败时 project.json 与备份都会回滚。
    if (onBeforeCommit) await onBeforeCommit();
    await writeJsonAtomic(plan.manifestPath, plan.migrated);
  });

  return {
    ok: true,
    projectId,
    manifestPath: plan.manifestPath,
    backupDirectory: plan.backupDirectory,
    backupManifestPath,
    fromVersion: plan.fromVersion,
    toVersion: targetVersion,
    migratedAt,
    changes: plan.changes,
  };
}
