/**
 * island-spec — colocated measure + render for IslandBlock.
 *
 * Measure: uses DOM-measured height if available (written back via setMeasured),
 *          falls back to `fonts.islandFixedHeight` for first-render estimate.
 * Render:  dispatches to ChatSlots.renderIsland or plain fallback.
 */

import React from 'react';
import type { BlockMeasureCtx, BlockRenderCtx, BlockSpec } from '../block-spec';
import type { IslandBlock } from '../block-types';

// ── Measure ──────────────────────────────────────────────────────────────────

function measureIsland(block: IslandBlock, ctx: BlockMeasureCtx): number {
  if (ctx.collapsed) return 0;
  // Use DOM-measured value if available; ResizeObserver will correct if needed.
  return ctx.measured ?? ctx.fonts.islandFixedHeight;
}

// ── Render fallbacks ──────────────────────────────────────────────────────────

function renderTableFallback(raw: string): React.ReactElement {
  const rows = raw.split('\n').map((r) => r.split(' | '));
  const [headerRow, ...bodyRows] = rows;
  return (
    <table className="chat-table">
      {headerRow && (
        <thead>
          <tr>
            {headerRow.map((cell, i) => (
              <th key={i}>{cell}</th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {bodyRows.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderIsland(block: IslandBlock, ctx: BlockRenderCtx): React.ReactNode {
  if (ctx.collapsed) return null;

  // Lightweight placeholder during active scroll — single empty div preserves
  // the layout height without building the full island subtree every frame.
  if (ctx.isScrolling) {
    return <div className="chat-island chat-island--placeholder" aria-hidden="true" />;
  }

  const { slots, onMeasured } = ctx;

  const refCallback = (el: HTMLDivElement | null) => {
    if (el && onMeasured) {
      onMeasured(block.id, el.getBoundingClientRect().height);
    }
  };

  const slotRenderer = slots?.renderIsland?.[block.islandType];
  if (slotRenderer) {
    return (
      <div className="chat-island" ref={refCallback}>
        {slotRenderer(block)}
      </div>
    );
  }

  if (block.islandType === 'rule') {
    return <hr className="chat-rule" />;
  }

  let content: React.ReactNode;
  switch (block.islandType) {
    case 'table':
      content = renderTableFallback(block.raw);
      break;
    case 'math':
      content = (
        <div className="chat-island--fixed" aria-label="Math block">
          <pre>{block.raw}</pre>
        </div>
      );
      break;
    case 'mermaid':
      content = (
        <div className="chat-island--fixed" aria-label="Diagram placeholder">
          <span style={{ color: '#9ca3af', fontSize: 12 }}>Diagram (mermaid)</span>
        </div>
      );
      break;
    case 'image':
      content = <img src={block.raw} alt="" className="chat-island-image" />;
      break;
    default:
      content = null;
  }

  return (
    <div className="chat-island" ref={refCallback}>
      {content}
    </div>
  );
}

// ── Export spec ───────────────────────────────────────────────────────────────

export const islandSpec: BlockSpec<IslandBlock> = {
  measure: measureIsland,
  render: renderIsland,
};
