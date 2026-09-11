import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HtmlPrototypePage } from '../../../../../packages/platform-contracts/src/index.js';
import { PrototypeFrame } from './PrototypeFrame';

const page = {
  path: 'dashboard',
  title: '综合仪表板',
  source: 'dashboard.html',
  sourceRoot: 'operation',
} as HtmlPrototypePage;

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-mode');
  document.documentElement.style.cssText = '';
});

describe('PrototypeFrame', () => {
  it('shows a loading state and reveals the page after the iframe loads', () => {
    const onLoad = vi.fn();
    render(
      <PrototypeFrame
        page={page}
        source="/__html/dashboard.html"
        theme={{ primary: '#1677ff' }}
        prdBindings={[]}
        onOpenPrd={vi.fn()}
        onLoad={onLoad}
      />,
    );

    expect(screen.getByText('正在加载原型页面…')).toBeInTheDocument();
    fireEvent.load(screen.getByTitle('综合仪表板'));
    expect(screen.queryByText('正在加载原型页面…')).not.toBeInTheDocument();
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('shows a recoverable error instead of leaving an unexplained blank area', async () => {
    render(
      <PrototypeFrame
        page={page}
        source="/__html/missing.html"
        theme={{ primary: '#1677ff' }}
        prdBindings={[]}
        onOpenPrd={vi.fn()}
        onLoad={vi.fn()}
      />,
    );

    fireEvent.error(screen.getByTitle('综合仪表板'));
    expect(await screen.findByText('原型页面加载失败')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }));
    expect(await screen.findByText('正在加载原型页面…')).toBeInTheDocument();
  });

  it('syncs the host theme and follows later theme changes', async () => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.themeMode = 'dark';
    document.documentElement.style.setProperty('--ant-color-bg-layout', '#000000');
    document.documentElement.style.setProperty('--ant-color-bg-container', '#141414');
    document.documentElement.style.setProperty('--ant-color-text', 'rgba(255, 255, 255, 0.88)');

    render(
      <PrototypeFrame
        page={page}
        source="/__html/dashboard.html"
        theme={{ primary: '#1677ff' }}
        prdBindings={[]}
        onOpenPrd={vi.fn()}
        onLoad={vi.fn()}
      />,
    );

    const frame = screen.getByTitle('综合仪表板') as HTMLIFrameElement;
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      value: document.implementation.createHTMLDocument(),
    });
    fireEvent.load(frame);

    await waitFor(() => {
      expect(frame.contentDocument?.documentElement.dataset.theme).toBe('dark');
    });
    expect(frame.contentDocument?.documentElement.dataset.themeMode).toBe('dark');
    expect(frame.contentDocument?.documentElement.style.getPropertyValue('--app-color-surface')).toBe(
      '#141414',
    );

    document.documentElement.dataset.theme = 'glass';
    await waitFor(() => {
      expect(frame.contentDocument?.documentElement.dataset.theme).toBe('glass');
    });
  });
});
