/**
 * render-code — imperative DOM rendering for CodeLaidOut.
 *
 * Returns the root .pblock element containing positioned .pcode-line rows.
 * If a slot is provided, delegates to it via applyMountResult and returns
 * a dispose callback to unmount the slot when the row is recycled.
 *
 * ## Non-blocking highlighting
 *
 * The block always paints plain text first so the render path stays cheap.
 * Highlighting is applied in two steps:
 *
 * 1. Fast-path (cache hit): `peekHighlight` returns a previously computed
 *    result synchronously — `applyHighlight` runs immediately, no flash.
 * 2. Deferred-path (cache miss): tokens are computed on an idle callback;
 *    `applyHighlight` patches the existing line elements in place once done.
 *    Because token splitting never changes monospace geometry, no re-layout or
 *    virtualizer update is needed.
 *
 * `dispose()` cancels any pending idle callback so recycled rows are safe.
 */

import type { Block } from '../blocks/block-types';
import type { HighlightResult } from '../highlight/highlighter';
import { highlightCode, peekHighlight } from '../highlight/highlighter';
import type { CodeLaidOut } from '../layout/layout-types';
import type { ChatSlots } from '../slots';
import { applyMountResult } from '../slots';
import { cancelIdle, el, scheduleIdle } from './dom-utils';
import style from './render-code.module.css';

export type RenderCodeResult = {
  node: HTMLElement;
  dispose: () => void;
};

// ── Highlight applicator ──────────────────────────────────────────────────────

/**
 * Patch `lineEls` with token spans and apply `rootStyle` to `wrapper`.
 *
 * Each plain-text line element is cleared and replaced with one `<span>` per
 * token. This is purely cosmetic — geometry (position/height) is unchanged.
 */
function applyHighlight(
  wrapper: HTMLElement,
  lineEls: HTMLElement[],
  hl: HighlightResult
): void {
  if (hl.rootStyle) {
    // rootStyle is a semicolon-separated list of CSS custom properties
    // e.g. "--shiki-light-bg:#fff;--shiki-dark-bg:#24292e"
    for (const decl of hl.rootStyle.split(';')) {
      const colon = decl.indexOf(':');
      if (colon === -1) continue;
      const prop = decl.slice(0, colon).trim();
      const val = decl.slice(colon + 1).trim();
      if (prop) wrapper.style.setProperty(prop, val);
    }
  }

  for (let i = 0; i < lineEls.length; i++) {
    const lineEl = lineEls[i];
    const tokens = hl.lines[i];
    if (!lineEl || !tokens) continue;

    // Replace text content with token spans.
    while (lineEl.firstChild) lineEl.removeChild(lineEl.firstChild);

    for (const tok of tokens) {
      if (!tok.content) continue;
      if (!tok.htmlStyle) {
        lineEl.appendChild(document.createTextNode(tok.content));
      } else {
        const span = document.createElement('span');
        span.textContent = tok.content;
        for (const [prop, val] of Object.entries(tok.htmlStyle)) {
          span.style.setProperty(prop, val);
        }
        lineEl.appendChild(span);
      }
    }
  }
}

function CodeLine(line: { top: number; text: string }): HTMLElement {
  return el('div', {
    className: style['pcode-line'],
    style: { top: `${line.top}px` },
    children: [line.text],
  });
}

// ── Main render function ──────────────────────────────────────────────────────

export function renderCode(
  block: CodeLaidOut,
  rawBlock: Block & { tier: 'code' },
  slots?: ChatSlots
): RenderCodeResult {
  const wrapper = el('div', {
    className: `${style['pblock']} ${style['pcode-block']}`,
    style: {
      top: `${block.top}px`,
      height: `${block.height}px`,
      left: '0',
      right: '0',
    },
  });

  if (slots?.renderCode) {
    const unmount = applyMountResult(wrapper, slots.renderCode(rawBlock));
    return { node: wrapper, dispose: unmount };
  }

  // Build plain-text lines first — guaranteed cheap, no highlight work yet.
  const lineEls: HTMLElement[] = [];
  for (const line of block.lines) {
    const lineEl = CodeLine(line);
    lineEls.push(lineEl);
    wrapper.appendChild(lineEl);
  }

  // Highlighting — synchronous fast-path on cache hit, deferred otherwise.
  let cancelled = false;
  let idleHandle: number | undefined;

  const cached = peekHighlight(rawBlock.code, block.lang);
  if (cached) {
    applyHighlight(wrapper, lineEls, cached);
  } else if (block.lang) {
    idleHandle = scheduleIdle(() => {
      if (cancelled) return;
      const hl = highlightCode(rawBlock.code, block.lang);
      if (hl && !cancelled) applyHighlight(wrapper, lineEls, hl);
    });
  }

  return {
    node: wrapper,
    dispose: () => {
      cancelled = true;
      if (idleHandle !== undefined) cancelIdle(idleHandle);
    },
  };
}
