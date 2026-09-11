import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';

import type { HtmlPrototypePage, PrdBinding } from '../../../../packages/platform-contracts/src/index.js';
import { platformApi } from '@/data/platform-api';
import {
  useHtmlPageCatalog,
  usePagePrdLinks,
  usePlatformSettings,
  usePrdBindings,
  useProjectManifest,
} from '@/data/use-platform-data';
import { PrdReviewPanel, type PrdPanelMode } from '@/features/docs/PrdReviewPanel';
import { PrototypeFrame } from '@/features/prototypes/PrototypeFrame';
import {
  findClient,
  findProject,
  getClientPages,
  getClientRuntimeStatus,
  getClientSections,
  getDefaultPage,
  getPagePrdPath,
  groupClientPages,
} from '@/features/projects/project-model';
import {
  Avatar,
  Alert,
  Button,
  ConfigProvider,
  Dropdown,
  Empty,
  Layout,
  Menu,
  Select,
  Spin,
  type MenuProps,
} from '@/ui/ant';
import {
  AppstoreOutlined,
  BookOutlined,
  DatabaseOutlined,
  DownOutlined,
  DownloadOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@/ui/ant/icons';
import { ProjectIcon } from '@/ui/platform/ProjectIcon';
import { ThemeControl } from '@/ui/platform/ThemeControl';

const { Header, Sider, Content } = Layout;

function routeForPage(projectId: string, clientId: string, page: HtmlPrototypePage) {
  return `/p/${projectId}/${clientId}/${page.path}`;
}

export function ClientWorkspacePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { projectId = '', clientId = '', pagePath = '' } = useParams();
  const projectQuery = useProjectManifest();
  const catalogQuery = useHtmlPageCatalog();
  const project = useMemo(
    () => findProject(projectQuery.data?.projects ?? [], projectId),
    [projectId, projectQuery.data],
  );
  const client = findClient(project, clientId);
  const pages = getClientPages(catalogQuery.data, projectId, clientId);
  const sections = getClientSections(catalogQuery.data, projectId, clientId);
  const selectedPage = pages.find((page) => page.path === pagePath) ?? null;
  const defaultPage = client ? getDefaultPage(client, pages) : null;
  const prdLinksQuery = usePagePrdLinks(projectId, Boolean(project && selectedPage));
  const prdBindingsQuery = usePrdBindings(projectId, Boolean(project && selectedPage));
  const settingsQuery = usePlatformSettings();
  const saveDeveloperMode = useMutation({
    mutationFn: (enabled: boolean) => platformApi.savePlatformSettings({ developerMode: enabled }),
    onSuccess: (settings) => queryClient.setQueryData(['platform', 'settings'], settings),
  });
  const [prdOpen, setPrdOpen] = useState(false);
  const [prdTarget, setPrdTarget] = useState<{ documentPath: string; anchor?: string }>({
    documentPath: '',
  });
  const [prdMode, setPrdMode] = useState<PrdPanelMode>(() =>
    localStorage.getItem('product-experience-center:prd-panel-mode') === 'overlay' ? 'overlay' : 'split',
  );
  const developerModeOverride = ['1', 'true'].includes(
    new URLSearchParams(location.search).get('__dev')?.toLowerCase() || '',
  );
  const sharedDeveloperMode = settingsQuery.data?.developerMode ?? false;
  const developerMode = sharedDeveloperMode || developerModeOverride;

  useEffect(() => {
    const handleDeveloperShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'm') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      if (!platformApi.development || saveDeveloperMode.isPending) return;
      saveDeveloperMode.mutate(!sharedDeveloperMode);
    };
    window.addEventListener('keydown', handleDeveloperShortcut);
    return () => window.removeEventListener('keydown', handleDeveloperShortcut);
  }, [saveDeveloperMode, sharedDeveloperMode]);

  useEffect(() => {
    document.title = selectedPage
      ? `${selectedPage.title} - ${project?.name || '项目'}`
      : project?.name || '产品功能体验中心';
  }, [project?.name, selectedPage]);

  if (projectQuery.isPending || catalogQuery.isPending) {
    return (
      <div className="home-loading">
        <Spin size="large" />
      </div>
    );
  }
  if (!project || project.homepage?.visible === false || !client) {
    return <Navigate to={`/unavailable/${projectId}`} replace />;
  }
  const runtimeStatus = getClientRuntimeStatus(project, clientId, pages);
  if (!pagePath && defaultPage) {
    return <Navigate to={routeForPage(projectId, clientId, defaultPage)} replace />;
  }
  if (!selectedPage) {
    const runtimeNotice =
      runtimeStatus.state === 'legacy-vue'
        ? {
            type: 'info' as const,
            message: '该客户端未启用 React 页面',
            description: '项目包中登记的旧 Vue 页面不属于当前平台运行范围，也不会被自动修改。',
          }
        : runtimeStatus.state === 'index-missing'
          ? {
              type: 'error' as const,
              message: 'HTML 页面运行索引缺失',
              description: `项目登记了 ${runtimeStatus.managedHtmlPageCount} 个托管 HTML 页面，但当前扫描结果没有可运行页面。请重新扫描项目包并检查页面文件。`,
            }
          : null;
    return (
      <main className="client-empty">
        {runtimeNotice ? (
          <Alert
            showIcon
            type={runtimeNotice.type}
            title={runtimeNotice.message}
            description={runtimeNotice.description}
          />
        ) : (
          <Empty description={pages.length ? '页面不存在或已从原型目录移除' : '当前客户端尚未登记页面'} />
        )}
        <Button type="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </main>
    );
  }

  const prdPath = getPagePrdPath(prdLinksQuery.data, clientId, selectedPage) || '';
  const routePath = `/p/${projectId}/${clientId}/${selectedPage.path}`;
  const pageBindings = (prdBindingsQuery.data?.bindings ?? []).filter((binding) =>
    [selectedPage.path, routePath].includes(binding.pagePath),
  );
  const prdDocuments = [
    ...(prdPath ? [{ path: prdPath }] : []),
    ...pageBindings.map((binding) => ({ path: binding.prd.document, title: binding.prd.label })),
  ].filter(
    (item, index, items) =>
      item.path && items.findIndex((candidate) => candidate.path === item.path) === index,
  );
  const sourceDownloadUrl =
    developerMode && platformApi.development
      ? platformApi.getHtmlPrototypeSourceDownloadUrl(projectId, selectedPage.sourceRoot, selectedPage.source)
      : '';

  function changePrdMode(nextMode: PrdPanelMode) {
    setPrdMode(nextMode);
    localStorage.setItem('product-experience-center:prd-panel-mode', nextMode);
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: project.theme?.primary || '#1677ff',
        },
      }}
    >
      <ClientWorkspace
        projectId={projectId}
        clientId={clientId}
        project={project}
        client={client}
        pages={pages}
        sections={sections}
        selectedPage={selectedPage}
        theme={{
          primary: project.theme?.primary || '#1677ff',
          primaryHover: project.theme?.primaryHover,
          primaryActive: project.theme?.primaryActive,
          pageBackground: project.theme?.pageBackground,
        }}
        locationSearch={location.search}
        locationHash={location.hash}
        prdPath={prdPath}
        prdBindings={pageBindings}
        prdOpen={prdOpen}
        prdTarget={prdTarget}
        prdDocuments={prdDocuments}
        prdMode={prdMode}
        developerMode={developerMode}
        sourceDownloadUrl={sourceDownloadUrl}
        onPrdModeChange={changePrdMode}
        onClosePrd={() => setPrdOpen(false)}
        onOpenPrd={(target) => {
          const documentPath =
            typeof target?.documentPath === 'string' && target.documentPath.trim()
              ? target.documentPath
              : prdPath;
          setPrdTarget({
            documentPath,
            ...(typeof target?.anchor === 'string' && target.anchor ? { anchor: target.anchor } : {}),
          });
          setPrdOpen(true);
        }}
        onNavigate={navigate}
      />
    </ConfigProvider>
  );
}

function ClientWorkspace({
  projectId,
  clientId,
  project,
  client,
  pages,
  sections,
  selectedPage,
  theme,
  locationSearch,
  locationHash,
  prdPath,
  prdBindings,
  prdOpen,
  prdTarget,
  prdDocuments,
  prdMode,
  developerMode,
  sourceDownloadUrl,
  onPrdModeChange,
  onClosePrd,
  onOpenPrd,
  onNavigate,
}: {
  projectId: string;
  clientId: string;
  project: NonNullable<ReturnType<typeof findProject>>;
  client: NonNullable<ReturnType<typeof findClient>>;
  pages: HtmlPrototypePage[];
  sections: Array<{ id: string; title: string }>;
  selectedPage: HtmlPrototypePage;
  theme: {
    primary: string;
    primaryHover?: string;
    primaryActive?: string;
    pageBackground?: string;
  };
  locationSearch: string;
  locationHash: string;
  prdPath: string;
  prdBindings: PrdBinding[];
  prdOpen: boolean;
  prdTarget: { documentPath: string; anchor?: string };
  prdDocuments: Array<{ path: string; title?: string }>;
  prdMode: PrdPanelMode;
  developerMode: boolean;
  sourceDownloadUrl: string;
  onPrdModeChange: (mode: PrdPanelMode) => void;
  onClosePrd: () => void;
  onOpenPrd: (target?: { documentPath: string; anchor?: string }) => void;
  onNavigate: ReturnType<typeof useNavigate>;
}) {
  const collapsedKey = `product-experience-center:client-nav:${projectId}:${clientId}`;
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapsedKey) === 'collapsed');
  const syncRouteRef = useRef('');
  const desiredFrameUrl = `${platformApi.getHtmlPrototypeUrl(
    projectId,
    selectedPage.sourceRoot,
    selectedPage.source,
  )}${locationSearch}${locationHash}`;
  const [frameUrl, setFrameUrl] = useState(desiredFrameUrl);
  const groups = useMemo(() => groupClientPages(pages, sections), [pages, sections]);
  const layoutType = client.layout?.type || 'sidebar';
  const activeMenuSectionKey = useMemo(() => {
    const activeGroup = groups.find((group) => group.pages.some((page) => page.path === selectedPage.path));
    return activeGroup ? `section:${activeGroup.id}` : '';
  }, [groups, selectedPage.path]);
  const [menuDisclosure, setMenuDisclosure] = useState(() => ({
    pagePath: selectedPage.path,
    openKeys: activeMenuSectionKey ? [activeMenuSectionKey] : [],
  }));
  const openMenuKeys =
    menuDisclosure.pagePath === selectedPage.path
      ? menuDisclosure.openKeys
      : activeMenuSectionKey
        ? [activeMenuSectionKey]
        : [];

  useEffect(() => {
    if (syncRouteRef.current === desiredFrameUrl) {
      syncRouteRef.current = '';
      return;
    }
    setFrameUrl(desiredFrameUrl);
  }, [desiredFrameUrl]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(collapsedKey, next ? 'collapsed' : 'expanded');
      return next;
    });
  }

  const navigatePage = useCallback(
    (page: HtmlPrototypePage) => {
      const section = groups.find((group) =>
        group.pages.some((candidate) => candidate.path === page.path),
      );
      setMenuDisclosure({
        pagePath: page.path,
        openKeys: section ? [`section:${section.id}`] : [],
      });
      onNavigate(routeForPage(projectId, clientId, page));
    },
    [clientId, groups, onNavigate, projectId],
  );

  function syncIframeRoute(frame: HTMLIFrameElement) {
    try {
      const current = frame.contentWindow?.location;
      if (!current) return;
      const matchingPage = pages.find((page) => {
        const candidate = platformApi.getHtmlPrototypeUrl(projectId, page.sourceRoot, page.source);
        return new URL(candidate, window.location.origin).pathname === current.pathname;
      });
      if (!matchingPage) return;
      if (
        matchingPage.path === selectedPage.path &&
        current.search === locationSearch &&
        current.hash === locationHash
      ) {
        return;
      }
      const matchingGroup = groups.find((group) =>
        group.pages.some((page) => page.path === matchingPage.path),
      );
      setMenuDisclosure({
        pagePath: matchingPage.path,
        openKeys: matchingGroup ? [`section:${matchingGroup.id}`] : [],
      });
      const nextOuterUrl = `${routeForPage(projectId, clientId, matchingPage)}${current.search}${current.hash}`;
      syncRouteRef.current = `${current.pathname}${current.search}${current.hash}`;
      onNavigate(nextOuterUrl, { replace: true });
    } catch {
      // 外部 HTML 目前由同源服务承载；若未来改为跨域，仅停止路由同步，不影响页面显示。
    }
  }

  const menuItems = useMemo(
    () => createMenuItems(groups, layoutType, navigatePage),
    [groups, layoutType, navigatePage],
  );
  const accountItems: MenuProps['items'] = [
    { key: 'home', icon: <HomeOutlined />, label: '回到首页', onClick: () => onNavigate('/') },
    ...(developerMode
      ? [
          {
            key: 'ai-context',
            icon: <DatabaseOutlined />,
            label: '当前页面上下文',
            onClick: () =>
              onNavigate(
                `/tools/ai-context?project=${encodeURIComponent(projectId)}&client=${encodeURIComponent(clientId)}&page=${encodeURIComponent(selectedPage.path)}`,
              ),
          },
        ]
      : []),
    { key: 'exit', icon: <LogoutOutlined />, label: '退出当前客户端', onClick: () => onNavigate('/') },
  ];
  const clientOptions = project.clients.map((item) => ({ label: item.name, value: item.id }));
  const bare = layoutType === 'none' || layoutType === 'bare';
  const workspaceStyle = {
    '--project-accent': project.theme?.primary || '#1677ff',
    '--project-page-bg': 'var(--ant-color-bg-layout)',
  } as CSSProperties;
  const pageWorkspace = (
    <div className={`client-page-workspace ${prdOpen ? `has-prd prd-${prdMode}` : ''}`}>
      <Content className="client-content">
        <PrototypeFrame
          page={selectedPage}
          source={frameUrl}
          theme={theme}
          prdBindings={prdBindings}
          onOpenPrd={onOpenPrd}
          onLoad={syncIframeRoute}
        />
      </Content>
      <PrdReviewPanel
        key={`${prdTarget.documentPath}:${prdTarget.anchor || ''}`}
        open={prdOpen}
        projectId={projectId}
        pageTitle={selectedPage.title}
        documentPath={prdTarget.documentPath}
        documentAnchor={prdTarget.anchor}
        documents={prdDocuments}
        mode={prdMode}
        onModeChange={onPrdModeChange}
        onClose={onClosePrd}
      />
    </div>
  );

  if (bare) {
    return (
      <main className="client-bare" style={workspaceStyle}>
        {prdPath || sourceDownloadUrl ? (
          <div className="client-bare-tools" aria-label="页面工具">
            {sourceDownloadUrl ? (
              <Button href={sourceDownloadUrl} icon={<DownloadOutlined />}>
                下载源文件
              </Button>
            ) : null}
            {prdPath ? (
              <Button type="primary" icon={<BookOutlined />} onClick={() => onOpenPrd()}>
                查看 PRD
              </Button>
            ) : null}
          </div>
        ) : null}
        {pageWorkspace}
      </main>
    );
  }

  if (layoutType === 'topnav') {
    return (
      <Layout className="client-shell client-shell--topnav" style={workspaceStyle}>
        <Header className="client-topbar client-topbar--topnav">
          <ClientBrand projectName={project.name} />
          <Menu
            aria-label="客户端主导航"
            className="client-topnav-menu"
            mode="horizontal"
            selectedKeys={[selectedPage.path]}
            items={menuItems}
            style={{ minWidth: 0, flex: 'auto' }}
          />
          <ClientActions
            clientId={clientId}
            clientOptions={clientOptions}
            prdPath={prdPath}
            sourceDownloadUrl={sourceDownloadUrl}
            accountItems={accountItems}
            onClientChange={(value) => onNavigate(`/p/${projectId}/${value}`)}
            onOpenPrd={onOpenPrd}
          />
        </Header>
        {pageWorkspace}
      </Layout>
    );
  }

  return (
    <Layout className="client-shell client-shell--sidebar" style={workspaceStyle}>
      <Header className="client-topbar client-topbar--sidebar">
        <ClientBrand projectName={project.name} />
        <span className="client-topbar__spacer" aria-hidden="true" />
        <ClientActions
          clientId={clientId}
          clientOptions={clientOptions}
          prdPath={prdPath}
          sourceDownloadUrl={sourceDownloadUrl}
          accountItems={accountItems}
          onClientChange={(value) => onNavigate(`/p/${projectId}/${value}`)}
          onOpenPrd={onOpenPrd}
        />
      </Header>
      <Layout className="client-shell__body">
        <Sider className="client-sider" width={216} collapsedWidth={56} collapsed={collapsed} trigger={null}>
          <Menu
            aria-label="客户端导航"
            mode="inline"
            selectedKeys={[selectedPage.path]}
            openKeys={collapsed ? undefined : openMenuKeys}
            items={menuItems}
            onOpenChange={(keys) => {
              const latest = keys.find((key) => !openMenuKeys.includes(String(key)));
              setMenuDisclosure({
                pagePath: selectedPage.path,
                openKeys: latest ? [String(latest)] : [],
              });
            }}
          />
          <div className="client-sider-footer">
            <Button
              block
              className="client-sider-trigger"
              type="text"
              onClick={toggleCollapsed}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            >
              {collapsed ? null : '收起导航'}
            </Button>
          </div>
        </Sider>
        {pageWorkspace}
      </Layout>
    </Layout>
  );
}

function createMenuItems(
  groups: ReturnType<typeof groupClientPages>,
  layoutType: string,
  navigatePage: (page: HtmlPrototypePage) => void,
): MenuProps['items'] {
  return groups.map((group) => ({
    key: `section:${group.id}`,
    icon:
      layoutType === 'sidebar' && group.pages[0]?.icon ? (
        <ProjectIcon name={group.pages[0].icon} />
      ) : undefined,
    label: group.title,
    children: group.pages.map((page) => ({
      key: page.path,
      icon: <ProjectIcon name={page.icon} />,
      label: page.title,
      onClick: () => navigatePage(page),
    })),
  }));
}

function ClientBrand({ projectName }: { projectName: string }) {
  return (
    <a className="client-brand" href={import.meta.env.BASE_URL}>
      <span className="client-brand__mark" aria-hidden="true">
        <AppstoreOutlined />
      </span>
      <span className="client-brand__copy">
        <strong>{projectName}</strong>
      </span>
    </a>
  );
}

function ClientActions({
  clientId,
  clientOptions,
  prdPath,
  sourceDownloadUrl,
  accountItems,
  onClientChange,
  onOpenPrd,
}: {
  clientId: string;
  clientOptions: Array<{ label: string; value: string }>;
  prdPath: string;
  sourceDownloadUrl: string;
  accountItems: MenuProps['items'];
  onClientChange: (value: string) => void;
  onOpenPrd: () => void;
}) {
  return (
    <div className="client-actions">
      <Select aria-label="客户端" value={clientId} options={clientOptions} onChange={onClientChange} />
      {sourceDownloadUrl ? (
        <Button type="text" href={sourceDownloadUrl} icon={<DownloadOutlined />}>
          下载源文件
        </Button>
      ) : null}
      <Button type="text" disabled={!prdPath} icon={<BookOutlined />} onClick={() => onOpenPrd()}>
        查看 PRD
      </Button>
      <ThemeControl />
      <Dropdown menu={{ items: accountItems }} trigger={['click']}>
        <Button type="text" className="client-account">
          <Avatar size={32}>A</Avatar>
          <strong>Admin</strong>
          <DownOutlined />
        </Button>
      </Dropdown>
    </div>
  );
}
