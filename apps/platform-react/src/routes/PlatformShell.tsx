import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Button, Layout, Menu, type MenuProps } from '@/ui/ant';
import {
  AppstoreOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  OrderedListOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@/ui/ant/icons';
import { AppSidebar } from '@/ui/platform/AppSidebar';
import { ThemeControl } from '@/ui/platform/ThemeControl';

const { Content } = Layout;
const COLLAPSED_KEY = 'product-experience-center:platform-nav-collapsed';

/**
 * 平台导航分组。
 *
 * 分组标题是**不可点**的一级，二级页面始终铺开——展开态一个页面都不用多点一次，
 * 收起态则退化成「图标父项 + 悬浮浮层」。
 */
const navigationSections = [
  {
    key: 'overview',
    label: '概览',
    icon: <DashboardOutlined />,
    items: [{ key: '/tools/console', label: '控制台', icon: <SettingOutlined /> }],
  },
  {
    key: 'projects',
    label: '项目资料',
    icon: <FolderOpenOutlined />,
    items: [
      { key: '/tools/projects', label: '项目包管理', icon: <FolderOpenOutlined /> },
      { key: '/tools/project-health', label: '项目健康检查', icon: <SafetyCertificateOutlined /> },
      { key: '/tools/project-routes', label: '路由菜单管理', icon: <OrderedListOutlined /> },
    ],
  },
  {
    key: 'pages',
    label: '页面与需求',
    icon: <UploadOutlined />,
    items: [
      { key: '/tools/page-transfer', label: '页面导入导出', icon: <UploadOutlined /> },
      { key: '/tools/ai-context', label: 'AI 上下文中心', icon: <DatabaseOutlined /> },
    ],
  },
  {
    key: 'reference',
    label: '参考',
    icon: <AppstoreOutlined />,
    items: [{ key: '/components', label: '组件规范', icon: <AppstoreOutlined /> }],
  },
];

const navigation = navigationSections.flatMap((section) => section.items);

/**
 * 展开态用 `type: "group"`（一级是标题）；收起态换成只有图标的父项，
 * 二级收进悬浮浮层——64px 宽放不下分组标题，平铺成一串图标又会丢掉归属关系。
 */
function buildMenuItems(collapsed: boolean): MenuProps['items'] {
  return navigationSections.map((section) => {
    const children = section.items.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.label,
    }));
    return collapsed
      ? { key: section.key, icon: section.icon, label: section.label, children }
      : { type: 'group' as const, key: section.key, label: section.label, children };
  });
}

export function PlatformShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const currentPath = navigation.find((item) => location.pathname.startsWith(item.key))?.key;

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }

  return (
    <Layout className="platform-workspace">
      <div className="app-shell-body platform-workspace__body">
        <AppSidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          brandMark={<AppstoreOutlined />}
          brandTitle="产品功能体验中心"
          onBrandClick={() => navigate('/')}
          routeKey={location.pathname}
          nav={(isCollapsed) => (
            <Menu
              className="platform-workspace__menu"
              mode="inline"
              selectedKeys={currentPath ? [currentPath] : []}
              items={buildMenuItems(isCollapsed)}
              onClick={({ key }) => navigate(String(key))}
            />
          )}
          tools={(isCollapsed) => (
            <>
              <ThemeControl showLabel={!isCollapsed} />
              <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/')}>
                {isCollapsed ? null : '返回首页'}
              </Button>
            </>
          )}
        />
        <div className="app-workspace-panel">
          <Content className="platform-workspace__content">
            <div className="platform-workspace__route" key={location.pathname}>
              <Outlet />
            </div>
          </Content>
        </div>
      </div>
    </Layout>
  );
}
