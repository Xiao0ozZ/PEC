import { memo, useEffect, useRef, useState } from 'react';

import type { HtmlPrototypePage, PrdBinding } from '../../../../../packages/platform-contracts/src/index.js';
import { clearPrdBindingMarkers, installPrdBindingMarkers } from '@/features/docs/prd-binding-markers';
import { installFrameSmoothScroll, installFrameTopnavOffset } from '@/features/motion/smooth-scroll';
import { Button, Result, Spin, Typography } from '@/ui/ant';
import { ReloadOutlined } from '@/ui/ant/icons';

const { Text } = Typography;

type PrototypeFrameTheme = PrototypeFrameProps['theme'];

const FRAME_THEME_TOKEN_MAP = [
  ['--app-color-surface', '--ant-color-bg-container'],
  ['--app-color-surface-subtle', '--ant-color-fill-quaternary'],
  ['--app-color-surface-muted', '--ant-color-fill-tertiary'],
  ['--app-color-text-primary', '--ant-color-text'],
  ['--app-color-text-secondary', '--ant-color-text-secondary'],
  ['--app-color-text-muted', '--ant-color-text-tertiary'],
  ['--app-color-border', '--ant-color-border'],
  ['--app-color-border-light', '--ant-color-border-secondary'],
  ['--app-color-border-subtle', '--ant-color-split'],
  ['--app-color-sidebar', '--ant-layout-sider-bg'],
  ['--app-color-sidebar-border', '--ant-color-border-secondary'],
  ['--app-color-sidebar-text', '--ant-color-text'],
  ['--app-color-sidebar-muted', '--ant-color-text-tertiary'],
  ['--app-color-sidebar-hover', '--ant-color-fill-tertiary'],
  ['--app-color-success', '--ant-color-success'],
  ['--app-color-warning', '--ant-color-warning'],
  ['--app-color-danger', '--ant-color-error'],
  ['--app-color-primary-light-3', '--ant-color-primary-hover'],
  ['--app-color-primary-light-5', '--ant-color-primary-border'],
  ['--app-color-primary-light-7', '--ant-color-primary-border-hover'],
  ['--app-color-primary-light-8', '--ant-color-primary-bg-hover'],
  ['--app-color-primary-light-9', '--ant-color-primary-bg'],
] as const;

const FRAME_SHELL_STYLE_ID = 'platform-frame-shell-background';

function syncPrototypeFrameShell(frameDocument: Document) {
  const style = frameDocument.getElementById(FRAME_SHELL_STYLE_ID) ?? frameDocument.createElement('style');

  style.id = FRAME_SHELL_STYLE_ID;
  style.textContent = `
    html,
    body,
    #app,
    #root,
    .prototype-app,
    .export-shell {
      background: transparent !important;
      background-image: none !important;
    }
  `;

  if (!style.parentNode) {
    (frameDocument.head ?? frameDocument.documentElement).appendChild(style);
  }
}

function syncPrototypeFrameTheme(frameDocument: Document, theme: PrototypeFrameTheme) {
  const root = frameDocument.documentElement;
  if (!root) return;

  syncPrototypeFrameShell(frameDocument);

  const hostRoot = document.documentElement;
  const hostElement = document.querySelector('.app-frame') ?? hostRoot;
  const resolvedTheme = hostRoot.dataset.theme || 'glass';
  const themeMode = hostRoot.dataset.themeMode;
  const hostStyles = window.getComputedStyle(hostElement);
  const hasThemeBridge = Boolean(frameDocument.querySelector('[data-theme-bridge]'));

  root.dataset.theme = resolvedTheme;
  if (themeMode) root.dataset.themeMode = themeMode;
  else delete root.dataset.themeMode;

  for (const [target, source] of FRAME_THEME_TOKEN_MAP) {
    const value = hostStyles.getPropertyValue(source).trim();
    if (value) root.style.setProperty(target, value);
  }

  const hostPageBackground = hostStyles.getPropertyValue('--ant-color-bg-layout').trim();
  const pageBackground =
    resolvedTheme === 'dark' ? hostPageBackground : theme.pageBackground || hostPageBackground;
  if (pageBackground) {
    root.style.setProperty('--app-color-host-page', pageBackground);
    // 新模板通过主题桥接层读取 host page；旧模板仍保留原有的直接注入方式。
    if (!hasThemeBridge) root.style.setProperty('--app-color-page', pageBackground);
  }

  root.style.setProperty('--app-color-primary', theme.primary);
  root.style.setProperty('--el-color-primary', theme.primary);
  root.style.setProperty('--prototype-color-primary', theme.primary);
  if (theme.primaryHover) root.style.setProperty('--app-color-primary-hover', theme.primaryHover);
  if (theme.primaryActive) root.style.setProperty('--app-color-primary-active', theme.primaryActive);
}

export interface PrototypeFrameProps {
  page: HtmlPrototypePage;
  source: string;
  theme: {
    primary: string;
    primaryHover?: string;
    primaryActive?: string;
    pageBackground?: string;
  };
  prdBindings: PrdBinding[];
  contentTopOffset?: number;
  onOpenPrd: (target: { documentPath: string; anchor?: string }) => void;
  onLoad: (frame: HTMLIFrameElement) => void;
}

function arePrototypeFramePropsEqual(previous: PrototypeFrameProps, next: PrototypeFrameProps) {
  if (
    previous.page !== next.page ||
    previous.source !== next.source ||
    previous.contentTopOffset !== next.contentTopOffset ||
    previous.onOpenPrd !== next.onOpenPrd ||
    previous.onLoad !== next.onLoad
  ) {
    return false;
  }

  const previousTheme = previous.theme;
  const nextTheme = next.theme;
  if (
    previousTheme.primary !== nextTheme.primary ||
    previousTheme.primaryHover !== nextTheme.primaryHover ||
    previousTheme.primaryActive !== nextTheme.primaryActive ||
    previousTheme.pageBackground !== nextTheme.pageBackground
  ) {
    return false;
  }

  if (previous.prdBindings.length !== next.prdBindings.length) return false;
  return previous.prdBindings.every((binding, index) => binding === next.prdBindings[index]);
}

export const PrototypeFrame = memo(function PrototypeFrame({
  page,
  source,
  theme,
  prdBindings,
  contentTopOffset = 0,
  onOpenPrd,
  onLoad,
}: PrototypeFrameProps) {
  const { primary, primaryActive, primaryHover, pageBackground } = theme;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [frameState, setFrameState] = useState<{
    source: string;
    status: 'loading' | 'ready' | 'error';
  }>({ source, status: 'loading' });
  const [retryVersion, setRetryVersion] = useState(0);
  const frameStatus = frameState.source === source ? frameState.status : 'loading';

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const handleError = () => setFrameState({ source, status: 'error' });
    frame.addEventListener('error', handleError);
    return () => frame.removeEventListener('error', handleError);
  }, [retryVersion, source]);

  useEffect(() => {
    const frameDocument = frameRef.current?.contentDocument;
    if (!frameDocument) return;
    installFrameTopnavOffset(frameDocument, contentTopOffset);
  }, [contentTopOffset, loadVersion]);

  useEffect(() => {
    const frameDocument = frameRef.current?.contentDocument;
    if (!frameDocument || typeof MutationObserver === 'undefined') return;

    const syncTheme = () =>
      syncPrototypeFrameTheme(frameDocument, { primary, primaryActive, primaryHover, pageBackground });
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-theme-mode'],
    });
    return () => observer.disconnect();
  }, [loadVersion, pageBackground, primary, primaryActive, primaryHover]);

  useEffect(() => {
    const frameDocument = frameRef.current?.contentDocument;
    if (!frameDocument) return;
    installPrdBindingMarkers(frameDocument, prdBindings, (binding) =>
      onOpenPrd({ documentPath: binding.prd.document, anchor: binding.prd.anchor }),
    );
    return () => clearPrdBindingMarkers(frameDocument);
  }, [loadVersion, onOpenPrd, prdBindings]);

  function handleLoad(frame: HTMLIFrameElement) {
    try {
      const frameDocument = frame.contentDocument;
      if (frameDocument) {
        installFrameSmoothScroll(frameDocument);
        installFrameTopnavOffset(frameDocument, contentTopOffset);
        syncPrototypeFrameTheme(frameDocument, theme);
      }
    } catch {
      // 同源页面会同步项目主题；跨域页面保持自己的主题，不阻塞加载。
    }
    setFrameState({ source, status: 'ready' });
    setLoadVersion((version) => version + 1);
    onLoad(frame);
  }

  function retry() {
    setFrameState({ source, status: 'loading' });
    setRetryVersion((version) => version + 1);
  }

  return (
    <div className="prototype-frame-host" aria-busy={frameStatus === 'loading'}>
      {frameStatus === 'loading' ? (
        <div className="prototype-frame-state" role="status">
          <Spin size="large" />
          <Text type="secondary">正在加载原型页面…</Text>
        </div>
      ) : null}
      {frameStatus === 'error' ? (
        <div className="prototype-frame-state prototype-frame-state--error">
          <Result
            status="error"
            title="原型页面加载失败"
            subTitle="请确认原型文件仍然存在，并检查当前网络或局域网服务是否可访问。"
            extra={
              <Button type="primary" icon={<ReloadOutlined />} onClick={retry}>
                重新加载
              </Button>
            }
          />
        </div>
      ) : null}
      <iframe
        key={`${source}:${retryVersion}`}
        className="prototype-frame"
        ref={frameRef}
        src={source}
        scrolling="auto"
        title={page.title}
        referrerPolicy="same-origin"
        onLoad={(event) => handleLoad(event.currentTarget)}
      />
    </div>
  );
}, arePrototypeFramePropsEqual);
