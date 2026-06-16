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

import { THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from '../../metrics';
import type { ChatThinking } from '../../model';
import type { ViewStateStore } from '../../state/view-state-store';
import type { LayoutStore } from '../layout/layout-store';
import { el } from './dom-utils';
import style from '../projected.module.css';

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

  const spinner = el('span', { className: style['pthinking__spinner'] });

  const labelEl = el('span', {
    children: [`Thinking ${formatDurationS(elapsed)}s`],
  });

  const header = el('div', {
    className: style['pthinking__header'],
    attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' },
    children: [spinner, labelEl],
  });

  const windowTextEl = el('div', {
    className: style['pthinking__window-text'],
    children: [item.text],
  });
  // Wrap in the windowed container so content aligns to the bottom.
  const windowEl = el('div', {
    className: style['pthinking__window'],
    children: [windowTextEl],
  });

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

  const chevron = el('span', {
    className: `${style['pthinking__chevron']}${expanded ? ` ${style['pthinking__chevron--expanded']}` : ''}`,
    attrs: { 'aria-hidden': 'true' },
    children: ['›'],
  });

  const header = el('div', {
    className: `${style['pthinking__header']} ${style['pthinking__header--done']}`,
    attrs: {
      role: 'button',
      'aria-expanded': String(expanded),
      'data-collapse-id': item.id,
    },
    children: [`Thought for ${durationS}s`, chevron],
  });

  const totalH = viewState.isCollapsed(item.id)
    ? THINKING_HEADER_H
    : THINKING_HEADER_H +
      2 * THINKING_PAD_Y +
      (layoutStore.measured.get(item.id) ?? THINKING_WINDOW_H);

  const node = el('div', {
    className: style['pthinking'],
    style: {
      position: 'relative',
      height: `${totalH}px`,
    },
    children: [header],
  });

  if (expanded) {
    const bodyEl = el('div', {
      className: style['pthinking__body'],
      style: {
        top: `${THINKING_HEADER_H}px`,
      },
      children: [item.text],
    });
    node.appendChild(bodyEl);

    // Measure-once write-back: schedule after the element is in the DOM.
    requestAnimationFrame(() => {
      const h = bodyEl.getBoundingClientRect().height;
      if (h > 0) onHeightChange(item.id, h);
    });
  }

  return { node, dispose: () => {} };
}
