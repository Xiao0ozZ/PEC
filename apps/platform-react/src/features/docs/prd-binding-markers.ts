import type { PrdBinding } from '../../../../../packages/platform-contracts/src/index.js';

const MARKER_ATTRIBUTE = 'data-platform-prd-marker';
const POSITION_ATTRIBUTE = 'data-platform-prd-marker-position';

function normalizeText(value: string | null | undefined) {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 100);
}

function resolveDomPath(root: Element, path: number[]) {
  let current: Element | undefined = root;
  for (const index of path) {
    current = current.children.item(index) ?? undefined;
    if (!current) return null;
  }
  return current;
}

function scoreElement(element: Element, binding: PrdBinding) {
  const target = binding.target;
  let score = element.tagName === target.tag ? 5 : 0;
  score += (target.classes ?? []).filter((className) => element.classList.contains(className)).length * 3;
  if (target.text) {
    const text = normalizeText(element.textContent);
    if (text === target.text) score += 6;
    else if (text.includes(target.text) || target.text.includes(text)) score += 3;
  }
  return score;
}

function resolveBindingElement(root: Element, binding: PrdBinding, candidates?: Element[]) {
  const direct = resolveDomPath(root, binding.target.domPath ?? []);
  if (direct && scoreElement(direct, binding) >= 5) return direct;

  let best: Element | null = null;
  let bestScore = 0;
  for (const element of candidates ?? root.querySelectorAll('*')) {
    const score = scoreElement(element, binding);
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return bestScore >= 5 ? best : null;
}

export function clearPrdBindingMarkers(document: Document) {
  document.querySelectorAll(`[${MARKER_ATTRIBUTE}]`).forEach((marker) => marker.remove());
  document.querySelectorAll<HTMLElement>(`[${POSITION_ATTRIBUTE}]`).forEach((element) => {
    element.style.position = element.dataset.platformPrdMarkerPosition || '';
    delete element.dataset.platformPrdMarkerPosition;
  });
}

export function installPrdBindingMarkers(
  document: Document,
  bindings: PrdBinding[],
  onOpen: (binding: PrdBinding) => void,
) {
  clearPrdBindingMarkers(document);
  const root =
    document.querySelector(
      '.page-container, [data-page-content], [data-business-content], .prototype-main, main',
    ) ?? document.body;
  if (!root) return;

  // 关联数量增加时复用候选节点列表，避免每个绑定都重复遍历整棵页面树。
  const candidates = Array.from(root.querySelectorAll('*'));
  bindings.forEach((binding) => {
    const target = resolveBindingElement(root, binding, candidates);
    if (!(target instanceof HTMLElement)) return;
    const computed = document.defaultView?.getComputedStyle(target);
    if (computed?.position === 'static') {
      target.dataset.platformPrdMarkerPosition = target.style.position;
      target.style.position = 'relative';
    }

    const marker = document.createElement('span');
    marker.setAttribute(MARKER_ATTRIBUTE, binding.id);
    marker.setAttribute('role', 'button');
    marker.tabIndex = 0;
    marker.textContent = 'PRD';
    marker.title = `查看 PRD：${binding.prd.label || binding.prd.document}`;
    Object.assign(marker.style, {
      position: 'absolute',
      zIndex: '2147483000',
      top: '6px',
      right: '6px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '42px',
      height: '26px',
      padding: '0 9px',
      border: '1px solid var(--app-color-border-light, rgba(255, 255, 255, .72))',
      borderRadius: '999px',
      color: 'var(--app-color-text-on-primary, #fff)',
      background: 'var(--app-color-primary, #1677ff)',
      boxShadow: 'var(--app-shadow-popup, 0 5px 14px rgba(15, 23, 42, .2))',
      font: '700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      letterSpacing: '.02em',
      cursor: 'pointer',
      userSelect: 'none',
    });
    const activate = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpen(binding);
    };
    marker.addEventListener('click', activate);
    marker.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
    target.append(marker);
  });
}
