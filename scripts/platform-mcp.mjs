#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadProjectMounts } from '../packages/project-core/src/index.js';
import { runMcpServer } from '../packages/platform-mcp/src/index.js';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`产品功能体验中心本地 MCP Server（只读）

用法：
  npm run mcp:serve
  node scripts/platform-mcp.mjs [--projects-root projects]

说明：
  通过 stdin/stdout 提供 MCP（Model Context Protocol）stdio 传输，不监听任何网络端口。
  只暴露只读工具：list_projects、get_project_overview、get_page_context、
  list_documents、list_associations、list_health_issues。
  响应不包含本机绝对路径；配置示例见 README「AI 上下文中心」。`);
  process.exit(0);
}

const projectsRootIndex = args.indexOf('--projects-root');
const projectsRoot =
  projectsRootIndex >= 0 && args[projectsRootIndex + 1]
    ? path.resolve(workspaceRoot, args[projectsRootIndex + 1])
    : path.join(workspaceRoot, 'projects');
const mounts = await loadProjectMounts(path.join(workspaceRoot, 'project-mounts.local.json'));

await runMcpServer({ projectsRoot, mounts });
