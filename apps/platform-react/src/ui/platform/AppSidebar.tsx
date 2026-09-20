import { useEffect, useState, type ReactNode } from 'react';

import { Button, Drawer, Layout, Tooltip } from '@/ui/ant';
import { MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined } from '@/ui/ant/icons';

const { Sider } = Layout;

// 与 BoardUI 桌面侧栏保持同一 260px 节奏；内外留白由 app-shell-frame.css 统一控制。
const SIDER_WIDTH = 260;
const SIDER_COLLAPSED_WIDTH = 64;
const DRAWER_WIDTH = 272;
const DESKTOP_QUERY = '(min-width: 992px)';

/**
 * 侧栏 / 抽屉的切换点。
 *
 * 刻意不用 antd 的 `Grid.useBreakpoint()`：它首帧返回空对象，
 * 实测视口变窄后也不一定更新，结果仍被判成桌面、抽屉永远出不来。
 * `matchMedia` 是同一件事的直接表达，首帧就有确定值。
 */
export function useMinWidth(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

export interface AppSidebarProps {
  /** 常驻侧栏是否收起；抽屉内永远是展开态。 */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  brandMark: ReactNode;
  /** 展开态可使用完整正式品牌标志；未提供时回退到图形 + 文字。 */
  brandLogo?: ReactNode;
  brandTitle: string;
  brandSubtitle?: string;
  onBrandClick?: () => void;
  /** 品牌区下方的选择器槽位（平台侧无此槽位）。 */
  selector?: ReactNode;
  /** 菜单区。收起态传 true，调用方据此切换 group / submenu 结构。 */
  nav: (collapsed: boolean) => ReactNode;
  /** 菜单与账号之间的工具区。 */
  tools?: (collapsed: boolean) => ReactNode;
  /** 侧栏最底部。 */
  account?: (collapsed: boolean) => ReactNode;
  /** 路由标识；变化即关抽屉。 */
  routeKey?: string;
}

/**
 * 两个外壳共用的侧栏框架。
 *
 * 纵向五段：品牌（含折叠按钮）→ 选择器 → 菜单（独立滚动）→ 工具 → 账号。
 * 常驻侧栏与窄屏抽屉必须是同一份导航，各写一份迟早只改其中一处，
 * 因此内容抽成渲染函数，`inDrawer` 只影响收起态（抽屉里没有收起的意义）。
 */
export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  brandMark,
  brandLogo,
  brandTitle,
  brandSubtitle,
  onBrandClick,
  selector,
  nav,
  tools,
  account,
  routeKey,
}: AppSidebarProps) {
  const isDesktop = useMinWidth(DESKTOP_QUERY);
  function renderShell(inDrawer: boolean) {
    const isCollapsed = collapsed && !inDrawer;

    return (
      <div className={`app-sider-shell${isCollapsed ? ' app-sider-shell--collapsed' : ''}`}>
        <div className="app-sider__brand">
          <button type="button" className="app-sider__brand-button" onClick={onBrandClick}>
            {!isCollapsed && brandLogo ? (
              <span className="app-sider__brand-logo">{brandLogo}</span>
            ) : (
              <>
                <span className="app-sider__brand-mark">{brandMark}</span>
                {isCollapsed ? null : (
                  <span className="app-sider__brand-copy">
                    <b>{brandTitle}</b>
                    {brandSubtitle ? <small>{brandSubtitle}</small> : null}
                  </span>
                )}
              </>
            )}
          </button>
          {inDrawer ? null : (
            <Tooltip title={isCollapsed ? '展开导航' : '收起导航'} placement="right">
              <Button
                type="text"
                className="app-sider__collapse"
                aria-label={isCollapsed ? '展开导航' : '收起导航'}
                icon={isCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={onToggleCollapsed}
              />
            </Tooltip>
          )}
        </div>

        {selector && !isCollapsed ? <div className="app-sider__slot">{selector}</div> : null}

        <div className="app-sider__nav">{nav(isCollapsed)}</div>

        {tools ? <div className="app-sider__tools">{tools(isCollapsed)}</div> : null}
        {account ? <div className="app-sider__account">{account(isCollapsed)}</div> : null}
      </div>
    );
  }

  if (!isDesktop) {
    return <MobileAppSidebar key={routeKey}>{renderShell(true)}</MobileAppSidebar>;
  }

  return (
    <Sider
      className="app-sider"
      width={SIDER_WIDTH}
      collapsedWidth={SIDER_COLLAPSED_WIDTH}
      collapsed={collapsed}
      trigger={null}
    >
      {renderShell(false)}
    </Sider>
  );
}

function MobileAppSidebar({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <Button
        type="text"
        className="app-sider-drawer-trigger"
        aria-label="打开导航"
        icon={<MenuOutlined />}
        onClick={() => setDrawerOpen(true)}
      />
      <Drawer
        className="app-sider-drawer"
        placement="left"
        size={DRAWER_WIDTH}
        open={drawerOpen}
        closable={false}
        styles={{ body: { padding: 0 } }}
        onClose={() => setDrawerOpen(false)}
      >
        {children}
      </Drawer>
    </>
  );
}
