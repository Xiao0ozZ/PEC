import { describe, expect, it } from 'vitest';

import {
  compareContextBaseline,
  createContextBaseline,
  createContextExport,
  createPageContextPackage,
  createProjectContext,
  createTraceabilityReport,
  extractDocumentSection,
} from '../../packages/project-core/src/index.js';

function createFixture(overrides = {}) {
  const project = {
    id: 'demo',
    name: '演示项目',
    version: '1.0.0',
    docs: { enabled: true },
    pagePrdLinks: { admin: { dashboard: '需求/控制台.md' } },
    clients: [
      {
        id: 'admin',
        name: '管理端',
        definition: {
          sections: [{ id: 'workspace', title: '工作台' }],
          pages: [
            {
              name: 'dashboard',
              title: '控制台',
              path: 'dashboard',
              section: 'workspace',
              view: 'DashboardView.vue',
            },
            {
              name: 'newOrder',
              title: '新增订单',
              path: 'new-order',
              section: 'workspace',
              sourceType: 'html-direct',
              source: 'new_order.html',
            },
          ],
        },
      },
    ],
    ...overrides.project,
  };
  return createProjectContext({
    project,
    documentManifest: overrides.documentManifest || {
      documents: [
        { path: '需求/控制台.md', title: '控制台', fileName: '控制台', folders: ['需求'] },
        { path: '需求/新增订单.md', title: '新增订单', fileName: '新增订单', folders: ['需求'] },
      ],
    },
    documentSources:
      overrides.documentSources === undefined
        ? {
            '需求/控制台.md': '# 控制台\n\n## 数据范围',
            '需求/新增订单.md': '# 新增订单\n\n## 表单规则',
          }
        : overrides.documentSources,
    bindings: overrides.bindings || [],
    sourceAvailability: overrides.sourceAvailability || {},
  });
}

describe('AI project context', () => {
  it('builds coverage, issues and reviewable PRD suggestions', () => {
    const context = createFixture();

    expect(context.summary).toMatchObject({ pages: 2, linkedPages: 1, pageCoverage: 50 });
    expect(context.issues).toContainEqual(
      expect.objectContaining({ type: 'page-without-prd', pageKey: 'admin:newOrder' }),
    );
    expect(context.suggestions[0]).toMatchObject({
      pageKey: 'admin:newOrder',
      candidates: [expect.objectContaining({ path: '需求/新增订单.md', confidence: 'high' })],
    });
    expect(context.documents[0].headings).toEqual([
      { id: '控制台', text: '控制台', level: 1 },
      { id: '数据范围', text: '数据范围', level: 2 },
    ]);
  });

  it('creates compact and page-specific machine-readable packages', () => {
    const context = createFixture();
    const compact = createContextExport(context);
    const full = createContextExport(context, { includeDocumentContent: true });
    const pagePackage = createPageContextPackage(context, '/p/demo/admin/dashboard');

    expect(compact.documents[0]).not.toHaveProperty('content');
    expect(full.documents[0].content).toContain('# 控制台');
    expect(pagePackage).toMatchObject({
      kind: 'page-delivery-context',
      page: { title: '控制台' },
      requirements: [{ path: '需求/控制台.md' }],
    });
  });

  it('can suggest a general PRD when the page title matches one of its headings', () => {
    const context = createFixture({
      project: { pagePrdLinks: {} },
      documentManifest: {
        documents: [{ path: '需求/订单业务.md', title: '订单业务', fileName: '订单业务', folders: ['需求'] }],
      },
      documentSources: { '需求/订单业务.md': '# 订单业务\n\n## 新增订单\n\n表单规则。' },
    });
    const suggestion = context.suggestions.find((item) => item.pageKey === 'admin:newOrder');

    expect(suggestion?.candidates[0]).toMatchObject({
      path: '需求/订单业务.md',
      confidence: 'medium',
    });
    expect(suggestion?.candidates[0].reasons).toContain('页面标题命中 PRD 章节标题');
  });

  it('reports changed PRDs and the pages affected since a local baseline', () => {
    const before = createFixture();
    const baseline = createContextBaseline(before);
    const after = createFixture({
      documentSources: {
        '需求/控制台.md': '# 控制台\n\n## 数据范围\n\n新增规则。',
        '需求/新增订单.md': '# 新增订单\n\n## 表单规则',
      },
    });
    const impact = compareContextBaseline(after, baseline);

    expect(impact.status).toBe('changed');
    expect(impact.summary).toMatchObject({ changed: 1, impactedPages: 1 });
    expect(impact.changes[0]).toMatchObject({
      type: 'changed',
      path: '需求/控制台.md',
      linkedPageKeys: ['admin:dashboard'],
    });
  });

  it('creates an auditable page, PRD and component traceability matrix', () => {
    const context = createFixture({
      bindings: [
        {
          id: 'dashboard-filter',
          pagePath: '/p/demo/admin/dashboard',
          selector: '[data-filter]',
          label: '数据筛选',
          prd: { document: '需求/控制台.md', anchor: '数据范围' },
        },
      ],
    });
    const report = createTraceabilityReport(context);

    expect(context.summary).toMatchObject({ pagesWithComponentBindings: 1, componentCoverage: 50 });
    expect(report).toMatchObject({
      kind: 'project-traceability-report',
      rows: [
        expect.objectContaining({
          pageKey: 'admin:dashboard',
          status: 'covered',
          componentBindings: [expect.objectContaining({ id: 'dashboard-filter' })],
        }),
        expect.objectContaining({ pageKey: 'admin:newOrder', status: 'uncovered' }),
      ],
    });
  });

  it('reports stale component anchors and orphan PRDs separately', () => {
    const context = createFixture({
      bindings: [
        {
          id: 'stale-anchor',
          pagePath: '/p/demo/admin/dashboard',
          prd: { document: '需求/控制台.md', anchor: '不存在的章节' },
        },
      ],
    });

    expect(context.issues).toContainEqual(expect.objectContaining({ type: 'missing-binding-anchor' }));
    expect(context.issues).toContainEqual(
      expect.objectContaining({ type: 'document-without-page', documentPath: '需求/新增订单.md' }),
    );
  });

  it('attaches an actionable suggestion to every traceability issue', () => {
    const context = createFixture({
      bindings: [
        {
          id: 'stale-anchor',
          pagePath: '/p/demo/admin/dashboard',
          prd: { document: '需求/控制台.md', anchor: '不存在的章节' },
        },
      ],
    });

    expect(context.issues.length).toBeGreaterThan(0);
    for (const issue of context.issues) {
      expect(issue.suggestion, `issue ${issue.type} 缺少建议`).toBeTruthy();
    }
  });

  it('flags duplicate page identities inside the same client', () => {
    const context = createFixture({
      project: {
        clients: [
          {
            id: 'admin',
            name: '管理端',
            definition: {
              sections: [{ id: 'workspace', title: '工作台' }],
              pages: [
                {
                  name: 'dashboard',
                  title: '控制台',
                  path: 'dashboard',
                  section: 'workspace',
                  view: 'DashboardView.vue',
                },
                {
                  name: 'dashboardCopy',
                  title: '控制台副本',
                  path: 'dashboard',
                  section: 'workspace',
                  view: 'DashboardCopy.vue',
                },
              ],
            },
          },
        ],
      },
    });

    expect(context.issues).toContainEqual(
      expect.objectContaining({
        type: 'duplicate-page-identity',
        severity: 'error',
        subject: '管理端 · dashboard',
      }),
    );
  });

  it('reports missing page sources only when the caller verified availability', () => {
    const withoutCheck = createFixture({
      project: { pagePrdLinks: {} },
    });
    expect(withoutCheck.issues.some((issue) => issue.type === 'missing-page-source')).toBe(false);

    const withCheck = createFixture({
      project: { pagePrdLinks: {} },
      sourceAvailability: { 'admin:newOrder': false, 'admin:dashboard': true },
    });
    expect(withCheck.issues).toContainEqual(
      expect.objectContaining({
        type: 'missing-page-source',
        severity: 'error',
        pageKey: 'admin:newOrder',
        source: 'new_order.html',
      }),
    );
    expect(
      withCheck.issues.some(
        (issue) => issue.type === 'missing-page-source' && issue.pageKey === 'admin:dashboard',
      ),
    ).toBe(false);
  });

  it('includes the project theme in the context and page packages', () => {
    const context = createFixture({
      project: { theme: { primaryColor: '#2563eb' } },
    });
    expect(context.project.theme).toEqual({ primaryColor: '#2563eb' });
    expect(createPageContextPackage(context, 'admin:dashboard').project.theme).toEqual({
      primaryColor: '#2563eb',
    });
  });

  it('extracts the referenced PRD section for component bindings', () => {
    const context = createFixture({
      documentSources: {
        '需求/控制台.md': '# 控制台\n\n## 数据范围\n\n仅统计本部门。',
        '需求/新增订单.md': '# 新增订单\n\n## 表单规则',
      },
      bindings: [
        {
          id: 'dashboard-filter',
          pagePath: '/p/demo/admin/dashboard',
          label: '数据筛选',
          prd: { document: '需求/控制台.md', anchor: '数据范围' },
        },
      ],
    });

    expect(extractDocumentSection('# 控制台\n\n## 数据范围\n\n仅统计本部门。', '数据范围')).toMatchObject({
      anchor: '数据范围',
      heading: '数据范围',
      excerpt: '仅统计本部门。',
    });
    expect(extractDocumentSection('# 控制台', '不存在的章节')).toBeNull();

    const pagePackage = createPageContextPackage(context, 'admin:dashboard');
    expect(pagePackage.componentBindings[0]).toMatchObject({
      id: 'dashboard-filter',
      document: '需求/控制台.md',
      anchor: '数据范围',
    });
    expect(pagePackage.componentBindings[0].section).toMatchObject({
      heading: '数据范围',
      excerpt: '仅统计本部门。',
    });

    const report = createTraceabilityReport(context);
    expect(report.rows[0].componentBindings[0].section).toMatchObject({ heading: '数据范围' });
  });

  it('marks binding sections and requirement outlines explicitly when content is unavailable', () => {
    const context = createFixture({
      documentSources: {},
      bindings: [
        {
          id: 'dashboard-filter',
          pagePath: '/p/demo/admin/dashboard',
          prd: { document: '需求/控制台.md', anchor: '数据范围' },
        },
      ],
    });
    const pagePackage = createPageContextPackage(context, 'admin:dashboard');

    expect(pagePackage.requirements[0]).toMatchObject({ contentAvailable: false, content: '' });
    // 正文不可用时无法解析标题，outline 显式为空，不编造章节结构。
    expect(pagePackage.requirements[0].outline).toEqual([]);
    expect(pagePackage.componentBindings[0].section).toEqual({
      document: '需求/控制台.md',
      contentAvailable: false,
      anchor: '数据范围',
    });
  });
});
