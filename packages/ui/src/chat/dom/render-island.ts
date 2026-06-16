/**
 * render-island — imperative DOM rendering for IslandLaidOut.
 *
 * Dispatches to the slot if one is registered; otherwise uses a built-in
 * fallback (table / rule / image / generic pre).
 *
 * The returned `dispose` must be called before the row node is recycled/removed
 * so that slot-managed React roots / observers / subscriptions are torn down.
 *
 * `onMeasured` is called with the actual rendered height so LayoutStore can
 * correct the initial estimate (measure-once write-back pattern).
 */

import type { Block } from '../blocks/block-types';
import type { IslandLaidOut } from '../layout/layout-types';
import type { ChatSlots } from '../slots';
import { applyMountResult } from '../slots';
import { el } from './dom-utils';
import style from './render-island.module.css';

export type RenderIslandResult = {
  node: HTMLElement;
  dispose: () => void;
};

// ── Built-in fallbacks ────────────────────────────────────────────────────────

function renderTableFallback(raw: string): HTMLElement {
  const rows = raw
    .split('\n')
    .filter((r) => r.trim() && !/^[-| ]+$/.test(r))
    .map((r) =>
      r
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c !== '')
    );
  const [header, ...body] = rows;
  const table = el('table', { className: style['pchat-table'] });
  if (header && header.length > 0) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const cell of header) {
      const th = document.createElement('th');
      th.textContent = cell;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
  }
  if (body.length > 0) {
    const tbody = document.createElement('tbody');
    for (const row of body) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }
  return table;
}

function renderRuleFallback(): HTMLElement {
  return el('hr', {
    style: {
      border: 'none',
      borderTop: '1px solid var(--chat-border, #e2e8f0)',
      margin: '0',
    },
  });
}

// ── Main function ─────────────────────────────────────────────────────────────

export function renderIsland(
  block: IslandLaidOut,
  rawBlock: Block & { tier: 'island' },
  slots?: ChatSlots,
  onMeasured?: (blockId: string, height: number) => void
): RenderIslandResult {
  const wrapper = el('div', {
    className: `${style['pblock']} ${style['pisland']}`,
    style: {
      top: `${block.top}px`,
      left: '0',
      right: '0',
    },
  });

  let unmount: () => void = () => {};

  const slotFn =
    slots?.renderIsland?.[block.islandType as keyof NonNullable<ChatSlots['renderIsland']>];

  if (slotFn) {
    unmount = applyMountResult(wrapper, slotFn(rawBlock));
  } else {
    switch (block.islandType) {
      case 'table':
        wrapper.appendChild(renderTableFallback(block.raw));
        break;
      case 'rule':
        wrapper.appendChild(renderRuleFallback());
        break;
      case 'image': {
        const img = el('img', {
          attrs: { src: block.raw, alt: '' },
          style: { maxWidth: '100%' },
        });
        wrapper.appendChild(img);
        break;
      }
      default: {
        const fixed = el('div', { className: style['pisland--fixed'] });
        const pre = el('pre', {
          style: { margin: '0', padding: '8px' },
          children: [block.raw],
        });
        fixed.appendChild(pre);
        wrapper.appendChild(fixed);
        break;
      }
    }
  }

  // Measure-once write-back: schedule after the element is in the DOM
  if (onMeasured) {
    requestAnimationFrame(() => {
      const h = wrapper.getBoundingClientRect().height;
      if (h > 0) onMeasured(block.id, h);
    });
  }

  return { node: wrapper, dispose: unmount };
}
