import type {
  AnnotatedElementInfo,
  AnnotationPickerMessage,
  AnnotationRect,
  AnnotationTrackedRect,
} from './browser-annotation-types';

/**
 * Prefix for console messages used as the back-channel from the sandboxed
 * webview page to the renderer. The webview has no preload bridge (stripped
 * for security), so the picker script reports events via console.log and the
 * renderer listens to the webview's console-message event.
 */
export const ANNOTATION_CONSOLE_MARKER = '__EMDASH_ANNOTATION__:';

export type AnnotationPickerCommand =
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'untrack'; token: number }
  | { kind: 'clear-tracked' }
  | { kind: 'request-rects' };

export type AnnotationPickerScriptOptions = {
  channelId: string;
};

const PICKER_BOOTSTRAP = `(() => {
  'use strict';
  const MARKER = ${JSON.stringify(ANNOTATION_CONSOLE_MARKER)};
  const CHANNEL_ID = __CHANNEL_ID__;
  const KEY = '__emdashAnnotationPicker';
  if (!window[KEY]) {
    const emit = console.log.bind(console);
    const post = (payload) => {
      try {
        emit(MARKER + JSON.stringify({ ...payload, channelId: CHANNEL_ID }));
      } catch {}
    };
    const tracked = new Map();
    let nextToken = 1;
    let active = false;
    let hoverTarget = null;
    let box = null;
    let cursorStyle = null;
    let rafPending = false;

    const escapePart = (value) =>
      window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '_');

    const selectorFor = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        if (node.id) {
          parts.unshift('#' + escapePart(node.id));
          break;
        }
        const testId = node.getAttribute('data-testid');
        let part = node.tagName.toLowerCase();
        if (testId) {
          parts.unshift(part + '[data-testid="' + testId + '"]');
          break;
        }
        const classes = Array.from(node.classList).slice(0, 2);
        if (classes.length) part += '.' + classes.map(escapePart).join('.');
        const parent = node.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(
            (child) => child.tagName === node.tagName
          );
          if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };

    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };

    const fiberInfo = (startFiber) => {
      let component = null;
      let source = null;
      let node = startFiber;
      let depth = 0;
      while (node && depth < 50 && (!component || !source)) {
        if (!source && node._debugSource && node._debugSource.fileName) {
          source = node._debugSource.fileName + ':' + node._debugSource.lineNumber;
        }
        if (!component && typeof node.type === 'function') {
          const name = node.type.displayName || node.type.name || '';
          // Skip minified one-letter names from production builds — useless context.
          if (name.length >= 2 && /^[A-Z]/.test(name)) component = name;
        }
        node = node.return;
        depth++;
      }
      return { component, source };
    };

    const reactInfo = (el) => {
      let node = el;
      while (node) {
        for (const key in node) {
          if (key.startsWith('__reactFiber$')) {
            try {
              return fiberInfo(node[key]);
            } catch {
              return { component: null, source: null };
            }
          }
        }
        node = node.parentElement;
      }
      return { component: null, source: null };
    };

    const STYLE_PROPS = [
      'display',
      'position',
      'color',
      'background-color',
      'font-size',
      'font-weight',
      'padding',
      'margin',
      'border',
      'border-radius',
      'gap',
      'opacity',
    ];
    const STYLE_DEFAULTS = ['', 'none', 'normal', 'auto', '0px', '1', 'rgba(0, 0, 0, 0)'];

    const stylesOf = (el) => {
      const out = {};
      try {
        const computed = getComputedStyle(el);
        for (const prop of STYLE_PROPS) {
          const value = computed.getPropertyValue(prop);
          if (!STYLE_DEFAULTS.includes(value) && !value.startsWith('0px none')) out[prop] = value;
        }
      } catch {}
      return out;
    };

    const describe = (el) => {
      const react = reactInfo(el);
      return {
        selector: selectorFor(el),
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: Array.from(el.classList).slice(0, 8),
        testId: el.getAttribute('data-testid'),
        role: el.getAttribute('role'),
        text: (el.innerText || el.getAttribute('aria-label') || '')
          .trim()
          .replace(/\\s+/g, ' ')
          .slice(0, 160),
        html: el.outerHTML.length > 600 ? el.outerHTML.slice(0, 600) + '...' : el.outerHTML,
        rect: rectOf(el),
        component: react.component,
        source: react.source,
        styles: stylesOf(el),
      };
    };

    const ensureBox = () => {
      if (box) return;
      box = document.createElement('div');
      box.style.cssText =
        'position:fixed;z-index:2147483647;pointer-events:none;display:none;' +
        'border:1.5px solid #3b82f6;background:rgba(59,130,246,0.12);border-radius:2px;';
      document.documentElement.appendChild(box);
    };

    const hideBox = () => {
      if (box) box.style.display = 'none';
      hoverTarget = null;
    };

    const positionBox = (el) => {
      if (!box) return;
      const r = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = r.x + 'px';
      box.style.top = r.y + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
    };

    const emitRects = () => {
      rafPending = false;
      if (!tracked.size) return;
      const rects = [];
      tracked.forEach((el, token) => {
        rects.push({ token, attached: el.isConnected, rect: el.isConnected ? rectOf(el) : null });
      });
      post({ type: 'rects', rects });
    };

    const scheduleRects = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(emitRects);
    };

    const onMove = (event) => {
      if (!active) return;
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === box) return;
      hoverTarget = el;
      positionBox(el);
    };

    const swallow = (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onClick = (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopPropagation();
      const el =
        hoverTarget || document.elementFromPoint(event.clientX, event.clientY) || event.target;
      if (!el || el.nodeType !== 1) return;
      const token = nextToken++;
      tracked.set(token, el);
      post({ type: 'picked', token, element: describe(el) });
      stop(false);
    };

    const onKey = (event) => {
      if (!active || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      stop(true);
    };

    const start = () => {
      if (active) return;
      active = true;
      ensureBox();
      if (!cursorStyle) {
        cursorStyle = document.createElement('style');
        cursorStyle.textContent = '*, *::before, *::after { cursor: crosshair !important; }';
      }
      document.documentElement.appendChild(cursorStyle);
      post({ type: 'mode', active: true });
    };

    const stop = (cancelled) => {
      if (!active) return;
      active = false;
      hideBox();
      if (cursorStyle && cursorStyle.parentNode) cursorStyle.parentNode.removeChild(cursorStyle);
      post({ type: 'mode', active: false, cancelled: !!cancelled });
    };

    window[KEY] = {
      start,
      stop: () => stop(true),
      untrack: (token) => {
        tracked.delete(token);
      },
      clearTracked: () => {
        tracked.clear();
      },
      requestRects: scheduleRects,
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('mouseup', swallow, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', scheduleRects, true);
    window.addEventListener('resize', scheduleRects, true);
  }
  __COMMAND__;
  return true;
})();`;

export function buildAnnotationPickerScript(
  command: AnnotationPickerCommand,
  options: AnnotationPickerScriptOptions
): string {
  // Callback form: avoids `$`-pattern interpretation in the replacement string.
  return PICKER_BOOTSTRAP.replace('__CHANNEL_ID__', () =>
    JSON.stringify(options.channelId)
  ).replace('__COMMAND__', () => pickerCommandCall(command));
}

function pickerCommandCall(command: AnnotationPickerCommand): string {
  const api = "window['__emdashAnnotationPicker']";
  switch (command.kind) {
    case 'start':
      return `${api}.start()`;
    case 'stop':
      return `${api}.stop()`;
    case 'untrack':
      return `${api}.untrack(${Math.floor(command.token)})`;
    case 'clear-tracked':
      return `${api}.clearTracked()`;
    case 'request-rects':
      return `${api}.requestRects()`;
  }
}

export function parseAnnotationMessage(
  message: string,
  options: AnnotationPickerScriptOptions
): AnnotationPickerMessage | null {
  if (!message.startsWith(ANNOTATION_CONSOLE_MARKER)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.slice(ANNOTATION_CONSOLE_MARKER.length));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.channelId !== options.channelId) return null;
  if (parsed.type === 'mode' && typeof parsed.active === 'boolean') {
    return {
      type: 'mode',
      active: parsed.active,
      cancelled: typeof parsed.cancelled === 'boolean' ? parsed.cancelled : undefined,
    };
  }
  if (parsed.type === 'picked' && typeof parsed.token === 'number') {
    const element = parseElementInfo(parsed.element);
    if (!element) return null;
    return { type: 'picked', token: parsed.token, element };
  }
  if (parsed.type === 'rects' && Array.isArray(parsed.rects)) {
    const rects: AnnotationTrackedRect[] = [];
    for (const entry of parsed.rects) {
      if (!isRecord(entry) || typeof entry.token !== 'number') continue;
      rects.push({
        token: entry.token,
        attached: entry.attached === true,
        rect: parseRect(entry.rect),
      });
    }
    return { type: 'rects', rects };
  }
  return null;
}

function parseElementInfo(value: unknown): AnnotatedElementInfo | null {
  if (!isRecord(value)) return null;
  const rect = parseRect(value.rect);
  if (typeof value.selector !== 'string' || typeof value.tag !== 'string' || !rect) return null;
  return {
    selector: value.selector,
    tag: value.tag,
    id: typeof value.id === 'string' && value.id ? value.id : null,
    classes: Array.isArray(value.classes)
      ? value.classes.filter((cls): cls is string => typeof cls === 'string')
      : [],
    testId: typeof value.testId === 'string' && value.testId ? value.testId : null,
    role: typeof value.role === 'string' && value.role ? value.role : null,
    text: typeof value.text === 'string' ? value.text : '',
    html: typeof value.html === 'string' ? value.html : '',
    rect,
    component: typeof value.component === 'string' && value.component ? value.component : null,
    source: typeof value.source === 'string' && value.source ? value.source : null,
    styles: parseStyles(value.styles),
  };
}

function parseStyles(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const styles: Record<string, string> = {};
  for (const [prop, styleValue] of Object.entries(value)) {
    if (typeof styleValue === 'string') styles[prop] = styleValue;
  }
  return styles;
}

function parseRect(value: unknown): AnnotationRect | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null;
  }
  return { x, y, width, height };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
