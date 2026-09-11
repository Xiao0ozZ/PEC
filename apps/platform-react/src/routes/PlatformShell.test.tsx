import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { PlatformThemeProvider } from '@/features/theme/platform-theme';

import { PlatformShell } from './PlatformShell';

beforeEach(() => {
  // jsdom 默认不实现 matchMedia；这里固定成桌面态，才会渲染常驻侧栏而不是抽屉。
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PlatformShell', () => {
  it('uses one sidebar frame with grouped navigation and a separate content panel', () => {
    render(
      <PlatformThemeProvider>
        <MemoryRouter initialEntries={['/tools/console']}>
          <Routes>
            <Route element={<PlatformShell />}>
              <Route path="tools/console" element={<div>控制台内容</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </PlatformThemeProvider>,
    );

    expect(document.querySelector('.app-sider')).not.toBeNull();
    expect(document.querySelector('.app-workspace-panel')).not.toBeNull();
    expect(screen.getByText('产品功能体验中心')).toBeInTheDocument();
    // 一级是分组标题，控制台挂在「概览」分组下。
    expect(screen.getByText('概览')).toBeInTheDocument();
    expect(screen.getAllByText('控制台').length).toBeGreaterThan(0);
    expect(screen.getByText('控制台内容')).toBeInTheDocument();
  });
});
