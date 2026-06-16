/**
 * render-thinking — imperative DOM rendering for ChatThinking rows.
 *
 * Two states:
 *
 * Active (`status === 'thinking'`):
 *   Header: animated spinner + "Thinking {duration}s" label.
 *   Window: fixed-height bottom-aligned text box, top-fade gradient,
 *           updated by the per-row reaction in imperative-chat.
 *
 * Done (`status === 'done'`):
 *   Header: "Thought for {duration}s ›" with chevron, data-collapse-id so the
 *           engine's click delegation handles toggle for free.
 *   Body (expanded only): absolute pre-wrap text, measured once via
 *         requestAnimationFrame write-back (same pattern as render-island).
 *
 * The engine reads `windowEl` / `labelEl` refs on the returned node to patch
 * live content without remounting. On the active→done transition the engine
 * discards the row and remounts it in done form.
 *
 * Returns { node, dispose } — dispose tears down nothing here (reactions and
 * timers are owned by the engine); it exists for structural consistency.
 */

import { THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from '../metrics';
import type { ChatThinking } from '../model';
import type { ViewStateStore } from '../state/view-state-store';
import type { LayoutStore } from '../layout/layout-store';
import { el } from './dom-utils';
import style from './render-thinking.module.css';

export type RenderThinkingResult = {
  node: HTMLElement;
  dispose: () => void;
  /**
   * Live refs for the active-state ticker/reaction to patch directly.
   * Undefined when the item is rendered in done state.
   */
  live?: {
    labelEl: HTMLElement;
    windowTextEl: HTMLElement;
  };
};

// ── Duration helpers ──────────────────────────────────────────────────────────

function formatDurationS(ms: number): string {
  return String(Math.floor(ms / 1000));
}

// ── Sub-element builders ──────────────────────────────────────────────────────

function ThinkingSpinner(): HTMLElement {
  return el('span', { className: style['pthinking__spinner'] });
}

function ThinkingLabel(elapsed: number): HTMLElement {
  return el('span', { children: [`Thinking ${formatDurationS(elapsed)}s`] });
}

function ThinkingHeader(children: (HTMLElement | string)[]): HTMLElement {
  return el('div', {
    className: style['pthinking__header'],
    attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' },
    children,
  });
}

function ThinkingWindow(text: string): { windowEl: HTMLElement; windowTextEl: HTMLElement } {
  const windowTextEl = el('div', {
    className: style['pthinking__window-text'],
    children: [text],
  });
  const windowEl = el('div', {
    className: style['pthinking__window'],
    children: [windowTextEl],
  });
  return { windowEl, windowTextEl };
}

function ThinkingChevron(expanded: boolean): HTMLElement {
  return el('span', {
    className: `${style['pthinking__chevron']}${expanded ? ` ${style['pthinking__chevron--expanded']}` : ''}`,
    attrs: { 'aria-hidden': 'true' },
    children: ['›'],
  });
}

function ThinkingDoneHeader(durationS: string, expanded: boolean, id: string): HTMLElement {
  const chevron = ThinkingChevron(expanded);
  return el('div', {
    className: `${style['pthinking__header']} ${style['pthinking__header--done']}`,
    attrs: {
      role: 'button',
      'aria-expanded': String(expanded),
      'data-collapse-id': id,
    },
    children: [`Thought for ${durationS}s`, chevron],
  });
}

function ThinkingBody(text: string, top: number): HTMLElement {
  return el('div', {
    className: style['pthinking__body'],
    style: { top: `${top}px` },
    children: [text],
  });
}

// ── Main function ─────────────────────────────────────────────────────────────

export function renderThinking(
  item: ChatThinking,
  layoutStore: LayoutStore,
  viewState: ViewStateStore,
  onHeightChange: (id: string, height: number) => void
): RenderThinkingResult {
  if (item.status === 'thinking') {
    return renderActiveThinking(item);
  }
  return renderDoneThinking(item, layoutStore, viewState, onHeightChange);
}

// ── Active state ──────────────────────────────────────────────────────────────

function renderActiveThinking(item: ChatThinking): RenderThinkingResult {
  const elapsed = Date.now() - item.startedAt;

  const labelEl = ThinkingLabel(elapsed);
  const header = ThinkingHeader([ThinkingSpinner(), labelEl]);
  const { windowEl, windowTextEl } = ThinkingWindow(item.text ?? '');

  const node = el('div', {
    className: style['pthinking'],
    style: {
      position: 'relative',
      height: `${THINKING_HEADER_H + THINKING_WINDOW_H}px`,
    },
    children: [header, windowEl],
  });

  return { node, dispose: () => {}, live: { labelEl, windowTextEl } };
}

// ── Done state ────────────────────────────────────────────────────────────────

function renderDoneThinking(
  item: ChatThinking,
  layoutStore: LayoutStore,
  viewState: ViewStateStore,
  onHeightChange: (id: string, height: number) => void
): RenderThinkingResult {
  const durationS = item.durationMs !== undefined ? formatDurationS(item.durationMs) : '?';
  const expanded = !viewState.isCollapsed(item.id);

  const header = ThinkingDoneHeader(durationS, expanded, item.id);

  const totalH = viewState.isCollapsed(item.id)
    ? THINKING_HEADER_H
    : THINKING_HEADER_H +
      2 * THINKING_PAD_Y +
      (layoutStore.measured.get(item.id) ?? THINKING_WINDOW_H);

  const node = el('div', {
    className: style['pthinking'],
    style: { position: 'relative', height: `${totalH}px` },
    children: [header],
  });

  if (expanded) {
    const bodyEl = ThinkingBody(item.text ?? '', THINKING_HEADER_H);
    node.appendChild(bodyEl);

    // Measure-once write-back: schedule after the element is in the DOM.
    requestAnimationFrame(() => {
      const h = bodyEl.getBoundingClientRect().height;
      if (h > 0) onHeightChange(item.id, h);
    });
  }

  return { node, dispose: () => {} };
}
