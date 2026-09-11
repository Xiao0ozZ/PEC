import { Button, Dropdown, Tooltip, type MenuProps } from '@/ui/ant';
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@/ui/ant/icons';
import { usePlatformTheme, type PlatformThemeMode } from '@/features/theme/platform-theme';

const modeLabels: Record<PlatformThemeMode, string> = {
  system: '跟随系统',
  dark: '深色主题',
  glass: '浅色主题',
};

export function ThemeControl({
  showLabel = false,
  iconOnly = false,
}: {
  showLabel?: boolean;
  iconOnly?: boolean;
}) {
  const { mode, resolvedMode, setMode } = usePlatformTheme();
  const items: MenuProps['items'] = [
    {
      type: 'group',
      label: '界面主题',
      children: [
        { key: 'system', icon: <DesktopOutlined />, label: '跟随系统' },
        { key: 'glass', icon: <SunOutlined />, label: '浅色主题' },
        { key: 'dark', icon: <MoonOutlined />, label: '深色主题' },
      ],
    },
  ];
  const icon =
    mode === 'system' ? (
      <DesktopOutlined />
    ) : resolvedMode === 'dark' ? (
      <MoonOutlined />
    ) : resolvedMode === 'glass' ? (
      <SunOutlined />
    ) : (
      <SunOutlined />
    );
  const menu = {
    items,
    selectable: true,
    selectedKeys: [mode],
    onClick: ({ key }: { key: string }) => {
      setMode(key as PlatformThemeMode);
    },
  };

  /** 顶栏形态只保留图标，具体主题名称由悬浮提示和菜单承载。 */
  if (iconOnly) {
    return (
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        classNames={{ root: 'app-pill-menu' }}
        menu={menu}
      >
        <Tooltip title={`主题：${modeLabels[mode]}`}>
          <button
            type="button"
            className="topnav-icon-button theme-control"
            aria-label={`主题：${modeLabels[mode]}`}
          >
            {icon}
          </button>
        </Tooltip>
      </Dropdown>
    );
  }

  return (
    <Dropdown trigger={['click']} menu={menu}>
      <Tooltip title={`主题：${modeLabels[mode]}`}>
        <Button className="theme-control" type="text" icon={icon} aria-label={`主题：${modeLabels[mode]}`}>
          {showLabel ? modeLabels[mode] : null}
        </Button>
      </Tooltip>
    </Dropdown>
  );
}
