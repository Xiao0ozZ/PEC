import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { platformApi } from '@/data/platform-api';
import { useProjectManifest } from '@/data/use-platform-data';
import type { RouteClient } from '@/features/routes/route-model';
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Result,
  Segmented,
  Select,
  Spin,
  Tag,
  Typography,
  Upload,
  type UploadProps,
} from '@/ui/ant';
import { CheckCircleFilled, DownloadOutlined, UploadOutlined } from '@/ui/ant/icons';
import { PlatformPage } from '@/ui/platform/PlatformPage';
import { Surface } from '@/ui/platform/Surface';

const { Text, Title } = Typography;

const iconOptions = [
  'Calendar',
  'CirclePlus',
  'DataBoard',
  'Document',
  'Files',
  'House',
  'List',
  'Location',
  'Lock',
  'Management',
  'Medal',
  'Money',
  'Odometer',
  'Postcard',
  'Setting',
  'Tickets',
  'User',
  'Van',
  'Warning',
];

interface RouteData {
  clients: RouteClient[];
}
interface Inspection {
  valid: boolean;
  format?: string;
  errors: string[];
  warnings: string[];
  stats: { blocks: unknown[]; dialogs: number; drawers: number; logicLength?: number };
  manifest: {
    client?: string;
    routePath?: string;
    menuSection?: string;
    menuTitle?: string;
    menuIcon?: string;
    pageTitle?: string;
    pageType?: string;
    pageKey?: string;
    fileName?: string;
  };
}
interface ImportForm {
  client: string;
  routePath: string;
  menuSection: string;
  menuTitle: string;
  menuIcon: string;
  fileName: string;
}

function isInspection(value: Record<string, unknown>): value is Record<string, unknown> & Inspection {
  return typeof value.valid === 'boolean' && Array.isArray(value.errors) && Array.isArray(value.warnings);
}

function fileNameFromResult(result: Record<string, unknown>, key: 'html' | 'zip') {
  const value = result[key];
  return typeof value === 'string'
    ? `/__page-transfer/download?path=${encodeURIComponent(value.replace(/^\//u, ''))}`
    : '';
}

export function PageTransferPage() {
  const [searchParams] = useSearchParams();
  const projectQuery = useProjectManifest();
  const projects = projectQuery.data?.projects ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('project') || '');
  const projectId = selectedProjectId || searchParams.get('project') || projects[0]?.id || '';
  const project = projects.find((item) => item.id === projectId) || null;
  const routeQuery = useQuery({
    queryKey: ['platform', 'routes', projectId],
    queryFn: () => platformApi.listRoutes(projectId),
    enabled: Boolean(projectId),
    staleTime: 0,
  });
  const routeData = routeQuery.data as RouteData | undefined;
  const clients = routeData?.clients || [];
  const [mode, setMode] = useState<'import' | 'export'>('import');
  const [sourceHtml, setSourceHtml] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectError, setInspectError] = useState('');
  const [inspectBusy, setInspectBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);
  const [importMode, setImportMode] = useState<'create' | 'replace'>('create');
  const [replacePagePath, setReplacePagePath] = useState('');
  const [confirmImport, setConfirmImport] = useState(false);
  const [form, setForm] = useState<ImportForm>({
    client: '',
    routePath: '',
    menuSection: '',
    menuTitle: '',
    menuIcon: 'Document',
    fileName: '',
  });
  const [exportClient, setExportClient] = useState('all');
  const [exportSearch, setExportSearch] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [packageName, setPackageName] = useState('页面演示包');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportResult, setExportResult] = useState<Record<string, unknown> | null>(null);
  const activeClient = clients.find((client) => client.id === form.client) || clients[0] || null;
  const clientId = form.client || activeClient?.id || '';
  const sections = activeClient?.sections || [];
  const replacementPages = (activeClient?.pages || []).filter((page) => page.sourceType !== 'html-direct');
  const selectedReplacement = replacementPages.find((page) => page.path === replacePagePath) || null;
  const exportGroups = (() => {
    const allowedClients =
      exportClient === 'all' ? clients : clients.filter((client) => client.id === exportClient);
    const keyword = exportSearch.trim().toLowerCase();
    return allowedClients
      .map((client) => ({
        client,
        pages: client.pages
          .filter((page) => page.menu !== false && page.sourceType !== 'html-direct')
          .map((page) => ({ ...page, fullPath: `/p/${projectId}/${client.id}/${page.path}` }))
          .filter((page) => !keyword || `${page.title} ${page.fullPath}`.toLowerCase().includes(keyword)),
      }))
      .filter((group) => group.pages.length);
  })();
  const proposedPath = form.routePath.trim()
    ? `/p/${projectId}/${clientId}/${form.routePath.trim().replace(/^\/+|\/+$/gu, '')}`
    : '';
  const routeConflict = Boolean(
    activeClient?.pages.some(
      (page) =>
        page.path !== selectedReplacement?.path &&
        `/p/${projectId}/${clientId}/${page.path}` === proposedPath,
    ),
  );

  const uploadProps: UploadProps = {
    accept: '.html,.htm',
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      const html = await file.text();
      setSourceHtml(html);
      setSourceName(file.name);
      setInspection(null);
      setImportResult(null);
      setInspectError('');
      setForm((current) => ({ ...current, fileName: file.name }));
      void inspectSource(html, file.name);
      return false;
    },
  };

  function switchProject(nextProjectId: string) {
    setSelectedProjectId(nextProjectId);
    setForm({
      client: '',
      routePath: '',
      menuSection: '',
      menuTitle: '',
      menuIcon: 'Document',
      fileName: '',
    });
    setInspection(null);
    setImportResult(null);
    setReplacePagePath('');
    setSelectedPaths([]);
    setExportResult(null);
  }

  async function inspectSource(html = sourceHtml, fileName = sourceName) {
    if (!html) return;
    setInspectBusy(true);
    setInspectError('');
    setImportResult(null);
    try {
      const payload = await platformApi.inspectHtml(html);
      if (!isInspection(payload)) throw new Error('HTML 检查接口返回的数据无效。');
      setInspection(payload);
      const manifest = payload.manifest || {};
      const nextClient = clients.find((client) => client.id === manifest.client) || clients[0];
      setForm({
        client: nextClient?.id || '',
        routePath:
          String(manifest.routePath || '')
            .split('/')
            .filter(Boolean)
            .at(-1) || '',
        menuSection: nextClient?.sections.some((section) => section.id === manifest.menuSection)
          ? String(manifest.menuSection)
          : nextClient?.sections[0]?.id || '',
        menuTitle: String(manifest.menuTitle || manifest.pageTitle || ''),
        menuIcon: String(manifest.menuIcon || 'Document'),
        fileName: fileName || String(manifest.fileName || ''),
      });
    } catch (error) {
      setInspection(null);
      setInspectError(error instanceof Error ? error.message : '模板检查失败。');
    } finally {
      setInspectBusy(false);
    }
  }

  function applyReplacement(path: string) {
    setReplacePagePath(path);
    const page = replacementPages.find((item) => item.path === path);
    if (!page) return;
    setForm((current) => ({
      ...current,
      routePath: page.path,
      menuSection: page.section || sections[0]?.id || '',
      menuTitle: page.title,
      menuIcon: page.icon || 'Document',
      fileName: current.fileName || `${page.title}.html`,
    }));
  }

  async function runImport() {
    setConfirmImport(false);
    setImportBusy(true);
    setInspectError('');
    try {
      const result = await platformApi.importPage(sourceHtml, {
        ...form,
        client: clientId,
        projectId,
        mode: importMode,
        replacePagePath,
        sourceFile: sourceName || null,
        fileName: form.fileName.trim(),
        runtime: 'html',
      });
      setImportResult(result);
    } catch (error) {
      setInspectError(error instanceof Error ? error.message : '导入失败。');
    } finally {
      setImportBusy(false);
    }
  }

  async function runExport() {
    setExportBusy(true);
    setExportError('');
    setExportResult(null);
    try {
      setExportResult(await platformApi.exportPages({ projectId, selectedPaths, packageName }));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setExportBusy(false);
    }
  }

  const importReady = Boolean(
    inspection?.valid &&
    sourceHtml &&
    form.fileName.trim() &&
    clientId &&
    form.routePath.trim() &&
    form.menuTitle.trim() &&
    form.menuSection &&
    !routeConflict &&
    (importMode !== 'replace' || replacePagePath),
  );
  return (
    <PlatformPage
      title="页面导入导出"
      description="检查并导入规范 HTML，或将已登记页面导出为可独立运行、可再次回导的文件。"
      actions={
        <>
          <Tag>{project?.name || '未选择项目'}</Tag>
          <Tag color={platformApi.development ? 'processing' : 'default'}>
            {platformApi.development ? '本机可写' : '静态只读'}
          </Tag>
        </>
      }
    >
      <Alert
        type="info"
        showIcon
        title="导入支持规范 HTML 和本平台导出的可回导 HTML；导出演示区与可编辑源文件区分开。"
      />
      {!platformApi.development ? (
        <Alert type="warning" showIcon title="页面导入导出仅允许在运行开发服务的本机使用。" />
      ) : null}
      <Segmented
        block
        value={mode}
        options={[
          { label: '导入 HTML 原型', value: 'import', icon: <UploadOutlined /> },
          { label: '导出演示包', value: 'export', icon: <DownloadOutlined /> },
        ]}
        onChange={(value) => setMode(value as 'import' | 'export')}
      />
      {mode === 'import' ? (
        <Surface className="transfer-panel">
          <div className="transfer-panel__heading">
            <div>
              <Title level={2}>导入规范 HTML</Title>
              <Text type="secondary">上传由 HTML 原型模板创建的页面，先检查再写入工程。</Text>
            </div>
            <Tag>只支持 templateVersion 1</Tag>
          </div>
          <ProjectTarget projects={projects} value={projectId} onChange={switchProject} />
          <div className="transfer-upload-row">
            <Upload {...uploadProps}>
              <Button icon={<UploadOutlined />}>{sourceName || '选择 HTML 文件'}</Button>
            </Upload>
            <Button
              type="primary"
              disabled={!sourceHtml}
              loading={inspectBusy}
              onClick={() => void inspectSource()}
            >
              检查模板
            </Button>
          </div>
          {inspectError ? <Alert type="error" showIcon title={inspectError} /> : null}
          {inspection ? <InspectionPanel inspection={inspection} /> : null}
          {inspection?.valid ? (
            <>
              <div className="transfer-form-heading">
                <Title level={3}>确认工程登记信息</Title>
                <Text type="secondary">
                  页面内容、弹窗、逻辑和模拟数据会按原型整体导入；替换页面时，原页面会自动备份。
                </Text>
              </div>
              <Form layout="vertical">
                <Form.Item label="导入方式">
                  <Segmented
                    value={importMode}
                    options={[
                      { label: '新增页面', value: 'create' },
                      { label: '替换页面', value: 'replace' },
                    ]}
                    onChange={(value) => {
                      setImportMode(value as 'create' | 'replace');
                      if (value === 'create') setReplacePagePath('');
                    }}
                  />
                </Form.Item>
                <div className="transfer-form-grid">
                  <Form.Item label="客户端">
                    <Select
                      value={clientId || undefined}
                      options={clients.map((client) => ({ value: client.id, label: client.name }))}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          client: value,
                          menuSection: clients.find((client) => client.id === value)?.sections[0]?.id || '',
                        }))
                      }
                    />
                  </Form.Item>
                  <Form.Item label="菜单分组">
                    <Select
                      value={form.menuSection || undefined}
                      options={sections.map((section) => ({ value: section.id, label: section.title }))}
                      onChange={(value) => setForm((current) => ({ ...current, menuSection: value }))}
                    />
                  </Form.Item>
                </div>
                {importMode === 'replace' ? (
                  <Form.Item label="选择原页面">
                    <Select
                      value={replacePagePath || undefined}
                      allowClear
                      placeholder="选择需要被替换的现有页面"
                      options={replacementPages.map((page) => ({
                        value: page.path,
                        label: `${page.title}（${page.path}）`,
                      }))}
                      onChange={(value) => applyReplacement(value || '')}
                    />
                  </Form.Item>
                ) : null}
                <div className="transfer-form-grid">
                  <Form.Item label="路由片段">
                    <Input
                      value={form.routePath}
                      placeholder="例如 vehicle-inspection"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, routePath: event.target.value }))
                      }
                    />
                  </Form.Item>
                  <Form.Item label="菜单名称">
                    <Input
                      value={form.menuTitle}
                      placeholder="页面在菜单中显示的名称"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, menuTitle: event.target.value }))
                      }
                    />
                  </Form.Item>
                  <Form.Item label="菜单图标">
                    <Select
                      value={form.menuIcon}
                      options={iconOptions.map((value) => ({ value, label: value }))}
                      onChange={(value) => setForm((current) => ({ ...current, menuIcon: value }))}
                    />
                  </Form.Item>
                  <Form.Item label="HTML 文件名">
                    <Input
                      value={form.fileName}
                      placeholder="默认保留上传文件名"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, fileName: event.target.value }))
                      }
                    />
                  </Form.Item>
                </div>
              </Form>
              <div className="transfer-manifest-preview">
                <span>原型页面</span>
                <strong>{inspection.manifest.pageTitle}</strong>
                <span>页面类型</span>
                <strong>{inspection.manifest.pageType || '未标记'}</strong>
                <span>来源标识</span>
                <strong>{inspection.manifest.pageKey}</strong>
              </div>
              {routeConflict ? (
                <Alert type="error" showIcon title={`路由 ${proposedPath} 已存在，请更换路由片段。`} />
              ) : null}
              {importMode === 'replace' && !replacePagePath ? (
                <Alert type="warning" showIcon title="请选择要替换的原页面。" />
              ) : null}
              <Button
                type="primary"
                loading={importBusy}
                disabled={!importReady || !platformApi.development}
                onClick={() => setConfirmImport(true)}
              >
                {importMode === 'replace' ? '替换并备份原页面' : '新增到工程'}
              </Button>
            </>
          ) : null}
          {importResult ? (
            <Result
              status="success"
              title={
                (importResult.result as Record<string, unknown>)?.mode === 'replace'
                  ? '页面已替换，原页面已备份'
                  : '页面已导入工程'
              }
              subTitle="重新载入开发服务后，路由和菜单会显示最新页面。"
              extra={
                <Button type="primary" onClick={() => window.location.reload()}>
                  重新载入工程
                </Button>
              }
            />
          ) : null}
        </Surface>
      ) : (
        <Surface className="transfer-panel">
          <div className="transfer-panel__heading">
            <div>
              <Title level={2}>导出独立演示包</Title>
              <Text type="secondary">选择页面后生成独立运行包，并保留可回导的页面源文件区。</Text>
            </div>
            <div>
              <Tag color="success">无需客户安装 Node</Tag>
              <Tag color="warning">打开时需要网络</Tag>
              <Tag>支持回导</Tag>
            </div>
          </div>
          <ProjectTarget projects={projects} value={projectId} onChange={switchProject} />
          <div className="transfer-export-toolbar">
            <Segmented
              value={exportClient}
              options={[
                { label: '全部客户端', value: 'all' },
                ...clients.map((client) => ({ label: client.name, value: client.id })),
              ]}
              onChange={(value) => setExportClient(String(value))}
            />
            <Input.Search
              value={exportSearch}
              allowClear
              placeholder="搜索页面名称或路由"
              onChange={(event) => setExportSearch(event.target.value)}
            />
            <div>
              <Text>已选 {selectedPaths.length} 个页面</Text>
              <Button
                type="link"
                onClick={() =>
                  setSelectedPaths((current) => [
                    ...new Set([
                      ...current,
                      ...exportGroups.flatMap((group) => group.pages.map((page) => page.fullPath)),
                    ]),
                  ])
                }
              >
                全选当前列表
              </Button>
              <Button type="link" onClick={() => setSelectedPaths([])}>
                清空
              </Button>
            </div>
          </div>
          {routeQuery.isPending ? (
            <div className="page-loading">
              <Spin />
            </div>
          ) : exportGroups.length ? (
            <Checkbox.Group value={selectedPaths} onChange={(values) => setSelectedPaths(values as string[])}>
              <div className="export-page-list">
                {exportGroups.map((group) => (
                  <section key={group.client.id}>
                    <header>
                      <strong>{group.client.name}</strong>
                      <Text type="secondary">{group.pages.length} 个页面</Text>
                    </header>
                    {group.pages.map((page) => (
                      <Checkbox key={page.fullPath} value={page.fullPath}>
                        <span>
                          <strong>{page.title}</strong>
                          <small>{page.fullPath}</small>
                        </span>
                      </Checkbox>
                    ))}
                  </section>
                ))}
              </div>
            </Checkbox.Group>
          ) : (
            <Empty description="当前筛选条件下没有可导出的工程页面" />
          )}
          {exportError ? <Alert type="error" showIcon title={exportError} /> : null}
          <div className="transfer-export-submit">
            <Input
              value={packageName}
              placeholder="多页 ZIP 文件夹名称（单页按页面名导出）"
              onChange={(event) => setPackageName(event.target.value)}
            />
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={exportBusy}
              disabled={!selectedPaths.length || !platformApi.development}
              onClick={() => void runExport()}
            >
              {selectedPaths.length === 1 ? '导出单页 HTML' : '生成多页 ZIP'}
            </Button>
          </div>
          {exportBusy ? <Text type="secondary">正在编译页面并整理页面专属样式与脚本...</Text> : null}
          {exportResult ? (
            <Result
              status="success"
              title={
                (exportResult.result as Record<string, unknown>)?.mode === 'single'
                  ? '单页 HTML 已生成'
                  : '多页演示包已生成'
              }
              subTitle="导出页面可重新上传导入；多页包保留页面间跳转。"
              extra={
                <>
                  <Button
                    type="primary"
                    href={String((exportResult.result as Record<string, unknown>)?.preview || '#')}
                    target="_blank"
                  >
                    预览导出页面
                  </Button>
                  {(exportResult.result as Record<string, unknown>)?.mode === 'single' ? (
                    <Button href={fileNameFromResult(exportResult.result as Record<string, unknown>, 'html')}>
                      下载 HTML
                    </Button>
                  ) : (
                    <Button href={fileNameFromResult(exportResult.result as Record<string, unknown>, 'zip')}>
                      下载 ZIP
                    </Button>
                  )}
                </>
              }
            />
          ) : null}
        </Surface>
      )}
      <Modal
        title={importMode === 'replace' ? '确认替换页面' : '确认新增页面'}
        open={confirmImport}
        okText={importMode === 'replace' ? '确认替换' : '确认导入'}
        cancelText="取消"
        confirmLoading={importBusy}
        onCancel={() => setConfirmImport(false)}
        onOk={() => void runImport()}
      >
        <Text>
          {importMode === 'replace'
            ? `确认替换 ${selectedReplacement?.title || replacePagePath}？原页面会备份后再写入。`
            : `确认将页面写入 ${proposedPath} 并登记到菜单吗？`}
        </Text>
      </Modal>
    </PlatformPage>
  );
}

function ProjectTarget({
  projects,
  value,
  onChange,
}: {
  projects: Array<{ id: string; name: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="project-target-row">
      <Text>目标项目</Text>
      <Select
        value={value || undefined}
        placeholder="选择项目"
        options={projects.map((project) => ({ value: project.id, label: project.name }))}
        onChange={onChange}
      />
    </div>
  );
}
function InspectionPanel({ inspection }: { inspection: Inspection }) {
  return (
    <div className={`inspection-summary ${inspection.valid ? '' : 'is-invalid'}`}>
      <div>
        <CheckCircleFilled />
        <strong>{inspection.valid ? '模板检查通过' : '模板检查未通过'}</strong>
      </div>
      <div>
        <span>业务区块 {inspection.stats.blocks?.length || 0}</span>
        <span>弹窗 {inspection.stats.dialogs || 0}</span>
        <span>抽屉 {inspection.stats.drawers || 0}</span>
        <span>页面逻辑 {inspection.stats.logicLength ? '已识别' : '缺失'}</span>
      </div>
      {inspection.errors.length ? (
        <Alert type="error" showIcon title={inspection.errors.join('；')} />
      ) : null}
      {inspection.warnings.length ? (
        <Alert type="warning" showIcon title={inspection.warnings.join('；')} />
      ) : null}
    </div>
  );
}
