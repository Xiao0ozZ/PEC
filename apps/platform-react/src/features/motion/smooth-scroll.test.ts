import { describe, expect, it } from 'vitest';

import { installFrameSmoothScroll, installFrameTopnavOffset } from './smooth-scroll';

describe('global smooth scroll', () => {
  it('installs one reduced-motion-aware style in an iframe document', () => {
    const frameDocument = document.implementation.createHTMLDocument('prototype');
    installFrameSmoothScroll(frameDocument);
    installFrameSmoothScroll(frameDocument);

    const styles = frameDocument.querySelectorAll('#platform-smooth-scroll');
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain('scroll-behavior: var(--platform-scroll-behavior)');
    expect(styles[0].textContent).toContain('prefers-reduced-motion: reduce');
  });

  it('puts the top navigation offset inside the prototype scroll root', () => {
    const frameDocument = document.implementation.createHTMLDocument('prototype');
    const scrollRoot = frameDocument.createElement('main');
    scrollRoot.className = 'prototype-main';
    scrollRoot.innerHTML = '<section data-page-content>内容</section>';
    frameDocument.body.append(scrollRoot);

    installFrameTopnavOffset(frameDocument, 72);
    installFrameTopnavOffset(frameDocument, 72);

    const spacers = scrollRoot.querySelectorAll('[data-platform-topnav-spacer]');
    expect(spacers).toHaveLength(1);
    expect((spacers[0] as HTMLElement).style.height).toBe('72px');
    expect(scrollRoot.firstElementChild).toBe(spacers[0]);

    installFrameTopnavOffset(frameDocument, 0);
    expect(scrollRoot.querySelector('[data-platform-topnav-spacer]')).not.toBeInTheDocument();
  });
});
