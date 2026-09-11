// @vitest-environment node

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createMcpRequestHandler,
  createToolImplementations,
  redactLocalPaths,
} from '../../packages/platform-mcp/src/index.js';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 })),
  );
});

async function createProjectsRoot() {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-platform-mcp-'));
  temporaryRoots.push(root);
  return root;
}

async function writeFixtureProject(projectsRoot, { broken = false } = {}) {
  const projectRoot = path.join(projectsRoot, 'mcp-demo');
  const write = async (relativePath, content) => {
    const target = path.join(projectRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  };
  await write(
    'project.json',
    JSON.stringify(
      broken
        ? { id: 'mcp-demo' }
        : {
            schemaVersion: 1,
            id: 'mcp-demo',
            name: 'MCP 演示',
            shortName: '演示',
            version: '0.1.0',
            defaultLocale: 'zh-CN',
            pageDefinitions: 'page-definitions.js',
            homepage: { visible: true },
            branding: {},
            theme: {
              primary: '#1677ff',
              primaryHover: '#146be6',
              primaryActive: '#1159bf',
              pageBackground: '#f5f7fb',
            },
            clients: [
              {
                id: 'admin',
                name: '管理端',
                defaultPage: 'overview',
                entry: { mode: 'direct' },
                layout: { type: 'sidebar' },
              },
            ],
            entries: [
              { id: 'admin', kind: 'client', clientId: 'admin', name: '管理端', order: 10 },
              { id: 'docs', kind: 'docs', name: '产品文档', order: 20 },
            ],
            docs: { enabled: true, root: 'docs' },
            prototype: { enabled: true, clients: { admin: { root: 'prototype/admin', shellMode: 'auto' } } },
            mobile: { enabled: false },
          },
      null,
      2,
    ),
  );
  await write(
    'page-definitions.js',
    `export const clientPageDefinitions = {\n  admin: {\n    sections: [{ id: 'workspace', title: '工作台' }],\n    pages: [\n      {\n        name: 'overview',\n        title: '总览',\n        path: 'overview',\n        section: 'workspace',\n        icon: 'Document',\n        sourceType: 'html-template',\n        source: 'overview.html',\n        fileName: 'overview.html',\n      },\n    ],\n  },\n};\n`,
  );
  await write(
    'html-pages/admin/overview.html',
    `<!doctype html>\n<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>总览</title><style>:root{--app-color-primary:#1677ff}</style></head>\n<body><main data-page-content data-business-content>总览内容</main>\n<script id="prototype-page-manifest" type="application/json">{"templateVersion":1,"pageKey":"overview","pageTitle":"总览","client":"admin","routePath":"/admin/overview"}</script>\n</body></html>`,
  );
  await write('docs/overview.md', '# 总览 PRD\n\n## 章节\n\n页面需呈现核心指标。\n');
  await write(
    '.platform/page-prd-links.json',
    JSON.stringify({ links: { admin: { overview: 'overview.md' } } }),
  );
  await write(
    '.platform/prd-bindings.json',
    JSON.stringify({
      bindings: [
        {
          id: 'binding-metrics',
          pagePath: '/p/mcp-demo/admin/overview',
          target: { type: 'selector', value: '[data-metrics]' },
          label: '指标筛选',
          prd: { document: 'overview.md', anchor: '章节' },
        },
      ],
    }),
  );
  await write('prototype/admin/.gitkeep', '');
  return projectRoot;
}

function createHandler(projectsRoot, mounts = {}) {
  return createMcpRequestHandler({
    tools: createToolImplementations({ projectsRoot, mounts }),
    redactOptions: { roots: [projectsRoot] },
  });
}

function parseCallText(response) {
  expect(response.result?.isError).toBe(false);
  return JSON.parse(response.result.content[0].text);
}

describe('MCP 协议层', () => {
  const handler = createMcpRequestHandler({ tools: createToolImplementations({ projectsRoot: 'projects' }) });

  it('initialize 握手回显协议版本并声明工具能力', async () => {
    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    expect(response.result).toMatchObject({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'prototype-platform-mcp' },
    });
  });

  it('未知协议版本回落到服务端支持版本', async () => {
    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    });
    expect(response.result.protocolVersion).toBe('2025-06-18');
  });

  it('通知不返回响应', async () => {
    expect(await handler({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('tools/list 只暴露名称、描述与参数 Schema', async () => {
    const response = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = response.result.tools.map((tool) => tool.name);
    expect(names).toEqual([
      'list_projects',
      'get_project_overview',
      'get_page_context',
      'list_documents',
      'list_associations',
      'list_health_issues',
    ]);
    for (const tool of response.result.tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool).not.toHaveProperty('run');
    }
  });

  it('未知工具返回 -32602，未知方法返回 -32601，无效消息返回 -32600', async () => {
    const unknownTool = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'write_file' },
    });
    expect(unknownTool.error).toMatchObject({ code: -32602 });
    const unknownMethod = await handler({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
    expect(unknownMethod.error).toMatchObject({ code: -32601 });
    const invalid = await handler({ jsonrpc: '1.0', id: 5, method: 'tools/list' });
    expect(invalid.error).toMatchObject({ code: -32600 });
  });
});

describe('MCP 只读工具', () => {
  it('list_projects 返回有效与无效项目且不泄露本机路径', async () => {
    const projectsRoot = await createProjectsRoot();
    await writeFixtureProject(projectsRoot);
    await fs.mkdir(path.join(projectsRoot, 'broken-project'));
    await fs.writeFile(path.join(projectsRoot, 'broken-project', 'project.json'), '{ 不是 JSON', 'utf8');

    const handler = createHandler(projectsRoot);
    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_projects' },
    });
    const text = response.result.content[0].text;
    const payload = JSON.parse(text);

    expect(payload.projects).toContainEqual({ id: 'mcp-demo', name: 'MCP 演示' });
    expect(payload.invalidProjects.map((project) => project.folder)).toContain('broken-project');
    expect(text).not.toMatch(/[A-Za-z]:[\\\\/]/u);
  });

  it('get_project_overview 返回主题、覆盖统计与追溯问题', async () => {
    const projectsRoot = await createProjectsRoot();
    await writeFixtureProject(projectsRoot);
    const handler = createHandler(projectsRoot);
    const response = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_project_overview', arguments: { projectId: 'mcp-demo' } },
    });
    const payload = parseCallText(response);

    expect(payload.project).toMatchObject({ id: 'mcp-demo', theme: { primary: '#1677ff' } });
    expect(payload.clients[0]).toMatchObject({ id: 'admin', pageCount: 1 });
    expect(payload.summary).toMatchObject({ pages: 1, linkedPages: 1, pageCoverage: 100 });
    expect(payload.issues.some((issue) => issue.type === 'missing-page-source')).toBe(false);
  });

  it('get_page_context 返回页面级 PRD 正文、大纲与组件关联章节摘录', async () => {
    const projectsRoot = await createProjectsRoot();
    await writeFixtureProject(projectsRoot);
    const handler = createHandler(projectsRoot);
    const response = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_page_context', arguments: { projectId: 'mcp-demo', page: 'admin/overview' } },
    });
    const payload = parseCallText(response);

    expect(payload).toMatchObject({ kind: 'page-delivery-context', page: { title: '总览' } });
    expect(payload.project.theme).toMatchObject({ primary: '#1677ff' });
    expect(payload.requirements[0].content).toContain('# 总览 PRD');
    expect(payload.requirements[0].outline).toContainEqual({ id: '章节', text: '章节', level: 2 });
    expect(payload.componentBindings[0].section).toMatchObject({ heading: '章节' });
    expect(payload.componentBindings[0].section.excerpt).toContain('核心指标');
    expect(JSON.stringify(payload)).not.toMatch(/[A-Za-z]:[\\\\/]/u);
  });

  it('get_page_context 对不存在的页面返回工具级错误', async () => {
    const projectsRoot = await createProjectsRoot();
    await writeFixtureProject(projectsRoot);
    const handler = createHandler(projectsRoot);
    const response = await handler({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'get_page_context', arguments: { projectId: 'mcp-demo', page: 'admin/missing' } },
    });
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain('找不到页面');
  });

  it('list_documents 不返回正文，list_associations 返回两类关联', async () => {
    const projectsRoot = await createProjectsRoot();
    await writeFixtureProject(projectsRoot);
    const handler = createHandler(projectsRoot);

    const documents = parseCallText(
      await handler({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list_documents', arguments: { projectId: 'mcp-demo' } },
      }),
    );
    expect(documents.documents[0]).toMatchObject({ path: 'overview.md', archived: false });
    expect(documents.documents[0]).not.toHaveProperty('content');
    expect(documents.documents[0]).not.toHaveProperty('headings');

    const associations = parseCallText(
      await handler({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'list_associations', arguments: { projectId: 'mcp-demo' } },
      }),
    );
    expect(associations.pageLinks[0]).toMatchObject({ clientId: 'admin', documentPath: 'overview.md' });
    expect(associations.componentBindings[0]).toMatchObject({
      id: 'binding-metrics',
      pagePath: '/p/mcp-demo/admin/overview',
    });
  });

  it('list_health_issues 返回健康问题且不包含挂载路径字段', async () => {
    const projectsRoot = await createProjectsRoot();
    await writeFixtureProject(projectsRoot);
    const handler = createHandler(projectsRoot);
    const response = await handler({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'list_health_issues', arguments: { projectId: 'mcp-demo' } },
    });
    const text = response.result.content[0].text;
    const payload = JSON.parse(text);

    expect(payload.projects[0].project).toMatchObject({ id: 'mcp-demo' });
    expect(payload.projects[0]).not.toHaveProperty('mounts');
    expect(text).not.toMatch(/[A-Za-z]:[\\\\/]/u);
  });
});

describe('路径脱敏', () => {
  it('替换盘符绝对路径与已知根目录，保留页面路由', () => {
    const redacted = redactLocalPaths(
      {
        source: 'D:\\工作文件\\秘密\\prototype\\login.html',
        posix: '/home/user/secret/prototype/login.html',
        route: '/p/demo/admin/login',
      },
      { roots: ['/home/user/secret/prototype'] },
    );

    expect(redacted.source).toBe('<local-path>');
    expect(redacted.posix).toBe('<local-path>');
    expect(redacted.route).toBe('/p/demo/admin/login');
  });
});

describe('MCP stdio 进程', () => {
  it('通过 stdin/stdout 完成握手与工具调用', async () => {
    const projectsRoot = await createProjectsRoot();
    await writeFixtureProject(projectsRoot);
    const child = spawn(
      process.execPath,
      [path.join(workspaceRoot, 'scripts', 'platform-mcp.mjs'), '--projects-root', projectsRoot],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    try {
      const lines = [];
      const reader = createInterface({ input: child.stdout });
      reader.on('line', (line) => lines.push(JSON.parse(line)));

      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`,
      );
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects' } })}\n`,
      );

      await vi_waitFor(() => lines.length >= 2);
      expect(lines[0].result).toMatchObject({ protocolVersion: '2025-06-18' });
      const projects = JSON.parse(lines[1].result.content[0].text);
      expect(projects.projects).toContainEqual({ id: 'mcp-demo', name: 'MCP 演示' });
      expect(lines[1].result.isError).toBe(false);
    } finally {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }, 30000);
});

async function vi_waitFor(condition, timeout = 15000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeout) throw new Error('等待 MCP 响应超时。');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
