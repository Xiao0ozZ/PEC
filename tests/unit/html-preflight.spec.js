import { describe, expect, it } from 'vitest';

import { inspectHtmlPrototype } from '../../packages/project-core/src/index.js';

function templateHtml(content = '<main data-page-content data-business-content>内容</main>') {
  return `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>页面</title><style>:root{--app-color-primary:#007aff}</style></head>
<body><!-- [AI-EDIT] PAGE_CONTENT_START -->${content}<!-- PAGE_CONTENT_END --><!-- [AI-EDIT] PAGE_OVERLAYS_START --><div data-page-overlay hidden></div><!-- PAGE_OVERLAYS_END -->
<script id="prototype-page-manifest" type="application/json">{"templateVersion":1,"pageKey":"page","pageTitle":"页面","client":"admin","routePath":"/admin/page"}</script>
<script>/* [AI-EDIT] PAGE_LOGIC_START */ const ready = true; void ready; /* PAGE_LOGIC_END */</script></body></html>`;
}

describe('HTML prototype preflight', () => {
  it('accepts a portable template that keeps the required editing boundaries', () => {
    expect(inspectHtmlPrototype(templateHtml())).toMatchObject({
      valid: true,
      summary: { template: true, contentCount: 1, businessContentCount: 1 },
    });
  });

  it('rejects duplicate content roots and inline event handlers', () => {
    const result = inspectHtmlPrototype(
      templateHtml(
        '<main data-page-content data-business-content onclick="run()"></main><div data-page-content></div>',
      ),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((item) => item.code)).toEqual(
      expect.arrayContaining(['page-content-count', 'inline-events']),
    );
  });

  it('rejects duplicate sidebar shells', () => {
    const sidebarMarkup = '<aside class="prototype-sidebar" data-prototype-shell="sidebar"></aside>';
    const duplicatedSidebar = templateHtml().replace('<body>', `<body>${sidebarMarkup}${sidebarMarkup}`);
    expect(inspectHtmlPrototype(duplicatedSidebar).errors.map((item) => item.code)).toContain(
      'duplicate-sidebar',
    );
    expect(inspectHtmlPrototype(templateHtml()).errors.map((item) => item.code)).not.toContain(
      'duplicate-sidebar',
    );

  });

  it('warns on window.location navigation instead of standard relative links', () => {
    const source = templateHtml(
      '<main data-page-content data-business-content><button id="go">跳转</button></main>',
    ).replace('const ready = true;', 'function go() { window.location.href = "./other.html"; }');
    const result = inspectHtmlPrototype(source);

    expect(result.valid).toBe(true);
    expect(result.warnings.map((item) => item.code)).toContain('location-navigation');
  });

  it('verifies relative cross-page links against the provided sibling file set', () => {
    const source = templateHtml(
      '<main data-page-content data-business-content><a href="./detail.html?id=9&type=b">详情</a><a href="./missing.html">缺失</a></main>',
    );

    const checked = inspectHtmlPrototype(source, {
      fileName: 'list.html',
      knownFiles: ['list.html', 'detail.html'],
    });
    const brokenLinks = checked.errors.filter((item) => item.code === 'broken-relative-link');
    expect(brokenLinks).toHaveLength(1);
    expect(brokenLinks[0].message).toContain('./missing.html');
    expect(checked.valid).toBe(false);

    // 未提供文件集合时跳过互链存在性检查（单文件检查没有目录上下文）。
    const unchecked = inspectHtmlPrototype(source, { fileName: 'list.html' });
    expect(unchecked.errors.some((item) => item.code === 'broken-relative-link')).toBe(false);
  });

});
