/**
 * render-tool — imperative DOM rendering for ChatToolCall rows.
 *
 * Builds the .pchat-tool row. Collapse toggle is handled by event delegation
 * on the scroll container (data-collapse-id attribute) rather than inline
 * listeners, so there's nothing to dispose here.
 */

import type { ChatToolCall } from '../../model';
import { el } from './dom-utils';
import style from '../projected.module.css';

const STATUS_ICON: Record<string, string> = {
  running: '⋯',
  done: '✓',
  error: '✕',
};

export function renderTool(item: ChatToolCall): HTMLElement {
  const badge = el('span', {
    className: `${style['pchat-tool__badge']} ${style[`pchat-tool__badge--${item.status}`]}`,
    attrs: { 'aria-label': item.status },
    children: [STATUS_ICON[item.status] ?? '?'],
  });

  const name = el('span', {
    className: style['pchat-tool__name'],
    children: [item.name],
  });

  const wrapper = el('div', { className: style['pchat-tool'] });
  wrapper.appendChild(badge);
  wrapper.appendChild(name);

  if (item.inputSummary) {
    const summary = el('span', {
      className: style['pchat-tool__summary'],
      children: [item.inputSummary],
    });
    wrapper.appendChild(summary);
  }

  if (item.detail) {
    const toggle = el('button', {
      className: style['pchat-collapse-toggle'],
      attrs: {
        type: 'button',
        'aria-expanded': 'true',
        'data-collapse-id': item.id,
      },
      children: ['▾ detail'],
    });
    wrapper.appendChild(toggle);

    const detailEl = el('div', { className: style['pchat-tool__detail'] });
    const pre = el('pre', {
      style: { margin: '0', fontSize: '11px', whiteSpace: 'pre-wrap' },
      children: [item.detail],
    });
    detailEl.appendChild(pre);
    wrapper.appendChild(detailEl);
  }

  return wrapper;
}
