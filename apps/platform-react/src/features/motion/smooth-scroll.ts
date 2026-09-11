const STYLE_ID = 'platform-smooth-scroll';
const TOPNAV_SPACER_ATTRIBUTE = 'data-platform-topnav-spacer';
const TOPNAV_OFFSET_ATTRIBUTE = 'data-platform-topnav-offset';

const FRAME_SMOOTH_SCROLL_CSS = `
:root { --platform-scroll-behavior: smooth; }
html, body, body * { scroll-behavior: var(--platform-scroll-behavior); }
@media (prefers-reduced-motion: reduce) {
  :root { --platform-scroll-behavior: auto; }
}
`;

export function installFrameSmoothScroll(frameDocument: Document) {
  let style = frameDocument.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = frameDocument.createElement('style');
    style.id = STYLE_ID;
    frameDocument.head?.append(style);
  }
  style.textContent = FRAME_SMOOTH_SCROLL_CSS;
}

function findFrameContentRoot(frameDocument: Document): HTMLElement | null {
  const preferredRoots = [
    '.prototype-main',
    '[data-prototype-scroll-root]',
    'main',
    '[data-page-content]',
    '#app',
    'body',
  ];

  for (const selector of preferredRoots) {
    const root = frameDocument.querySelector<HTMLElement>(selector);
    if (root) return root;
  }

  return frameDocument.scrollingElement as HTMLElement | null;
}

function getDirectChildSpacer(root: HTMLElement) {
  return Array.from(root.children).find((child) => child.hasAttribute(TOPNAV_SPACER_ATTRIBUTE)) as
    | HTMLElement
    | undefined;
}

/**
 * Reserve the floating top navigation only at the initial scroll position.
 * The spacer lives inside the prototype's own scroll root, so it scrolls away
 * with the page instead of permanently shrinking the iframe viewport.
 */
export function installFrameTopnavOffset(frameDocument: Document, offset: number) {
  const existingSpacers = Array.from(
    frameDocument.querySelectorAll<HTMLElement>(`[${TOPNAV_SPACER_ATTRIBUTE}]`),
  );

  if (!Number.isFinite(offset) || offset <= 0) {
    existingSpacers.forEach((spacer) => spacer.remove());
    frameDocument.querySelectorAll<HTMLElement>(`[${TOPNAV_OFFSET_ATTRIBUTE}]`).forEach((root) => {
      root.removeAttribute(TOPNAV_OFFSET_ATTRIBUTE);
    });
    return;
  }

  const root = findFrameContentRoot(frameDocument);
  if (!root) return;

  existingSpacers.forEach((spacer) => {
    if (spacer.parentElement !== root) spacer.remove();
  });

  const spacer = getDirectChildSpacer(root) || frameDocument.createElement('div');
  spacer.setAttribute(TOPNAV_SPACER_ATTRIBUTE, '');
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.display = 'block';
  spacer.style.width = '100%';
  spacer.style.height = `${offset}px`;
  spacer.style.minHeight = `${offset}px`;
  spacer.style.flex = `0 0 ${offset}px`;
  spacer.style.pointerEvents = 'none';
  spacer.style.visibility = 'hidden';
  if (!spacer.parentElement) root.insertBefore(spacer, root.firstChild);

  root.setAttribute(TOPNAV_OFFSET_ATTRIBUTE, `${offset}px`);
}
