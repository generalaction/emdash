import type {
  BrowserAnnotationBoundingBox,
  BrowserAnnotationKind,
  BrowserAnnotationTarget,
} from '@shared/browserAnnotations';

export type BrowserAnnotationCaptureResult = BrowserAnnotationTarget;

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isBoundingBox(value: unknown): value is BrowserAnnotationBoundingBox {
  if (!value || typeof value !== 'object') return false;
  const box = value as Record<string, unknown>;
  return (
    numeric(box.x) !== null &&
    numeric(box.y) !== null &&
    numeric(box.width) !== null &&
    numeric(box.height) !== null
  );
}

export function parseBrowserAnnotationCaptureResult(
  value: unknown
): BrowserAnnotationCaptureResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const x = numeric(record.x);
  const y = numeric(record.y);
  const boundingBox = record.boundingBox;
  const url = stringValue(record.url);
  const elementPath = stringValue(record.elementPath);
  const element = stringValue(record.element);

  if (
    (kind !== 'element' && kind !== 'text' && kind !== 'area') ||
    x === null ||
    y === null ||
    !isBoundingBox(boundingBox) ||
    !url ||
    !elementPath ||
    !element
  ) {
    return null;
  }

  return {
    kind,
    url,
    title: stringValue(record.title),
    elementPath,
    element,
    cssClasses: stringValue(record.cssClasses),
    nearbyText: stringValue(record.nearbyText),
    selectedText: stringValue(record.selectedText),
    x,
    y,
    boundingBox,
  };
}

export function withAreaBoundingBox(
  target: BrowserAnnotationCaptureResult,
  boundingBox: BrowserAnnotationBoundingBox
): BrowserAnnotationCaptureResult {
  return {
    ...target,
    kind: 'area',
    x: Math.round(boundingBox.x + boundingBox.width / 2),
    y: Math.round(boundingBox.y + boundingBox.height / 2),
    boundingBox: {
      x: Math.round(boundingBox.x),
      y: Math.round(boundingBox.y),
      width: Math.round(boundingBox.width),
      height: Math.round(boundingBox.height),
    },
  };
}

export function buildBrowserAnnotationCaptureScript(
  x: number,
  y: number,
  fallbackKind: BrowserAnnotationKind = 'element'
): string {
  const safeX = Math.round(Number.isFinite(x) ? x : 0);
  const safeY = Math.round(Number.isFinite(y) ? y : 0);
  const safeKind = fallbackKind === 'area' ? 'area' : fallbackKind === 'text' ? 'text' : 'element';

  return `(() => {
  const pointX = ${safeX};
  const pointY = ${safeY};
  const fallbackKind = ${JSON.stringify(safeKind)};
  const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 500);
  const escapeIdentifier = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  };
  const elementSegment = (element) => {
    const tag = element.tagName.toLowerCase();
    if (element.id) return tag + '#' + escapeIdentifier(element.id);
    const parent = element.parentElement;
    if (!parent) return tag;
    const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
    if (siblings.length <= 1) return tag;
    return tag + ':nth-of-type(' + (siblings.indexOf(element) + 1) + ')';
  };
  const elementPath = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      parts.unshift(elementSegment(current));
      if (current.id) break;
      current = current.parentElement;
    }
    return parts.length ? parts.join(' > ') : 'html';
  };
  const selection = window.getSelection();
  const selectedText = selection && !selection.isCollapsed ? normalizeText(selection.toString()) : '';
  const element = document.elementFromPoint(pointX, pointY) || document.documentElement;
  const rect = element.getBoundingClientRect();
  const classes = element.classList ? Array.from(element.classList).join(' ') : '';
  const nearbyText = normalizeText(selectedText || element.innerText || element.textContent || '');
  return {
    kind: selectedText ? 'text' : fallbackKind,
    url: window.location.href,
    title: document.title || '',
    elementPath: elementPath(element),
    element: element.tagName.toLowerCase(),
    cssClasses: classes,
    nearbyText,
    selectedText,
    x: pointX,
    y: pointY,
    boundingBox: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
})()`;
}

export function buildBrowserAnnotationScrollScript(
  x: number,
  y: number,
  deltaX: number,
  deltaY: number
): string {
  const safeX = Math.round(Number.isFinite(x) ? x : 0);
  const safeY = Math.round(Number.isFinite(y) ? y : 0);
  const safeDeltaX = Math.round(Number.isFinite(deltaX) ? deltaX : 0);
  const safeDeltaY = Math.round(Number.isFinite(deltaY) ? deltaY : 0);

  return `(() => {
  const pointX = ${safeX};
  const pointY = ${safeY};
  const deltaX = ${safeDeltaX};
  const deltaY = ${safeDeltaY};
  const canScroll = (element, axis) => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (axis === 'x') {
      if (!/(auto|scroll|overlay)/.test(style.overflowX)) return false;
      return element.scrollWidth > element.clientWidth;
    }
    if (!/(auto|scroll|overlay)/.test(style.overflowY)) return false;
    return element.scrollHeight > element.clientHeight;
  };
  const scrollableAncestor = (element, axis) => {
    let current = element;
    while (current && current !== document.documentElement) {
      if (canScroll(current, axis)) return current;
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };
  const start = document.elementFromPoint(pointX, pointY) || document.documentElement;
  const targetX = scrollableAncestor(start, 'x');
  const targetY = scrollableAncestor(start, 'y');
  if (deltaX && targetX) targetX.scrollBy({ left: deltaX, behavior: 'auto' });
  if (deltaY && targetY) targetY.scrollBy({ top: deltaY, behavior: 'auto' });
  return true;
})()`;
}
