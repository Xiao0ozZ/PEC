import { useEffect, useMemo, useRef, type MouseEvent } from 'react';

import { Alert, Spin } from '@/ui/ant';
import { renderMarkdown, type MarkdownHeading } from './markdown';

let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;
let mermaidRenderSequence = 0;

function loadMermaid() {
  return (mermaidModulePromise ??= import('mermaid').then((module) => {
    module.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
    return module;
  }));
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
    const article = articleRef.current;
    const blocks = Array.from(article?.querySelectorAll<HTMLElement>('pre > code.language-mermaid') ?? []);
    if (!blocks.length) return;
    let cancelled = false;
    void loadMermaid().then(async ({ default: mermaid }) => {
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
