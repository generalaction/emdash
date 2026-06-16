import React from 'react';
import type { IslandBlock as IslandBlockType } from '../../blocks/block-types';
import type { ChatSlots } from '../chat-transcript';

type IslandBlockProps = {
  block: IslandBlockType;
  slots?: ChatSlots;
  /** Called with the measured pixel height once the element renders. */
  onMeasured?: (blockId: string, height: number) => void;
};

// ── Plain fallback renderers ──────────────────────────────────────────────────

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

function renderRuleFallback(): React.ReactElement {
  return <hr className="chat-rule" />;
}

function renderImageFallback(raw: string): React.ReactElement {
  return <img src={raw} alt="" className="chat-island-image" />;
}

function renderMathFallback(raw: string): React.ReactElement {
  return (
    <div className="chat-island chat-island--fixed" aria-label="Math block">
      <pre>{raw}</pre>
    </div>
  );
}

function renderMermaidFallback(): React.ReactElement {
  return (
    <div className="chat-island chat-island--fixed" aria-label="Diagram placeholder">
      <span style={{ color: '#9ca3af', fontSize: 12 }}>Diagram (mermaid)</span>
    </div>
  );
}

// ── IslandBlock component ─────────────────────────────────────────────────────

export function IslandBlock({ block, slots, onMeasured }: IslandBlockProps): React.ReactElement {
  // Try slot first
  const slotRenderer = slots?.renderIsland?.[block.islandType];
  if (slotRenderer) {
    return (
      <div
        className="chat-island"
        ref={(el) => {
          if (el && onMeasured) {
            onMeasured(block.id, el.getBoundingClientRect().height);
          }
        }}
      >
        {slotRenderer(block)}
      </div>
    );
  }

  // Plain fallbacks
  let content: React.ReactNode;
  switch (block.islandType) {
    case 'table':
      content = renderTableFallback(block.raw);
      break;
    case 'math':
      content = renderMathFallback(block.raw);
      break;
    case 'mermaid':
      content = renderMermaidFallback();
      break;
    case 'image':
      content = renderImageFallback(block.raw);
      break;
    case 'rule':
      return renderRuleFallback();
  }

  return (
    <div
      className="chat-island"
      ref={(el) => {
        if (el && onMeasured) {
          onMeasured(block.id, el.getBoundingClientRect().height);
        }
      }}
    >
      {content}
    </div>
  );
}
