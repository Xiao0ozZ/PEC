import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import type { PagePrdLinks, ProjectManifest } from '../../../../packages/platform-contracts/src/index.js';
import { platformApi } from '@/data/platform-api';
import { platformQueryKeys, useProjectManifest } from '@/data/use-platform-data';
import {
  compareContextBaseline,
  createContextExport,
  createPageContextPackage,
  createTraceabilityReport,
  loadAiContext,
  loadContextBaseline,
  saveContextBaseline,
  type AiContext,
  type ContextDocument,
  type ContextIssue,
  type ContextSuggestion,
} from '@/features/ai-context/context-loader';
import {
  Button,
  Descriptions,
  Empty,
  Result,
  Segmented,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
} from '@/ui/ant';
import {
  CheckCircleFilled,
  DatabaseOutlined,
  DownloadOutlined,
  LinkOutlined,
  ReloadOutlined,
} from '@/ui/ant/icons';
import { PlatformPage } from '@/ui/platform/PlatformPage';
import { Surface } from '@/ui/platform/Surface';

const { Text, Title } = Typography;

function downloadJson(payload: unknown, fileName: string) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function severityColor(value: string) {
  return value === 'error' ? 'error' : value === 'warning' ? 'warning' : 'blue';
}

export function AiContextPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const projectsQuery = useProjectManifest();
  const projects = projectsQuery.data?.projects ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('project') || '');
  const projectId = selectedProjectId || searchParams.get('project') || projects[0]?.id || '';
  const project = projects.find((item) => item.id === projectId) || null;
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedPageKey, setSelectedPageKey] = useState(searchParams.get('page') || '');
  const contextQuery = useQuery({
    queryKey: ['platform', 'ai-context', projectId],
    queryFn: () => loadAiContext(project as ProjectManifest),
    enabled: Boolean(project),
    staleTime: 0,
  });
  const context = contextQuery.data as AiContext | undefined;
  const page =
    context?.pages.find((item) => item.key === selectedPageKey || item.fullPath === selectedPageKey) ||
    context?.pages[0] ||
    null;
  const impact = context ? compareContextBaseline(context, loadContextBaseline(context.project.id)) : null;
  const saveSuggestion = useMutation({
    mutationFn: (links: PagePrdLinks) => platformApi.savePagePrdLinks(projectId, links),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.pagePrdLinks(projectId) });
      await queryClient.invalidateQueries({ queryKey: ['platform', 'ai-context', projectId] });
    },
  });

  function confirmSuggestion(pageKey: string, documentPath: string) {
    if (!context || !documentPath) return;
    const selected = context.pages.find((item) => item.key === pageKey);
    if (!selected) return;
    const links = Object.fromEntries(
      Object.entries(context.pagePrdLinks).map(([clientId, pages]) => [clientId, { ...pages }]),
    ) as PagePrdLinks;
    links[selected.clientId] ||= {};
    links[selected.clientId][selected.name] = documentPath;
    void saveSuggestion.mutate(links);
  }

  if (contextQuery.isPending)
    return (
      <div className="page-loading">
        <Spin size="large" />
      </div>
    );

  return (
    <PlatformPage
      title="AI 上下文中心"
      description="汇总项目页面、PRD、功能关联和变更影响，生成可追溯的交付上下文。"
      actions={
        <>
          <Select
            value={projectId || undefined}
            placeholder="选择项目"
            options={projects.map((item) => ({ value: item.id, label: item.name }))}
            onChange={setSelectedProjectId}
          />
          <Button
            icon={<ReloadOutlined />}
            loading={contextQuery.isFetching}
            onClick={() => void contextQuery.refetch()}
          >
            重新分析
          </Button>
        </>
      }
    >
      {contextQuery.isError ? (
        <Result
          status="error"
          title="项目上下文读取失败"
          subTitle={contextQuery.error.message}
          extra={<Button onClick={() => void contextQuery.refetch()}>重试</Button>}
        />
      ) : null}
      {!context ? (
        <Empty description="请选择项目" />
      ) : (
        <>
          <Surface className="context-summary">
            <div>
              <Title level={2}>{context.project.name}</Title>
              <Text type="secondary">页面与 PRD 覆盖率</Text>
            </div>
            <div className="context-summary__metrics">
              <Metric label="页面" value={context.summary.pages || 0} />
              <Metric label="PRD" value={context.summary.documents || 0} />
              <Metric label="页面覆盖" value={`${context.summary.pageCoverage || 0}%`} />
              <Metric label="功能关联" value={context.summary.componentBindings || 0} />
              <Metric
                label="待处理"
                value={(context.summary.errors || 0) + (context.summary.warnings || 0)}
                warning
              />
            </div>
          </Surface>
          <Segmented
            block
            value={activeTab}
            options={[
              { label: `概览 ${context.issues.length}`, value: 'overview' },
              { label: `页面矩阵 ${context.summary.pages || 0}`, value: 'pages' },
              { label: `PRD 索引 ${context.summary.documents || 0}`, value: 'documents' },
              { label: `关联建议 ${context.summary.suggestions || 0}`, value: 'suggestions' },
              { label: 'PRD 影响分析', value: 'impact' },
            ]}
            onChange={(value) => setActiveTab(String(value))}
          />
          <Surface className="context-workspace">
            {activeTab === 'overview' ? (
              <Overview
                context={context}
                onPage={(key) => {
                  setSelectedPageKey(key);
                  setActiveTab('pages');
                }}
              />
            ) : null}
            {activeTab === 'pages' ? (
              <Pages context={context} selected={page?.key || ''} onSelect={setSelectedPageKey} />
            ) : null}
            {activeTab === 'documents' ? (
              <Documents
                context={context}
                onPage={(key) => {
                  setSelectedPageKey(key);
                  setActiveTab('pages');
                }}
              />
            ) : null}
            {activeTab === 'suggestions' ? (
              <Suggestions context={context} busy={saveSuggestion.isPending} onConfirm={confirmSuggestion} />
            ) : null}
            {activeTab === 'impact' ? (
              <Impact
                context={context}
                impact={impact}
                onBaseline={() => {
                  saveContextBaseline(context);
                  void contextQuery.refetch();
                }}
                onPage={(key) => {
                  setSelectedPageKey(key);
                  setActiveTab('pages');
                }}
              />
            ) : null}
          </Surface>
          <div className="context-download-actions">
            <Button
              icon={<DownloadOutlined />}
              onClick={() =>
                downloadJson(createContextExport(context), `${context.project.id}-delivery-context.json`)
              }
            >
              导出上下文
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() =>
                downloadJson(
                  createContextExport(context, { includeDocumentContent: true }),
                  `${context.project.id}-delivery-context-full.json`,
                )
              }
            >
              导出完整上下文
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() =>
                downloadJson(createTraceabilityReport(context), `${context.project.id}-traceability.json`)
              }
            >
              导出可追溯报告
            </Button>
            {page ? (
              <Button
                icon={<DownloadOutlined />}
                onClick={() =>
                  downloadJson(
                    createPageContextPackage(context, page.key),
                    `${context.project.id}-${page.path}-context.json`,
                  )
                }
              >
                下载当前页面上下文
              </Button>
            ) : null}
          </div>
        </>
      )}
    </PlatformPage>
  );
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string | number;
  warning?: boolean;
}) {
  return (
    <div className={warning ? 'is-warning' : ''}>
      <Text>{label}</Text>
      <strong>{value}</strong>
    </div>
  );
}

function Overview({ context, onPage }: { context: AiContext; onPage: (key: string) => void }) {
  return (
    <div className="context-overview">
      <div className="context-overview__heading">
        <div>
          <Title level={2}>交付覆盖概览</Title>
          <Text type="secondary">AI 上下文由当前项目包、PRD 目录和关联配置实时生成。</Text>
        </div>
        <Tag color="blue">规则匹配，不是模型结论</Tag>
      </div>
      <div className="context-callouts">
        <div>
          <CheckCircleFilled />
          <strong>{context.summary.linkedPages || 0}</strong>
          <span>已关联 PRD 的页面</span>
        </div>
        <div>
          <LinkOutlined />
          <strong>{context.summary.componentBindings || 0}</strong>
          <span>功能级 PRD 关联</span>
        </div>
        <div>
          <DatabaseOutlined />
          <strong>{context.summary.suggestions || 0}</strong>
          <span>待确认关联建议</span>
        </div>
      </div>
      <Table<ContextIssue>
        rowKey={(item) => `${item.pageKey || ''}:${item.message}`}
        pagination={false}
        dataSource={context.issues}
        columns={[
          {
            title: '等级',
            dataIndex: 'severity',
            width: 100,
            render: (value: string) => (
              <Tag color={severityColor(value)}>
                {value === 'error' ? '错误' : value === 'warning' ? '提醒' : '提示'}
              </Tag>
            ),
          },
          { title: '问题', dataIndex: 'message' },
          { title: '影响对象', dataIndex: 'subject', width: 260 },
          {
            title: '操作',
            width: 100,
            render: (_value, item) =>
              item.pageKey ? (
                <Button type="link" onClick={() => onPage(item.pageKey || '')}>
                  查看页面
                </Button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}

function Pages({
  context,
  selected,
  onSelect,
}: {
  context: AiContext;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const current = context.pages.find((item) => item.key === selected) || context.pages[0];
  if (!current) return <Empty description="当前项目没有页面" />;
  const requirement = context.documents.find((document) => document.path === current.documentPath);
  return (
    <div className="context-pages">
      <div className="context-pages__toolbar">
        <Select
          value={current.key}
          showSearch
          options={context.pages.map((item) => ({
            value: item.key,
            label: `${item.clientName} · ${item.title}`,
          }))}
          onChange={onSelect}
        />
        <Button
          type="primary"
          onClick={() =>
            downloadJson(
              createPageContextPackage(context, current.key),
              `${context.project.id}-${current.path}-context.json`,
            )
          }
        >
          下载页面上下文
        </Button>
      </div>
      <div className="context-page-detail">
        <Descriptions
          column={1}
          title={current.title}
          items={[
            { key: 'client', label: '客户端', children: current.clientName },
            { key: 'route', label: '路由', children: <code>{current.fullPath}</code> },
            {
              key: 'source',
              label: '来源',
              children: `${current.sourceType} · ${current.source || '未登记'}`,
            },
            {
              key: 'section',
              label: '菜单分组',
              children: current.sectionTitle || current.sectionId || '未分组',
            },
          ]}
        />
        <section>
          <Title level={3}>{requirement?.title || '尚未关联 PRD'}</Title>
          {requirement ? (
            <>
              <Text type="secondary">{requirement.path}</Text>
              <ul>
                {requirement.headings.map((heading) => (
                  <li key={heading.id} className={`level-${heading.level}`}>
                    {heading.text}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty description="该页面尚未关联 PRD 文件" />
          )}
        </section>
      </div>
    </div>
  );
}

function Documents({ context, onPage }: { context: AiContext; onPage: (key: string) => void }) {
  return (
    <Table<ContextDocument>
      rowKey="path"
      dataSource={context.documents}
      pagination={false}
      scroll={{ x: 760 }}
      columns={[
        {
          title: 'PRD',
          dataIndex: 'title',
          minWidth: 260,
          render: (value: string, row) => (
            <div>
              <strong>{value}</strong>
              <small>{row.path}</small>
            </div>
          ),
        },
        { title: '文档结构', width: 120, render: (_value, row) => `${row.headings.length} 个标题` },
        {
          title: '关联页面',
          minWidth: 260,
          render: (_value, row) =>
            row.linkedPageKeys.length ? (
              row.linkedPageKeys.map((key) => (
                <Button key={key} size="small" type="link" onClick={() => onPage(key)}>
                  {context.pages.find((page) => page.key === key)?.title || key}
                </Button>
              ))
            ) : (
              <Text type="secondary">暂无页面级关联</Text>
            ),
        },
        {
          title: '状态',
          width: 100,
          render: (_value, row) => (
            <Tag color={row.archived ? 'default' : row.contentAvailable ? 'success' : 'warning'}>
              {row.archived ? '归档' : row.contentAvailable ? '可读取' : '正文失败'}
            </Tag>
          ),
        },
      ]}
    />
  );
}

function Suggestions({
  context,
  busy,
  onConfirm,
}: {
  context: AiContext;
  busy: boolean;
  onConfirm: (pageKey: string, documentPath: string) => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(context.suggestions.map((item) => [item.pageKey, item.candidates[0]?.path || ''])),
  );
  return (
    <Table<ContextSuggestion>
      rowKey="pageKey"
      dataSource={context.suggestions}
      pagination={false}
      scroll={{ x: 760 }}
      columns={[
        {
          title: '页面',
          minWidth: 220,
          render: (_value, item) => (
            <div>
              <strong>{item.page.title}</strong>
              <small>
                {item.page.clientName} · {item.page.fullPath}
              </small>
            </div>
          ),
        },
        {
          title: '建议 PRD',
          minWidth: 330,
          render: (_value, item) => (
            <Select
              value={choices[item.pageKey]}
              options={item.candidates.map((candidate) => ({
                value: candidate.path,
                label: `${candidate.title} · ${candidate.path}`,
              }))}
              onChange={(value) => setChoices((current) => ({ ...current, [item.pageKey]: value }))}
            />
          ),
        },
        {
          title: '可信度',
          width: 130,
          render: (_value, item) => {
            const choice = item.candidates.find((candidate) => candidate.path === choices[item.pageKey]);
            return (
              <Tag
                color={
                  choice?.confidence === 'high'
                    ? 'success'
                    : choice?.confidence === 'medium'
                      ? 'blue'
                      : 'warning'
                }
              >
                {choice?.confidence === 'high' ? '高' : choice?.confidence === 'medium' ? '中' : '低'}{' '}
                {Math.round((choice?.score || 0) * 100)}%
              </Tag>
            );
          },
        },
        {
          title: '操作',
          width: 130,
          render: (_value, item) => (
            <Button
              type="primary"
              size="small"
              loading={busy}
              disabled={!platformApi.development || !choices[item.pageKey]}
              onClick={() => onConfirm(item.pageKey, choices[item.pageKey])}
            >
              确认关联
            </Button>
          ),
        },
      ]}
    />
  );
}

function Impact({
  context,
  impact,
  onBaseline,
  onPage,
}: {
  context: AiContext;
  impact: ReturnType<typeof compareContextBaseline> | null;
  onBaseline: () => void;
  onPage: (key: string) => void;
}) {
  if (!impact || impact.status === 'uninitialized')
    return (
      <Result
        status="info"
        title="尚未建立 PRD 变更基线"
        subTitle="第一次建立基线只会写入当前浏览器的 localStorage，不会修改 PRD 或项目包。"
        extra={
          <Button type="primary" onClick={onBaseline}>
            建立分析基线
          </Button>
        }
      />
    );
  return (
    <div>
      <div className="impact-toolbar">
        <Text>基线：{impact.baselineCapturedAt?.replace('T', ' ').slice(0, 19)}</Text>
        <strong>
          {impact.changes.length ? `${impact.changes.length} 份文档有变化` : '当前文档与基线一致'}
        </strong>
        <Button onClick={onBaseline}>更新分析基线</Button>
      </div>
      {impact.changes.length ? (
        <Table
          rowKey="path"
          dataSource={impact.changes}
          pagination={false}
          columns={[
            {
              title: '变化',
              dataIndex: 'type',
              width: 100,
              render: (value: string) => (
                <Tag color={value === 'removed' ? 'error' : value === 'changed' ? 'warning' : 'success'}>
                  {value === 'removed' ? '删除' : value === 'changed' ? '变更' : '新增'}
                </Tag>
              ),
            },
            { title: 'PRD 文件', dataIndex: 'path' },
            {
              title: '影响页面',
              render: (_value, item: { linkedPageKeys: string[] }) =>
                item.linkedPageKeys.length ? (
                  item.linkedPageKeys.map((key) => (
                    <Button key={key} type="link" onClick={() => onPage(key)}>
                      {context.pages.find((page) => page.key === key)?.title || key}
                    </Button>
                  ))
                ) : (
                  <Text type="secondary">没有页面级关联</Text>
                ),
            },
          ]}
        />
      ) : (
        <Empty description="当前没有检测到 PRD 变化" />
      )}
    </div>
  );
}
