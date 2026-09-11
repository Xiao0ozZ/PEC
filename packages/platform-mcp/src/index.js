import { createInterface } from 'node:readline';
import process from 'node:process';

import {
  createPageContextPackage,
  createProjectHealthReport,
  loadProjectAiContext,
  scanProjectPackages,
} from '../../project-core/src/index.js';

export const MCP_SERVER_NAME = 'prototype-platform-mcp';
export const MCP_SERVER_VERSION = '0.1.0';
export const MCP_PROTOCOL_VERSION = '2025-06-18';
const PROTOCOL_VERSION_PATTERN = /^20\d{2}-\d{2}-\d{2}$/u;

// MCP 响应不允许携带本机绝对路径：先替换已知根目录，再兜底替换盘符路径。
// 必须在 JSON 序列化前对对象深遍历替换；对序列化文本做正则会因反斜杠转义被截断。
const DRIVE_PATH_PATTERNS = [/[A-Za-z]:\\[^\s"',)）]*/gu, /[A-Za-z]:\/[^\s"',)）]*/gu];

export function redactLocalPaths(value, { roots = [] } = {}) {
  const redactString = (text) => {
    let result = text;
    for (const root of roots) {
      const absolute = String(root || '');
      if (!absolute) continue;
      const escaped = absolute.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      // 已知根目录连同其后的相对路径段一起替换，避免留下残余文件名。
      result = result.replace(new RegExp(`${escaped}(?:[/\\\\][^\\s"',)）]*)?`, 'giu'), '<local-path>');
      const forwardRoot = absolute.replaceAll('\\', '/');
      if (forwardRoot !== absolute) {
        const forwardEscaped = forwardRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        result = result.replace(
          new RegExp(`${forwardEscaped}(?:[/\\\\][^\\s"',)）]*)?`, 'giu'),
          '<local-path>',
        );
      }
    }
    for (const pattern of DRIVE_PATH_PATTERNS) result = result.replace(pattern, '<local-path>');
    return result;
  };
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactLocalPaths(item, { roots }));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactLocalPaths(item, { roots })]),
    );
  }
  return value;
}

function collectMountRoots(mounts) {
  return Object.values(mounts?.projects || {}).flatMap((mount) => [
    mount.root,
    mount.docsRoot,
    ...Object.values(mount.prototypes || {}),
  ]);
}

function resolveProtocolVersion(requested) {
  return PROTOCOL_VERSION_PATTERN.test(String(requested || '')) ? String(requested) : MCP_PROTOCOL_VERSION;
}

function projectReference(context, pageReference) {
  if (pageReference.startsWith('/p/')) return pageReference;
  if (pageReference.includes('/')) return `/p/${context.project.id}/${pageReference}`;
  return pageReference;
}

function stripDocumentBody(document) {
  const metadata = { ...document };
  delete metadata.content;
  delete metadata.headings;
  return metadata;
}

/**
 * 只读工具集：全部调用 project-core 领域函数，不自行解析项目文件，不提供写工具。
 * 每个工具返回已脱敏的 JSON 字符串。
 */
export function createToolImplementations({ projectsRoot, mounts = {} } = {}) {
  const roots = [projectsRoot, ...collectMountRoots(mounts)].filter(Boolean);
  const serialize = (payload) => JSON.stringify(redactLocalPaths(payload, { roots }), null, 2);

  async function loadContext(projectId) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(String(projectId || ''))) {
      throw new Error(`无效的项目 ID：${projectId || '空值'}`);
    }
    return loadProjectAiContext(projectsRoot, projectId, { mounts });
  }

  return [
    {
      name: 'list_projects',
      description: '列出当前工作区全部有效与无效项目包（id、名称），不返回本机路径。',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const scan = await scanProjectPackages(projectsRoot, { mounts });
        return serialize({
          projects: scan.projects.map((project) => ({ id: project.id, name: project.name })),
          invalidProjects: scan.invalidProjects.map((project) => ({
            folder: project.folder,
            errors: project.errors,
          })),
        });
      },
    },
    {
      name: 'get_project_overview',
      description:
        '返回单个项目的交付概览：客户端与页面计数、主题、覆盖统计、追溯问题（含修复建议）与关联候选。',
      inputSchema: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' } } },
      async run({ projectId }) {
        const context = await loadContext(projectId);
        return serialize({
          project: context.project,
          clients: context.clients,
          summary: context.summary,
          issues: context.issues,
          suggestions: context.suggestions.map(({ pageKey, candidates }) => ({ pageKey, candidates })),
        });
      },
    },
    {
      name: 'get_page_context',
      description:
        '返回单个页面的完整交付上下文：客户端、路由、来源、主题、页面级 PRD（含正文与大纲）、组件级关联（含章节摘录）与问题。page 支持 admin/overview、页面 name 或 /p/ 全路径。',
      inputSchema: {
        type: 'object',
        required: ['projectId', 'page'],
        properties: { projectId: { type: 'string' }, page: { type: 'string' } },
      },
      async run({ projectId, page }) {
        const context = await loadContext(projectId);
        const reference = projectReference(context, String(page || '').trim());
        const payload = createPageContextPackage(context, reference);
        if (!payload) throw new Error(`找不到页面：${page}`);
        return serialize(payload);
      },
    },
    {
      name: 'list_documents',
      description: '列出项目全部 PRD 文档元数据（路径、标题、归档、关联），不返回文档正文。',
      inputSchema: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' } } },
      async run({ projectId }) {
        const context = await loadContext(projectId);
        return serialize({ projectId, documents: context.documents.map(stripDocumentBody) });
      },
    },
    {
      name: 'list_associations',
      description: '列出项目的页面级 PRD 关联与组件级 PRD 关联。',
      inputSchema: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' } } },
      async run({ projectId }) {
        const context = await loadContext(projectId);
        return serialize({
          projectId,
          pageLinks: context.pages
            .filter((page) => page.documentPath)
            .map((page) => ({
              clientId: page.clientId,
              page: page.fullPath,
              pageTitle: page.title,
              documentPath: page.documentPath,
            })),
          componentBindings: context.bindings,
        });
      },
    },
    {
      name: 'list_health_issues',
      description:
        '返回项目健康检查问题（Manifest、Schema、路由、HTML、PRD、关联、资源），每条含级别与修复建议。不返回挂载目录的本机路径。',
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
      async run({ projectId } = {}) {
        const report = await createProjectHealthReport(projectsRoot, { mounts });
        const projects = report.projects
          .filter((project) => !projectId || project.project.id === projectId)
          .map((project) => ({ project: project.project, summary: project.summary, issues: project.issues }));
        if (projectId && !projects.length) throw new Error(`找不到项目：${projectId}`);
        return serialize({ generatedAt: report.generatedAt, summary: report.summary, projects });
      },
    },
  ];
}

/**
 * 纯函数协议层：处理单条 JSON-RPC 消息并返回响应（通知返回 null），便于测试。
 */
export function createMcpRequestHandler({ tools, redactOptions = {} }) {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const sendableTools = tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));

  return async function handle(message) {
    const { jsonrpc, id, method, params } = message || {};
    if (jsonrpc !== '2.0' || typeof method !== 'string') {
      return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: '无效请求。' } };
    }
    // 通知（无 id）不回应，包括 initialized 与其他未知通知。
    if (id === undefined || id === null) return null;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: resolveProtocolVersion(params?.protocolVersion),
          capabilities: { tools: {} },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          instructions:
            '产品功能体验中心本地只读上下文服务。先用 list_projects 取项目 ID，再按需获取项目概览、页面交付上下文、PRD、关联与健康问题。',
        },
      };
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: sendableTools } };

    if (method === 'tools/call') {
      const tool = toolsByName.get(String(params?.name || ''));
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `未知工具：${params?.name || '空值'}` },
        };
      }
      try {
        const text = await tool.run(params?.arguments || {});
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              { type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 2) },
            ],
            isError: false,
          },
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `工具执行失败：${redactLocalPaths(reason, redactOptions)}` }],
            isError: true,
          },
        };
      }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `未知方法：${method}` } };
  };
}

/**
 * stdio 传输循环：只读写入与读出，不监听任何网络端口。
 */
export async function runMcpServer({
  projectsRoot,
  mounts = {},
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const handler = createMcpRequestHandler({
    tools: createToolImplementations({ projectsRoot, mounts }),
    redactOptions: { roots: [projectsRoot, ...collectMountRoots(mounts)].filter(Boolean) },
  });
  const respond = (payload) => output.write(`${JSON.stringify(payload)}\n`);
  const reader = createInterface({ input });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      respond({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败。' } });
      continue;
    }
    if (Array.isArray(message)) {
      respond({ jsonrpc: '2.0', id: null, error: { code: -32600, message: '不支持批处理请求。' } });
      continue;
    }
    const response = await handler(message);
    if (response) respond(response);
  }
}
