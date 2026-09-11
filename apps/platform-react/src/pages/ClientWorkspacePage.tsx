import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
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
  Tooltip,
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
  UserOutlined,
} from '@/ui/ant/icons';
import { AppSidebar } from '@/ui/platform/AppSidebar';
import { ProjectIcon } from '@/ui/platform/ProjectIcon';
import { ThemeControl } from '@/ui/platform/ThemeControl';

const { Header, Content } = Layout;
const TOPNAV_CONTENT_OFFSET = 72;

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

  // 这些派生值和回调必须在加载态/空页面态之前创建，避免条件 Hook，
  // 同时保证公共壳状态变化时不会给 iframe 生成新的回调引用。
  const activePage = selectedPage ?? defaultPage;
  const activePagePath = activePage?.path ?? '';
  const resolvedPrdPath = activePage ? getPagePrdPath(prdLinksQuery.data, clientId, activePage) || '' : '';
  const resolvedRoutePath = activePage ? `/p/${projectId}/${clientId}/${activePage.path}` : '';
  const pageBindings = activePagePath
    ? (prdBindingsQuery.data?.bindings ?? []).filter((binding) =>
        [activePagePath, resolvedRoutePath].includes(binding.pagePath),
      )
    : [];
  const prdDocuments = [
    ...(resolvedPrdPath ? [{ path: resolvedPrdPath }] : []),
    ...pageBindings.map((binding) => ({ path: binding.prd.document, title: binding.prd.label })),
  ].filter(
    (item, index, items) =>
      item.path && items.findIndex((candidate) => candidate.path === item.path) === index,
  );
  const projectAccent = project?.theme?.primary || '#1677ff';
  const changePrdMode = useCallback(
    (nextMode: PrdPanelMode) => {
      setPrdMode(nextMode);
      localStorage.setItem('product-experience-center:prd-panel-mode', nextMode);
    },
    [setPrdMode],
  );
  const handleClosePrd = useCallback(() => setPrdOpen(false), [setPrdOpen]);
  const prdPathRef = useRef(resolvedPrdPath);
  useEffect(() => {
    prdPathRef.current = resolvedPrdPath;
  }, [resolvedPrdPath]);
  const handleOpenPrd = useCallback(
    (target?: { documentPath: string; anchor?: string }) => {
      const documentPath =
        typeof target?.documentPath === 'string' && target.documentPath.trim()
          ? target.documentPath
          : prdPathRef.current;
      setPrdTarget({
        documentPath,
        ...(typeof target?.anchor === 'string' && target.anchor ? { anchor: target.anchor } : {}),
      });
      setPrdOpen(true);
    },
    [prdPathRef, setPrdOpen, setPrdTarget],
  );
  const clientTheme = useMemo(
    () => ({
      primary: project?.theme?.primary || '#1677ff',
      primaryHover: project?.theme?.primaryHover,
      primaryActive: project?.theme?.primaryActive,
      pageBackground: project?.theme?.pageBackground,
    }),
    [
      project?.theme?.pageBackground,
      project?.theme?.primary,
      project?.theme?.primaryActive,
      project?.theme?.primaryHover,
    ],
  );
  const clientConfigTheme = useMemo(
    () => ({
      token: {
        colorPrimary: projectAccent,
        colorInfo: projectAccent,
      },
      components: {
        Menu: {
          itemSelectedBg: projectAccent,
          itemSelectedColor: '#fff',
        },
      },
    }),
    [projectAccent],
  );

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

  const prdPath = resolvedPrdPath;
  const sourceDownloadUrl =
    developerMode && platformApi.development
      ? platformApi.getHtmlPrototypeSourceDownloadUrl(projectId, selectedPage.sourceRoot, selectedPage.source)
      : '';

  return (
    <ConfigProvider theme={clientConfigTheme}>
      <ClientWorkspace
        projectId={projectId}
        clientId={clientId}
        project={project}
        client={client}
        pages={pages}
        sections={sections}
        selectedPage={selectedPage}
        theme={clientTheme}
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
        onClosePrd={handleClosePrd}
        onOpenPrd={handleOpenPrd}
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
      const section = groups.find((group) => group.pages.some((candidate) => candidate.path === page.path));
      setMenuDisclosure({
        pagePath: page.path,
        openKeys: section ? [`section:${section.id}`] : [],
      });
      onNavigate(routeForPage(projectId, clientId, page));
    },
    [clientId, groups, onNavigate, projectId],
  );

  const syncIframeRoute = useCallback(
    (frame: HTMLIFrameElement) => {
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
    },
    [clientId, groups, locationHash, locationSearch, onNavigate, pages, projectId, selectedPage.path],
  );

  const menuItems = useMemo(
    () => createMenuItems(groups, layoutType, navigatePage, collapsed),
    [collapsed, groups, layoutType, navigatePage],
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
          contentTopOffset={layoutType === 'topnav' ? TOPNAV_CONTENT_OFFSET : 0}
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
          <div className="topnav-block topnav-block--main">
            <ClientBrand projectName={project.name} />
            <ClientTopNavigation groups={groups} selectedPage={selectedPage} onNavigatePage={navigatePage} />
            <span className="client-topnav__divider" aria-hidden="true" />
            <ClientActions
              clientId={clientId}
              clientName={client.name}
              clientOptions={clientOptions}
              prdPath={prdPath}
              sourceDownloadUrl={sourceDownloadUrl}
              accountItems={accountItems}
              onClientChange={(value) => onNavigate(`/p/${projectId}/${value}`)}
              onOpenPrd={onOpenPrd}
            />
          </div>
        </Header>
        {pageWorkspace}
      </Layout>
    );
  }

  return (
    <Layout className="client-shell client-shell--sidebar" style={workspaceStyle}>
      <div className="app-shell-body client-shell__body">
        <AppSidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          brandMark={<AppstoreOutlined />}
          brandTitle={project.name}
          onBrandClick={() => onNavigate('/')}
          routeKey={selectedPage.path}
          selector={
            <Select
              aria-label="客户端"
              value={clientId}
              options={clientOptions}
              onChange={(value) => onNavigate(`/p/${projectId}/${value}`)}
            />
          }
          nav={(isCollapsed) => (
            <Menu
              aria-label="客户端导航"
              mode="inline"
              selectedKeys={[selectedPage.path]}
              openKeys={isCollapsed ? undefined : openMenuKeys}
              items={menuItems}
              onOpenChange={(keys) => {
                const latest = keys.find((key) => !openMenuKeys.includes(String(key)));
                setMenuDisclosure({
                  pagePath: selectedPage.path,
                  openKeys: latest ? [String(latest)] : [],
                });
              }}
            />
          )}
          tools={(isCollapsed) => (
            <>
              {sourceDownloadUrl ? (
                <Button type="text" href={sourceDownloadUrl} icon={<DownloadOutlined />}>
                  {isCollapsed ? null : '下载源文件'}
                </Button>
              ) : null}
              <Button type="text" disabled={!prdPath} icon={<BookOutlined />} onClick={() => onOpenPrd()}>
                {isCollapsed ? null : '查看 PRD'}
              </Button>
              <ThemeControl showLabel={!isCollapsed} />
            </>
          )}
          account={(isCollapsed) => (
            <Dropdown menu={{ items: accountItems }} trigger={['click']} placement="topLeft">
              <button className="app-account-card" type="button">
                <Avatar size={32} className="app-account-card__avatar">
                  A
                </Avatar>
                {isCollapsed ? null : (
                  <>
                    <span className="app-account-card__copy">
                      <b>Admin</b>
                      <small>{client.name}</small>
                    </span>
                    <DownOutlined className="app-account-card__more" />
                  </>
                )}
              </button>
            </Dropdown>
          )}
        />
        <div className="app-workspace-panel">{pageWorkspace}</div>
      </div>
    </Layout>
  );
}

/**
 * 侧栏展开态的一级是**不可点的分组标题**，二级页面始终铺开；
 * 收起态换成只有图标的父项，二级收进悬浮浮层；顶部导航沿用可点父项 + 下拉二级。
 */
function createMenuItems(
  groups: ReturnType<typeof groupClientPages>,
  layoutType: string,
  navigatePage: (page: HtmlPrototypePage) => void,
  collapsed: boolean,
): MenuProps['items'] {
  const isSidebar = layoutType === 'sidebar';
  return groups.map((group) => {
    const children = group.pages.map((page) => ({
      key: page.path,
      icon: <ProjectIcon name={page.icon} />,
      label: page.title,
      onClick: () => navigatePage(page),
    }));
    if (isSidebar && !collapsed) {
      return { type: 'group' as const, key: `section:${group.id}`, label: group.title, children };
    }
    return {
      key: `section:${group.id}`,
      icon: isSidebar && group.pages[0]?.icon ? <ProjectIcon name={group.pages[0].icon} /> : undefined,
      label: group.title,
      children,
    };
  });
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

/**
 * 顶部导航：一级菜单直接排在主胶囊里，选中一级高亮。
 * 多页面分组使用 Ant Design Menu 原生子菜单，箭头与交互由 Menu 统一渲染。
 */
function ClientTopNavigation({
  groups,
  selectedPage,
  onNavigatePage,
}: {
  groups: ReturnType<typeof groupClientPages>;
  selectedPage: HtmlPrototypePage;
  onNavigatePage: (page: HtmlPrototypePage) => void;
}) {
  const navigationRef = useRef<HTMLDivElement>(null);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const items: MenuProps['items'] = groups.map((group) => {
    const children = group.pages.map((page) => ({
      key: page.path,
      icon: <ProjectIcon name={page.icon} />,
      label: page.title,
    }));

    if (children.length === 1) {
      return { key: group.pages[0].path, label: group.title };
    }

    return { key: `section:${group.id}`, label: group.title, children };
  });

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (navigationRef.current?.contains(target)) return;
      // Ant Menu 的子菜单默认挂到 body，点击浮层选项时不能提前把它卸载。
      if (target.closest('.ant-menu-submenu-popup')) return;
      setOpenKeys([]);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown);
  }, []);

  return (
    <div ref={navigationRef} className="client-topnav">
      <Menu
        aria-label="客户端主导航"
        className="client-topnav--native"
        mode="horizontal"
        triggerSubMenuAction="click"
        selectable
        openKeys={openKeys}
        onOpenChange={setOpenKeys}
        selectedKeys={[selectedPage.path]}
        items={items}
        onClick={({ key }) => {
          const page = groups.flatMap((group) => group.pages).find((item) => item.path === key);
          if (page) {
            setOpenKeys([]);
            onNavigatePage(page);
          }
        }}
      />
    </div>
  );
}

function ClientActions({
  clientId,
  clientName,
  clientOptions,
  prdPath,
  sourceDownloadUrl,
  accountItems,
  onClientChange,
  onOpenPrd,
}: {
  clientId: string;
  clientName: string;
  clientOptions: Array<{ label: string; value: string }>;
  prdPath: string;
  sourceDownloadUrl: string;
  accountItems: MenuProps['items'];
  onClientChange: (value: string) => void;
  onOpenPrd: () => void;
}) {
  /** 右侧四个功能保留图标表达，文字通过悬浮提示和 aria-label 提供。 */
  const entries: ReactNode[] = [
    <Dropdown
      key="client"
      trigger={['click']}
      placement="bottomRight"
      classNames={{ root: 'app-pill-menu' }}
      menu={{
        items: [
          {
            type: 'group',
            label: '切换客户端',
            children: clientOptions.map((option) => ({ key: option.value, label: option.label })),
          },
        ],
        selectable: true,
        selectedKeys: [clientId],
        onClick: ({ key }) => onClientChange(key),
      }}
    >
      <Tooltip title={`切换客户端：${clientName}`}>
        <button type="button" className="topnav-icon-button" aria-label={`切换客户端，当前 ${clientName}`}>
          <AppstoreOutlined />
        </button>
      </Tooltip>
    </Dropdown>,

    sourceDownloadUrl ? (
      <Tooltip key="download" title="下载源文件">
        <a className="topnav-icon-button" href={sourceDownloadUrl} aria-label="下载源文件">
          <DownloadOutlined />
        </a>
      </Tooltip>
    ) : null,

    <Tooltip key="prd" title={prdPath ? '查看 PRD' : '当前页面没有关联 PRD'}>
      <button
        type="button"
        className="topnav-icon-button"
        aria-label="查看 PRD"
        disabled={!prdPath}
        onClick={() => onOpenPrd()}
      >
        <BookOutlined />
      </button>
    </Tooltip>,

    <ThemeControl key="theme" iconOnly />,

    <Dropdown
      key="account"
      menu={{ items: accountItems }}
      trigger={['click']}
      placement="bottomRight"
      classNames={{ root: 'app-pill-menu' }}
    >
      <Tooltip title="账号：Admin">
        <button type="button" className="topnav-icon-button" aria-label="账号：Admin">
          <UserOutlined />
        </button>
      </Tooltip>
    </Dropdown>,
  ].filter(Boolean);

  return (
    <div className="client-actions">
      {entries.map((entry, index) => (
        <Fragment key={index}>{entry}</Fragment>
      ))}
    </div>
  );
}
