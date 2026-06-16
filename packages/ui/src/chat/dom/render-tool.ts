/**
 * render-tool — imperative DOM rendering for ChatToolCall rows.
 *
 * Builds the .pchat-tool row. Collapse toggle is handled by event delegation
 * on the scroll container (data-collapse-id attribute) rather than inline
 * listeners, so there's nothing to dispose here.
 */

import type { ChatToolCall, ToolStatus } from '../model';
import { el } from './dom-utils';
import style from './render-tool.module.css';

const STATUS_ICON: Record<string, string> = {
  running: '⋯',
  done: '✓',
  error: '✕',
};

// ── Sub-element builders ──────────────────────────────────────────────────────

function ToolBadge(status: ToolStatus): HTMLElement {
  return el('span', {
    className: `${style['pchat-tool__badge']} ${style[`pchat-tool__badge--${status}`]}`,
    attrs: { 'aria-label': status },
    children: [STATUS_ICON[status] ?? '?'],
  });
}

function ToolName(name: string): HTMLElement {
  return el('span', {
    className: style['pchat-tool__name'],
    children: [name],
  });
}

function ToolSummary(summary: string): HTMLElement {
  return el('span', {
    className: style['pchat-tool__summary'],
    children: [summary],
  });
}

function ToolDetailToggle(id: string): HTMLElement {
  return el('button', {
    className: style['pchat-collapse-toggle'],
    attrs: {
      type: 'button',
      'aria-expanded': 'true',
      'data-collapse-id': id,
    },
    children: ['▾ detail'],
  });
}

function ToolDetail(detail: string): HTMLElement {
  const detailEl = el('div', { className: style['pchat-tool__detail'] });
  const pre = el('pre', {
    style: { margin: '0', fontSize: '11px', whiteSpace: 'pre-wrap' },
    children: [detail],
  });
  detailEl.appendChild(pre);
  return detailEl;
}

// ── Main render function ──────────────────────────────────────────────────────

export function renderTool(item: ChatToolCall): HTMLElement {
  const wrapper = el('div', { className: style['pchat-tool'] });

  wrapper.appendChild(ToolBadge(item.status));
  wrapper.appendChild(ToolName(item.name));

  if (item.inputSummary) {
    wrapper.appendChild(ToolSummary(item.inputSummary));
  }

  if (item.detail) {
    wrapper.appendChild(ToolDetailToggle(item.id));
    wrapper.appendChild(ToolDetail(item.detail));
  }

  return wrapper;
}
