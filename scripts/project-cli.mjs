#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_ID_PATTERN,
  REVIEW_SNAPSHOT_FILE_NAME,
  applyProjectMigration,
  createContextBaseline,
  createPageContextPackage,
  createProjectHealthReport,
  createReviewSnapshotManifest,
  createTraceabilityReport,
  inspectHtmlPrototype,
  loadProjectAiContext,
  loadProjectMounts,
  normalizeProjectMounts,
  planProjectMigration,
  readJsonFile,
  resolveProjectRoot,
  scanProjectPackages,
  scanProjectSchemaVersions,
  writeJsonAtomic,
} from '../packages/project-core/src/index.js';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const [rawKey, inlineValue] = value.slice(2).split('=', 2);
    const nextValue = values[index + 1];
    if (inlineValue !== undefined) result[rawKey] = inlineValue;
    else if (nextValue && !nextValue.startsWith('--')) {
      result[rawKey] = nextValue;
      index += 1;
    } else result[rawKey] = true;
  }
  return result;
}

function resolveFromWorkspace(value, fallback) {
  return path.resolve(workspaceRoot, String(value || fallback));
}

function printHelp() {
  console.log(`产品功能体验中心 CLI

用法：
  npm run project -- validate [--projects-root projects] [--json]
  npm run project -- init --id sample --name "示例项目" [--projects-root projects]
  npm run project -- install-example [--id sample-project] [--projects-root projects]
  npm run project -- migrate [--project sample] [--scan] [--json] [--write]
  npm run project -- mounts [--json]
  npm run project -- mount --project sample [--root D:\\project] [--docs D:\\docs] [--prototype admin=D:\\html]
  npm run project -- health [--project sample] [--json]
  npm run project -- preflight --file prototypes/page.html [--json]
  npm run project -- snapshot --project sample [--output output/context-baseline.json]
  npm run project -- trace --project sample [--baseline output/context-baseline.json] [--output output/traceability.json]
  npm run project -- context --project sample --page admin/dashboard [--output output/page-context.json]
  npm run project -- serve [--host 127.0.0.1] [--port 5188]
  npm run project -- build-review [--base /] [--out-dir dist]

说明：
  validate      校验全部项目包，不写入文件。
  init          从标准模板创建最小项目包，目标目录存在时拒绝覆盖。
  install-example 安装仓库内置的可运行示例，目标目录存在时拒绝覆盖。
  migrate       扫描项目包 schemaVersion；指定 --project 时展示差异和备份位置，只有 --write 才写回。
  mounts        查看仅保存在本机的项目资料挂载。
  mount         设置或清除完整项目、PRD 或 HTML 外部目录，不修改源文件。
  health        检查项目包、挂载目录、HTML 原型和需求关联健康状态。
  preflight     检查单个 HTML 是否符合独立预览、直读和导入的基础契约。
  snapshot      保存项目 PRD 上下文基线，用于后续差异和影响分析。
  trace         导出页面、PRD、组件关联覆盖率和相对基线的影响清单。
  context       导出单个页面的完整交付上下文（主题、来源、PRD、组件关联与章节）。
  serve         启动当前工程的 Vite 开发服务。
  build-review  生成静态评审快照，不修改项目包。`);
}

function mountsPath() {
  return path.join(workspaceRoot, 'project-mounts.local.json');
}

async function loadWorkspaceMounts() {
  return loadProjectMounts(mountsPath());
}

async function loadContextInput(projectsRoot, projectId) {
  // 上下文装载统一走 project-core 共享加载器，CLI 只补充本机挂载来源。
  return loadProjectAiContext(projectsRoot, projectId, { mounts: await loadWorkspaceMounts() });
}

async function contextCommand(args) {
  const projectId = String(args.project || '').trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('context 需要有效的 --project。');
  const pageReference = String(args.page || '').trim();
  if (!pageReference) {
    throw new Error('context 需要 --page，例如 admin/dashboard 或页面 name。');
  }
  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const context = await loadContextInput(projectsRoot, projectId);
  const fullPath = pageReference.startsWith('/p/')
    ? pageReference
    : pageReference.includes('/')
      ? `/p/${projectId}/${pageReference}`
      : pageReference;
  const payload = createPageContextPackage(context, fullPath);
  if (!payload) throw new Error(`找不到页面：${pageReference}`);
  if (args.output) {
    const output = resolveFromWorkspace(args.output, '');
    await writeJsonAtomic(output, payload);
    console.log(`页面交付上下文已生成：${output}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

async function preflightCommand(args) {
  const filePath = resolveFromWorkspace(args.file, '');
  if (!args.file) throw new Error('preflight 需要 --file。');
  // 互链存在性按同目录兄弟页面判断；单文件场景（如粘贴内容）没有目录上下文时跳过。
  const fileDirectory = path.dirname(filePath);
  const knownFiles = new Set(
    (await fs.readdir(fileDirectory))
      .filter((name) => /\.(?:html?|htm)$/iu.test(name))
      .map((name) => path.relative(fileDirectory, path.join(fileDirectory, name)).split(path.sep).join('/')),
  );
  const result = inspectHtmlPrototype(await fs.readFile(filePath, 'utf8'), {
    fileName: path.basename(filePath),
    knownFiles,
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.valid ? '✓' : '✗'} ${filePath}`);
    for (const item of result.errors) console.error(`  错误 [${item.code}] ${item.message}`);
    for (const item of result.warnings) console.warn(`  提醒 [${item.code}] ${item.message}`);
  }
  if (!result.valid) process.exitCode = 1;
}

async function healthCommand(args) {
  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const report = await createProjectHealthReport(projectsRoot, { mounts: await loadWorkspaceMounts() });
  const selectedId = String(args.project || '').trim();
  const projects = selectedId
    ? report.projects.filter((project) => project.project.id === selectedId)
    : report.projects;
  if (selectedId && !projects.length) throw new Error(`找不到可用项目：${selectedId}`);
  const result = { ...report, projects };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const item of projects) {
      console.log(`\n${item.project.name}（${item.project.id}）`);
      console.log(
        `  状态 ${item.summary.status}，错误 ${item.summary.errors} 个，提醒 ${item.summary.warnings} 个`,
      );
      console.log(
        `  路由 ${item.summary.routes} 个，HTML ${item.summary.htmlFiles} 个，PRD ${item.summary.documents} 个`,
      );
      for (const problem of item.issues)
        console.log(`  ${problem.severity === 'error' ? '✗' : '!'} [${problem.category}] ${problem.message}`);
    }
  }
  if (projects.some((item) => item.summary.errors)) {
    process.exitCode = 1;
  }
}

async function snapshotCommand(args) {
  const projectId = String(args.project || '').trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('snapshot 需要有效的 --project。');
  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const context = await loadContextInput(projectsRoot, projectId);
  const output = resolveFromWorkspace(args.output, `output/context-baselines/${projectId}.json`);
  await writeJsonAtomic(output, createContextBaseline(context));
  console.log(`项目上下文基线已保存：${output}`);
}

async function traceCommand(args) {
  const projectId = String(args.project || '').trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('trace 需要有效的 --project。');
  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const context = await loadContextInput(projectsRoot, projectId);
  const baseline = args.baseline
    ? await readJsonFile(resolveFromWorkspace(args.baseline, ''))
    : await readJsonFile(path.join(workspaceRoot, 'output', 'context-baselines', `${projectId}.json`), {
        fallback: null,
      });
  const payload = createTraceabilityReport(context, { baseline });
  const output = resolveFromWorkspace(args.output, `output/traceability/${projectId}.json`);
  await writeJsonAtomic(output, payload);
  console.log(`需求追溯报告已生成：${output}`);
}

function parsePrototypeMounts(value) {
  const entries = {};
  for (const item of String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const separator = item.indexOf('=');
    if (separator <= 0) throw new Error('--prototype 使用 client-id=绝对目录，多项用逗号分隔。');
    const clientId = item.slice(0, separator).trim();
    const root = item.slice(separator + 1).trim();
    if (!PROJECT_ID_PATTERN.test(clientId) || !path.isAbsolute(root)) {
      throw new Error(`无效的原型挂载：${item}`);
    }
    entries[clientId] = path.resolve(root);
  }
  return entries;
}

async function mountsCommand(args) {
  const mounts = await loadWorkspaceMounts();
  if (args.json) console.log(JSON.stringify(mounts, null, 2));
  else if (!Object.keys(mounts.projects).length) console.log('当前没有本地项目挂载。');
  else {
    for (const [projectId, mount] of Object.entries(mounts.projects)) {
      console.log(`\n${projectId}`);
      if (mount.root) console.log(`  项目：${mount.root}`);
      if (mount.docsRoot) console.log(`  PRD：${mount.docsRoot}`);
      for (const [clientId, root] of Object.entries(mount.prototypes || {})) {
        console.log(`  HTML ${clientId}：${root}`);
      }
    }
  }
}

async function mountCommand(args) {
  const projectId = String(args.project || '').trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('mount 需要有效的 --project。');
  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const requestedRoot = args.root ? path.resolve(String(args.root)) : '';
  if (args.root && !path.isAbsolute(String(args.root))) throw new Error('--root 必须使用绝对目录。');
  const mounts = await loadWorkspaceMounts();
  const projectRoot = requestedRoot || resolveProjectRoot(projectsRoot, projectId, mounts);
  if (
    !(await fs
      .stat(path.join(projectRoot, 'project.json'))
      .then(() => true)
      .catch(() => false))
  ) {
    throw new Error(`项目包不存在：${projectId}`);
  }

  if (requestedRoot) {
    const manifest = await readJsonFile(path.join(requestedRoot, 'project.json'));
    if (manifest.id !== projectId)
      throw new Error(`所选项目的 id 为 ${manifest.id || '空值'}，与 --project 不一致。`);
  }

  const current = mounts.projects[projectId] || { prototypes: {} };
  const next = { ...current, prototypes: { ...(current.prototypes || {}) } };
  if (requestedRoot) next.root = requestedRoot;
  if (args['clear-root']) delete next.root;
  if (args.docs) {
    if (!path.isAbsolute(String(args.docs))) throw new Error('--docs 必须使用绝对目录。');
    next.docsRoot = path.resolve(String(args.docs));
  }
  if (args['clear-docs']) delete next.docsRoot;
  Object.assign(next.prototypes, parsePrototypeMounts(args.prototype));
  for (const clientId of String(args['clear-prototype'] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    delete next.prototypes[clientId];
  }
  for (const target of [next.root, next.docsRoot, ...Object.values(next.prototypes)]) {
    if (!target) continue;
    const isDirectory = await fs
      .stat(target)
      .then((stats) => stats.isDirectory())
      .catch(() => false);
    if (!isDirectory) throw new Error(`挂载目录不存在：${target}`);
  }

  const projects = { ...mounts.projects };
  if (next.root || next.docsRoot || Object.keys(next.prototypes).length) projects[projectId] = next;
  else delete projects[projectId];
  const normalized = normalizeProjectMounts({ schemaVersion: 1, projects });
  await writeJsonAtomic(mountsPath(), normalized);
  console.log(`本地项目挂载已更新：${mountsPath()}`);
}

async function validateCommand(args) {
  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const result = await scanProjectPackages(projectsRoot, { mounts: await loadWorkspaceMounts() });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const project of result.projects) console.log(`✓ ${project.id}（${project.name}）`);
    for (const project of result.invalidProjects) {
      console.error(`✗ ${project.folder}`);
      for (const error of project.errors) console.error(`  - ${error}`);
    }
    console.log(`\n有效 ${result.projects.length} 个，无效 ${result.invalidProjects.length} 个。`);
  }
  if (result.invalidProjects.length) process.exitCode = 1;
}

async function initCommand(args) {
  const projectId = String(args.id || '').trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('--id 必须使用小写 kebab-case。');
  const projectName = String(args.name || projectId).trim();
  if (!projectName) throw new Error('--name 不能为空。');

  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const templateRoot = resolveFromWorkspace(args.template, 'templates/project-package');
  const targetRoot = path.join(projectsRoot, projectId);
  const targetExists = await fs
    .stat(targetRoot)
    .then(() => true)
    .catch(() => false);
  if (targetExists) throw new Error(`项目目录已存在，未覆盖：${targetRoot}`);

  await fs.mkdir(projectsRoot, { recursive: true });
  await fs.cp(templateRoot, targetRoot, { recursive: true, errorOnExist: true, force: false });
  try {
    const manifestPath = path.join(targetRoot, 'project.json');
    const manifest = await readJsonFile(manifestPath);
    manifest.id = projectId;
    manifest.name = projectName;
    manifest.shortName = String(args['short-name'] || projectName).trim();
    await writeJsonAtomic(manifestPath, manifest);
  } catch (error) {
    await fs.rm(targetRoot, { recursive: true, force: true });
    throw error;
  }
  console.log(`项目包已创建：${targetRoot}`);
}

async function installExampleCommand(args) {
  const projectId = String(args.id || 'sample-project').trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('--id 必须使用小写 kebab-case。');
  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const sourceRoot = path.join(workspaceRoot, 'examples', 'sample-project');
  const targetRoot = path.join(projectsRoot, projectId);
  const exists = await fs
    .stat(targetRoot)
    .then(() => true)
    .catch(() => false);
  if (exists) throw new Error(`项目目录已存在，未覆盖：${targetRoot}`);
  await fs.mkdir(projectsRoot, { recursive: true });
  await fs.cp(sourceRoot, targetRoot, { recursive: true, errorOnExist: true, force: false });
  if (projectId !== 'sample-project') {
    const manifestPath = path.join(targetRoot, 'project.json');
    const manifest = await readJsonFile(manifestPath);
    manifest.id = projectId;
    await writeJsonAtomic(manifestPath, manifest);
  }
  console.log(`示例项目已安装：${targetRoot}`);
}

function describeMigrationChange(change) {
  const value = (input) => JSON.stringify(input);
  if (change.kind === 'added') return `  + ${change.path} = ${value(change.after)}`;
  if (change.kind === 'removed') return `  - ${change.path}（原值 ${value(change.before)}）`;
  return `  ~ ${change.path}：${value(change.before)} → ${value(change.after)}`;
}

const MIGRATION_STATUS_TEXT = {
  current: '已是当前版本',
  upgradable: '可升级',
  unsupported: '版本高于当前支持',
  blocked: '缺少迁移器',
  invalid: 'schemaVersion 非法',
  unreadable: 'project.json 不可读',
};

async function migrateScan(projectsRoot, mounts, asJson) {
  const report = await scanProjectSchemaVersions(projectsRoot, { mounts });
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`当前支持的 schemaVersion：${report.targetVersion}`);
  if (!report.projects.length) {
    console.log('未发现项目包。');
    return;
  }
  for (const project of report.projects) {
    const version = project.version === null ? '未知' : `v${project.version}`;
    const label = MIGRATION_STATUS_TEXT[project.status] || project.status;
    console.log(`${project.canMigrate ? '↑' : '·'} ${project.id}（${version}，${label}）`);
    if (project.error) console.log(`    ${project.error}`);
  }
  const { total, current, upgradable, unsupported, blocked, invalid, unreadable } = report.summary;
  console.log(
    `\n共 ${total} 个：${current} 个已是当前版本，${upgradable} 个可升级，${unsupported} 个版本过高，${blocked} 个缺少迁移器，${invalid} 个版本非法，${unreadable} 个不可读。`,
  );
  if (upgradable) console.log('使用 migrate --project <id> 查看差异，确认后加 --write 才会写回。');
}

async function migrateCommand(args) {
  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const mounts = await loadWorkspaceMounts();

  if (args.scan || !args.project) {
    if (!args.project && !args.scan) console.log('未指定 --project，改为扫描全部项目包版本。\n');
    await migrateScan(projectsRoot, mounts, Boolean(args.json));
    return;
  }

  const projectId = String(args.project).trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('--project 必须使用有效的项目 ID。');

  const plan = await planProjectMigration(projectsRoot, projectId, { mounts });
  if (!plan.canMigrate) {
    console.log(
      `项目 ${projectId} 当前 schemaVersion ${plan.fromVersion ?? '未知'}，状态：${MIGRATION_STATUS_TEXT[plan.status] || plan.status}。`,
    );
    console.log('无需迁移或无法自动迁移，未修改任何文件。');
    return;
  }

  console.log(`项目 ${projectId}：schemaVersion v${plan.fromVersion} → v${plan.targetVersion}`);
  console.log(`配置文件：${plan.manifestPath}`);
  console.log(`备份位置：${plan.backupDirectory}`);
  console.log(plan.changes.length ? '\n将发生以下变更：' : '\n没有字段变更，仅更新版本标记。');
  for (const change of plan.changes) console.log(describeMigrationChange(change));

  if (!args.write) {
    console.log('\n当前为预览模式，未修改任何文件；确认后添加 --write 才会写回。');
    return;
  }

  const result = await applyProjectMigration(projectsRoot, projectId, { mounts });
  console.log(`\n已迁移并写回：${result.manifestPath}`);
  console.log(`原文件已备份到：${result.backupManifestPath}`);
}

// 直接以 node 运行本地 Vite 入口：Node 20.12 起 spawn 不再允许直接执行 npm.cmd
// （CVE-2024-27980 修复），而 shell:true 会带来参数注入风险。
function runVite(arguments_, environment = {}) {
  const viteBin = path.join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin, ...arguments_], {
      cwd: workspaceRoot,
      env: { ...process.env, ...environment },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', (error) =>
      reject(
        error.code === 'ENOENT' ? new Error(`找不到本地 Vite：${viteBin}。请先执行 npm install。`) : error,
      ),
    );
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`子进程被信号 ${signal} 终止。`));
      else resolve(code ?? 1);
    });
  });
}

async function serveCommand(args) {
  const host = String(args.host || '127.0.0.1');
  const port = Number(args.port || 5188);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port 必须是有效端口。');
  process.exitCode = await runVite(['--host', host, '--port', String(port), '--strictPort']);
}

async function buildReviewCommand(args) {
  const base = String(args.base || '/');
  // Vite 会把相对 outDir 解析到 config 的 root（apps/platform-react），
  // 因此这里统一解析成绝对路径，保证构建产物与评审清单落在同一目录。
  const outputRoot = resolveFromWorkspace(args['out-dir'], 'dist');
  const buildArguments = ['build'];
  if (args['out-dir']) buildArguments.push('--outDir', outputRoot);
  const exitCode = await runVite(buildArguments, { VITE_BASE_PATH: base });
  process.exitCode = exitCode;
  if (exitCode) return;

  const projectsRoot = resolveFromWorkspace(args['projects-root'], 'projects');
  const manifest = await createReviewSnapshotManifest(projectsRoot, {
    mounts: await loadWorkspaceMounts(),
    base,
  });
  const manifestPath = path.join(outputRoot, REVIEW_SNAPSHOT_FILE_NAME);
  await writeJsonAtomic(manifestPath, manifest);

  console.log(`静态评审清单已生成：${manifestPath}`);
  console.log(
    `快照时间 ${manifest.generatedAt}；范围：${manifest.scope.projects} 个项目、${manifest.scope.clients} 个客户端、${manifest.scope.pages} 个页面、${manifest.scope.documents} 份 PRD、${manifest.scope.pageLinks} 条页面关联、${manifest.scope.componentBindings} 条组件关联。`,
  );
  if (manifest.invalidProjects.length) {
    console.log(`注意：${manifest.invalidProjects.length} 个项目包无效，未纳入快照范围。`);
  }
  console.log('评审包为只读快照，直接用浏览器打开 index.html 即可查看，不需要 Node 环境。');
}

const args = parseArguments(process.argv.slice(2));
const command = args._[0];

try {
  if (!command || command === 'help' || args.help) printHelp();
  else if (command === 'validate') await validateCommand(args);
  else if (command === 'init') await initCommand(args);
  else if (command === 'install-example') await installExampleCommand(args);
  else if (command === 'migrate') await migrateCommand(args);
  else if (command === 'mounts') await mountsCommand(args);
  else if (command === 'mount') await mountCommand(args);
  else if (command === 'health') await healthCommand(args);
  else if (command === 'preflight') await preflightCommand(args);
  else if (command === 'snapshot') await snapshotCommand(args);
  else if (command === 'trace') await traceCommand(args);
  else if (command === 'context') await contextCommand(args);
  else if (command === 'serve') await serveCommand(args);
  else if (command === 'build-review') await buildReviewCommand(args);
  else throw new Error(`未知命令：${command}`);
} catch (error) {
  console.error(`CLI 执行失败：${error.message}`);
  process.exitCode = 1;
}
