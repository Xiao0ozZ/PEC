import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type {
  HtmlPageCatalog,
  ProjectEntry,
  ProjectManifest,
} from '../../../../packages/platform-contracts/src/index.js';
import { platformApi } from '@/data/platform-api';
import { useHtmlPageCatalog, useProjectManifest } from '@/data/use-platform-data';
import {
  getClientEntryPath,
  getClientPages,
  getClientRuntimeStatus,
  visibleProjects,
} from '@/features/projects/project-model';
import {
  Alert,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Divider,
  Empty,
  Flex,
  Select,
  Spin,
  Tag,
  Typography,
} from '@/ui/ant';
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  BookOutlined,
  CarOutlined,
  FolderOpenOutlined,
  MobileOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@/ui/ant/icons';
import { ThemeControl } from '@/ui/platform/ThemeControl';

const { Text, Title } = Typography;
const PROJECT_STORAGE_KEY = 'product-experience-center:selected-project';
const LEGACY_PROJECT_STORAGE_KEY = 'project-platform:home-selected-project';
const TOOLS_VISIBILITY_KEY = 'project-platform:home-engineering-tools';

function readStoredProjectId() {
  try {
    return (
      localStorage.getItem(PROJECT_STORAGE_KEY) || localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY) || ''
    );
  } catch {
    return '';
  }
}

function readToolsVisibility() {
  try {
    return sessionStorage.getItem(TOOLS_VISIBILITY_KEY) === 'true';
  } catch {
    return false;
  }
}

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const projectQuery = useProjectManifest();
  const catalogQuery = useHtmlPageCatalog();
  const projects = useMemo(() => visibleProjects(projectQuery.data?.projects ?? []), [projectQuery.data]);
  const [storedSelectedId, setStoredSelectedId] = useState(
    () => new URLSearchParams(window.location.search).get('project') || readStoredProjectId(),
  );
  const [showTools, setShowTools] = useState(readToolsVisibility);
  const requestedProjectId = new URLSearchParams(location.search).get('project') || '';
  const selectedId = projects.some((project) => project.id === requestedProjectId)
    ? requestedProjectId
    : storedSelectedId;
  const selectedProject = projects.find((project) => project.id === selectedId) ?? null;

  useEffect(() => {
    if (!requestedProjectId || !projects.some((project) => project.id === requestedProjectId)) return;
    rememberProject(requestedProjectId);
  }, [projects, requestedProjectId]);

  useEffect(() => {
    document.title = selectedProject ? `${selectedProject.name} - 产品功能体验中心` : '产品功能体验中心';
  }, [selectedProject]);

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'm') return;
      event.preventDefault();
      setShowTools((current) => {
        const next = !current;
        try {
          sessionStorage.setItem(TOOLS_VISIBILITY_KEY, String(next));
        } catch {
          // Session storage is optional; the current page state still works.
        }
        return next;
      });
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  function rememberProject(projectId: string) {
    try {
      if (projectId) {
        localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
        localStorage.setItem(LEGACY_PROJECT_STORAGE_KEY, projectId);
      } else {
        localStorage.removeItem(PROJECT_STORAGE_KEY);
        localStorage.removeItem(LEGACY_PROJECT_STORAGE_KEY);
      }
    } catch {
      // Local storage is optional; URL selection remains available.
    }
  }

  function selectProject(projectId: string) {
    setStoredSelectedId(projectId);
    rememberProject(projectId);
    navigate(projectId ? `/?project=${encodeURIComponent(projectId)}` : '/', { replace: true });
  }

  function openPageTransfer() {
    if (!selectedProject) return;
    navigate(`/tools/page-transfer?project=${encodeURIComponent(selectedProject.id)}`);
  }

  if (projectQuery.isPending || catalogQuery.isPending) {
    return (
      <div className="home-loading home-loading--ant">
        <Spin size="large" />
        <Text type="secondary">正在读取项目资料</Text>
      </div>
    );
  }

  return (
    <main className="home-page home-page--ant">
      <header className="home-topbar home-topbar--ant">
        <Button className="home-brand home-brand--ant" type="text" onClick={() => selectProject('')}>
          <Avatar shape="square" icon={<AppstoreOutlined />} />
          <span className="home-brand__text">
            <strong>产品功能体验中心</strong>
            <small>原型、文档与产品上下文</small>
          </span>
        </Button>

        <Flex className="home-topbar__actions" gap={4} align="center">
          <ThemeControl />
          {showTools ? (
            <>
              <Button type="text" icon={<AppstoreOutlined />} onClick={() => navigate('/components')}>
                组件规范
              </Button>
              <Button type="text" icon={<FolderOpenOutlined />} onClick={() => navigate('/tools/projects')}>
                项目管理
              </Button>
              <Button
                type="text"
                icon={<UploadOutlined />}
                disabled={!selectedProject}
                onClick={openPageTransfer}
              >
                导入导出
              </Button>
              <Button type="text" icon={<SettingOutlined />} onClick={() => navigate('/tools/console')}>
                控制台
              </Button>
            </>
          ) : null}
        </Flex>
      </header>

      <div className="home-main">
        <section className="home-hero home-hero--ant">
          <div className="home-hero__copy">
            <Title>产品功能体验中心</Title>
            <Text type="secondary">选择项目，进入对应的客户端原型、产品文档和移动端内容。</Text>
          </div>
          <div className="home-project-picker">
            <div>
              <Text strong>当前项目</Text>
              <Text type="secondary">仅显示已开放的项目</Text>
            </div>
            <Select
              value={selectedProject?.id}
              placeholder={projects.length ? '请选择项目' : '暂无可用项目'}
              allowClear
              showSearch
              optionFilterProp="label"
              disabled={!projects.length}
              onChange={(value) => selectProject(value || '')}
              options={projects.map((project) => ({
                label: project.name,
                value: project.id,
              }))}
            />
          </div>
        </section>

        {projectQuery.isError || catalogQuery.isError ? (
          <Alert
            type="error"
            showIcon
            title="项目资料读取失败"
            description="请确认 React 开发服务和项目扫描接口可用。"
          />
        ) : selectedProject ? (
          <ProjectWorkspace
            key={selectedProject.id}
            project={selectedProject}
            onOpen={navigate}
            catalog={catalogQuery.data}
          />
        ) : (
          <section className="home-empty home-empty--ant">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={projects.length ? '选择项目后显示项目内容入口' : '当前没有开放的项目'}
            />
          </section>
        )}
      </div>
    </main>
  );
}

function ProjectWorkspace({
  project,
  catalog,
  onOpen,
}: {
  project: ProjectManifest;
  catalog: HtmlPageCatalog | undefined;
  onOpen: (path: string) => void;
}) {
  const entries = [...(project.entries ?? [])].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const productEntries = entries.filter((entry) => entry.kind !== 'docs');
  const documentEntries = entries.filter((entry) => entry.kind === 'docs');
  const accent = project.theme?.primary || '#1677ff';

  return (
    <ConfigProvider theme={{ token: { colorPrimary: accent, colorInfo: accent } }}>
      <Card
        className="home-workspace home-workspace--ant"
        style={{ '--project-accent': accent } as CSSProperties}
      >
        <header className="home-project-heading home-project-heading--ant">
          <div className="home-project-heading__identity">
            {project.branding?.logo ? (
              <img
                className="home-project-logo"
                src={platformApi.getProjectAssetUrl(project.id, project.branding.logo)}
                alt=""
              />
            ) : (
              <Avatar shape="square" size={48} icon={<FolderOpenOutlined />} />
            )}
            <div>
              <Flex gap={8} align="center" wrap>
                <Title level={2}>{project.name}</Title>
                <Tag>v{project.version || '0.0.0'}</Tag>
              </Flex>
              <Text type="secondary">{project.description || '项目原型与资料入口'}</Text>
            </div>
          </div>
          <div className="home-project-heading__meta">
            <Tag color="success">可访问</Tag>
            <Text type="secondary">
              {productEntries.length} 个产品入口 · {documentEntries.length} 个文档入口
            </Text>
          </div>
        </header>

        <Divider />

        <div className={`home-workspace__body ${documentEntries.length ? 'has-documents' : ''}`}>
          <EntrySection
            title="产品入口"
            description="进入客户端或移动端原型"
            entries={productEntries}
            project={project}
            catalog={catalog}
            onOpen={onOpen}
          />
          {documentEntries.length ? (
            <EntrySection
              compact
              title="产品文档"
              description="查看项目 PRD 与相关资料"
              entries={documentEntries}
              project={project}
              catalog={catalog}
              onOpen={onOpen}
            />
          ) : null}
        </div>
      </Card>
    </ConfigProvider>
  );
}

function EntrySection({
  title,
  description,
  entries,
  project,
  catalog,
  compact = false,
  onOpen,
}: {
  title: string;
  description: string;
  entries: ProjectEntry[];
  project: ProjectManifest;
  catalog: HtmlPageCatalog | undefined;
  compact?: boolean;
  onOpen: (path: string) => void;
}) {
  return (
    <section className={`home-entry-section ${compact ? 'is-compact' : ''}`}>
      <header>
        <div>
          <Title level={3}>{title}</Title>
          <Text type="secondary">{description}</Text>
        </div>
        <Text type="secondary">{entries.length} 项</Text>
      </header>
      {entries.length ? (
        <div className="home-entry-grid">
          {entries.map((entry) => (
            <ProjectEntryButton
              key={entry.id}
              entry={entry}
              project={project}
              catalog={catalog}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无入口" />
      )}
    </section>
  );
}

function ProjectEntryButton({
  entry,
  project,
  catalog,
  onOpen,
}: {
  entry: ProjectEntry;
  project: ProjectManifest;
  catalog: HtmlPageCatalog | undefined;
  onOpen: (path: string) => void;
}) {
  const client = entry.kind === 'client' ? project.clients.find((item) => item.id === entry.clientId) : null;
  const pages = client ? getClientPages(catalog, project.id, client.id) : [];
  const runtimeStatus = client ? getClientRuntimeStatus(project, client.id, pages) : null;
  const path = client
    ? getClientEntryPath(project, client, pages)
    : entry.kind === 'docs'
      ? `/p/${project.id}/docs`
      : `/p/${project.id}/mobile`;
  const icon =
    entry.kind === 'docs' ? <BookOutlined /> : entry.kind === 'mobile' ? <MobileOutlined /> : <CarOutlined />;
  const status = getEntryStatus(runtimeStatus);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen(path);
  }

  return (
    <Card
      className="home-entry-card home-entry-card--ant"
      hoverable
      role="button"
      tabIndex={0}
      onClick={() => onOpen(path)}
      onKeyDown={handleKeyDown}
    >
      <div className="home-entry-card__icon">{icon}</div>
      <div className="home-entry-card__copy">
        <Flex gap={7} align="center" wrap>
          <Title level={4}>{entry.name}</Title>
          {status.tag ? <Tag color={status.color}>{status.tag}</Tag> : null}
        </Flex>
        <Text type="secondary">{status.description || entry.description || '进入查看项目内容'}</Text>
      </div>
      <ArrowRightOutlined className="home-entry-card__arrow" />
    </Card>
  );
}

function getEntryStatus(runtimeStatus: ReturnType<typeof getClientRuntimeStatus> | null) {
  if (!runtimeStatus) return { tag: '', color: undefined, description: '' };
  if (runtimeStatus.state === 'ready' || runtimeStatus.state === 'partial') {
    return {
      tag: `${runtimeStatus.runnablePageCount} 页`,
      color: 'processing' as const,
      description: '',
    };
  }
  if (runtimeStatus.state === 'index-missing') {
    return { tag: '索引异常', color: 'error' as const, description: '页面运行索引尚未生成' };
  }
  return { tag: '暂无页面', color: undefined, description: '该客户端尚未启用可运行页面' };
}
