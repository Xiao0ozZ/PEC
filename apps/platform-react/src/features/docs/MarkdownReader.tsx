import { useEffect, useMemo, useRef, type MouseEvent } from 'react';

import { Alert, Spin } from '@/ui/ant';
import { renderMarkdown, type MarkdownHeading } from './markdown';

type MermaidInstance = (typeof import('mermaid'))['default'];

let mermaidModulePromise: Promise<MermaidInstance> | null = null;
let mermaidRenderSequence = 0;

function loadMermaid() {
  return (mermaidModulePromise ??= import('mermaid').then((module) => {
    // Vite production builds may unwrap a package's default export during
    // dynamic import, while development keeps the module namespace object.
    // Normalize both shapes before using Mermaid so the production bundle does
    // not fail before the diagram container is created.
    const candidate = (module as { default?: unknown }).default;
    const mermaid =
      candidate && typeof candidate === 'object' && 'initialize' in candidate
        ? (candidate as MermaidInstance)
        : (module as unknown as MermaidInstance);
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
    return mermaid;
  }));
}

function replaceMermaidBlockWithError(block: HTMLElement, message: string) {
  const parent = block.parentElement;
  if (!parent) return;
  const container = document.createElement('div');
  container.className = 'mermaid-error';
  container.textContent = `图表渲染失败：${message}`;
  parent.replaceWith(container);
}

function findMermaidBlocks(article: HTMLElement | null) {
  return Array.from(article?.querySelectorAll<HTMLElement>('pre > code') ?? []).filter((code) =>
    code.classList.contains('language-mermaid'),
  );
}

export function MarkdownReader({
  source,
  loading,
  error,
  onHeadings,
  resolveAssetUrl,
  documentPath,
  resolveDocumentUrl,
  onDocumentNavigate,
  activeAnchor,
}: {
  source: string;
  loading: boolean;
  error?: string;
  onHeadings?: (headings: MarkdownHeading[]) => void;
  resolveAssetUrl?: (path: string) => string;
  documentPath?: string;
  resolveDocumentUrl?: (path: string, anchor?: string) => string;
  onDocumentNavigate?: (path: string, anchor?: string) => void;
  activeAnchor?: string;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const rendered = useMemo(
    () => renderMarkdown(source, { documentPath, resolveAssetUrl, resolveDocumentUrl }),
    [documentPath, resolveAssetUrl, resolveDocumentUrl, source],
  );

  function handleArticleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    const link = target?.closest<HTMLAnchorElement>('a[data-doc-path]');
    if (!link || !onDocumentNavigate) return;
    event.preventDefault();
    onDocumentNavigate(link.dataset.docPath || '', link.dataset.docAnchor || '');
  }

  useEffect(() => onHeadings?.(rendered.headings), [onHeadings, rendered.headings]);

  useEffect(() => {
    if (!findMermaidBlocks(articleRef.current).length) return;
    let cancelled = false;
    void loadMermaid()
      .then(async (mermaid) => {
        // The outline callback can update the parent while Mermaid is loading,
        // which may replace the article's children. Query the live DOM again
        // instead of retaining detached code-block nodes from the first pass.
        const blocks = findMermaidBlocks(articleRef.current);
        for (const [index, code] of blocks.entries()) {
          if (cancelled || !code.parentElement) return;
          const container = document.createElement('div');
          container.className = 'mermaid-diagram';
          code.parentElement.replaceWith(container);
          try {
            const result = await mermaid.render(
              `react-prd-${++mermaidRenderSequence}-${index}`,
              code.textContent || '',
            );
            if (cancelled) return;
            container.innerHTML = result.svg;
            result.bindFunctions?.(container);
          } catch (renderError) {
            container.className = 'mermaid-error';
            container.textContent = `图表渲染失败：${renderError instanceof Error ? renderError.message : '未知错误'}`;
          }
        }
      })
      .catch((loadError) => {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : 'Mermaid 模块加载失败';
        findMermaidBlocks(articleRef.current).forEach((block) =>
          replaceMermaidBlockWithError(block, message),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [rendered.html]);

  useEffect(() => {
    if (!activeAnchor || loading) return;
    const frame = window.requestAnimationFrame(() => {
      articleRef.current?.querySelector<HTMLElement>(`#${CSS.escape(activeAnchor)}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeAnchor, loading, rendered.html]);

  if (loading)
    return (
      <div className="document-loading">
        <Spin size="large" />
      </div>
    );
  if (error) return <Alert type="error" showIcon title="文档读取失败" description={error} />;
  return (
    <article
      ref={articleRef}
      className="markdown-body"
      onClick={handleArticleClick}
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}
