import { describe, expect, it } from 'vitest';

import { createAntThemeConfig } from './ant-theme-config';

describe('createAntThemeConfig', () => {
  it('uses the glass material as the only light theme', () => {
    const config = createAntThemeConfig('glass');

    expect(config.token).toMatchObject({
      colorPrimary: '#1677FF',
      colorBgLayout: '#f5f7fa',
      colorBgContainer: 'rgba(255, 255, 255, 0.68)',
      borderRadius: 6,
      borderRadiusLG: 8,
      controlHeight: 32,
      fontFamily:
        "'SF Pro Text', 'SF Pro Display', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
      fontFamilyCode:
        "'SFMono-Regular', 'SF Mono', ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    });
    expect(config.components?.Layout).toMatchObject({
      bodyBg: '#f5f7fa',
      headerBg: 'rgba(255, 255, 255, 0.76)',
      siderBg: 'rgba(255, 255, 255, 0.72)',
      triggerBg: 'rgba(255, 255, 255, 0.82)',
    });
    expect(config.components?.Menu).toMatchObject({
      activeBarBorderWidth: 0,
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemHeight: 36,
      itemMarginBlock: 2,
      itemSelectedBg: 'var(--ant-color-primary)',
      itemSelectedColor: '#fff',
      horizontalLineHeight: 36,
      horizontalItemBorderRadius: 18,
    });
  });

  it('keeps dark mode separate from the light glass material', () => {
    const config = createAntThemeConfig('dark');

    expect(config.token).toMatchObject({
      colorPrimary: '#1677FF',
    });
    expect(config.components?.Layout).toMatchObject({
      bodyBg: '#000000',
      headerBg: '#141414',
    });
  });
});
