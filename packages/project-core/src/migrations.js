import { CURRENT_PROJECT_SCHEMA_VERSION } from './constants.js';

// 没有 schemaVersion 字段的项目包视为 0 版：该字段是后来引入的，
// 早期项目包据此才有可迁移的起点，也让「旧包」成为可测试的真实场景。
export const LEGACY_PROJECT_SCHEMA_VERSION = 0;

const migrations = new Map();

export function readProjectSchemaVersion(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  if (manifest.schemaVersion === undefined || manifest.schemaVersion === null) {
    return LEGACY_PROJECT_SCHEMA_VERSION;
  }
  const version = Number(manifest.schemaVersion);
  if (!Number.isInteger(version) || version < LEGACY_PROJECT_SCHEMA_VERSION) return null;
  return version;
}

export function hasProjectMigrationPath(fromVersion, targetVersion = CURRENT_PROJECT_SCHEMA_VERSION) {
  if (!Number.isInteger(fromVersion) || fromVersion < LEGACY_PROJECT_SCHEMA_VERSION) return false;
  for (let version = fromVersion; version < targetVersion; version += 1) {
    if (!migrations.has(version)) return false;
  }
  return true;
}

/**
 * 判断项目包的 Schema 状态，不读写文件：
 * current 已是当前版本；upgradable 可迁移；unsupported 版本过高；
 * blocked 版本过旧但缺少迁移器；invalid 版本字段非法。
 */
export function describeProjectSchemaVersion(manifest, targetVersion = CURRENT_PROJECT_SCHEMA_VERSION) {
  const version = readProjectSchemaVersion(manifest);
  if (version === null) return { version: null, targetVersion, status: 'invalid' };
  if (version === targetVersion) return { version, targetVersion, status: 'current' };
  if (version > targetVersion) return { version, targetVersion, status: 'unsupported' };
  return {
    version,
    targetVersion,
    status: hasProjectMigrationPath(version, targetVersion) ? 'upgradable' : 'blocked',
  };
}

export function migrateProjectManifest(manifest, targetVersion = CURRENT_PROJECT_SCHEMA_VERSION) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('project.json 根节点必须是对象。');
  }
  let current = JSON.parse(JSON.stringify(manifest));
  let version = readProjectSchemaVersion(current);
  if (version === null) {
    throw new Error('project.json 的 schemaVersion 必须是非负整数。');
  }
  if (version > targetVersion) {
    throw new Error(`项目包 schemaVersion ${version} 高于当前支持版本 ${targetVersion}。`);
  }
  while (version < targetVersion) {
    const migrate = migrations.get(version);
    if (!migrate) throw new Error(`缺少 schemaVersion ${version} → ${version + 1} 的迁移器。`);
    current = migrate(current);
    version += 1;
    current.schemaVersion = version;
  }
  return current;
}

export function registerProjectMigration(fromVersion, migrate) {
  if (
    !Number.isInteger(fromVersion) ||
    fromVersion < LEGACY_PROJECT_SCHEMA_VERSION ||
    typeof migrate !== 'function'
  ) {
    throw new TypeError('迁移器必须提供有效的起始版本和迁移函数。');
  }
  migrations.set(fromVersion, migrate);
}

// 0 → 1：早期项目包只缺少版本标记，字段结构与 v1 一致，补上标记即可。
registerProjectMigration(LEGACY_PROJECT_SCHEMA_VERSION, (manifest) => ({ ...manifest }));
