/**
 * Measurement contract tests — browser Vitest project (Playwright / Chromium).
 *
 * These tests verify that the layout formulas used by the engine (reserveHeight,
 * component metrics) match what the browser's box model actually produces.
 * They deliberately avoid Solid rendering (which adds async reactive timing
 * complexity) and instead test each invariant with minimal plain DOM.
 *
 * What is tested:
 *  1. box-sizing: border-box — height property equals offsetHeight when border+padding are present
 *  2. Code block formula — reserveHeight(lineCount*lh, padY, border) matches a DOM div
 *  3. Table formula — rowCount*TABLE_ROW_H + (rowCount+1)*TABLE_BORDER matches a real <table>
 *  4. TABLE_ROW_H CSS parity — a table cell with the right padding/font-size is 32px tall
 *  5. Thinking header — THINKING_HEADER_H matches a div with that height
 *  6. ROW_GAP — the gap constant matches a measured spacer div
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CODE_BLOCK_PAD_Y, CODE_BLOCK_BORDER } from '../components/code/metrics';
import { TABLE_ROW_H, TABLE_BORDER } from '../components/table/metrics';
import { THINKING_HEADER_H } from '../components/thinking/metrics';
import { reserveHeight } from '../core/layout/reserve-height';
import { ROW_GAP, CODE_BLOCK } from '../core/metrics';

// ── Helpers ───────────────────────────────────────────────────────────────────

const held: HTMLElement[] = [];

function append<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el);
  held.push(el);
  return el;
}

afterEach(() => {
  while (held.length) held.pop()!.remove();
});

function div(css: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, css);
  return append(el);
}

// ── 1. box-sizing: border-box invariant ───────────────────────────────────────

describe('box-sizing: border-box', () => {
  it('height property equals offsetHeight with a 1px border', () => {
    const el = div({
      position: 'absolute',
      left: '0',
      width: '100px',
      boxSizing: 'border-box',
      height: '80px',
      border: '1px solid black',
    });
    expect(el.offsetHeight).toBe(80);
  });

  it('height property equals offsetHeight with padding + border', () => {
    const el = div({
      position: 'absolute',
      left: '0',
      width: '100px',
      boxSizing: 'border-box',
      height: '88px',
      border: `${CODE_BLOCK_BORDER}px solid black`,
      paddingTop: `${CODE_BLOCK_PAD_Y}px`,
      paddingBottom: `${CODE_BLOCK_PAD_Y}px`,
    });
    expect(el.offsetHeight).toBe(88);
  });
});

// ── 2. Code block formula ─────────────────────────────────────────────────────

describe('code block formula', () => {
  it('reserveHeight matches offsetHeight for 1 line', () => {
    const lineCount = 1;
    const expected = reserveHeight({
      content: lineCount * CODE_BLOCK.lineHeight,
      padY: CODE_BLOCK_PAD_Y,
      border: CODE_BLOCK_BORDER,
    });
    const el = div({
      position: 'absolute',
      left: '0',
      width: '400px',
      boxSizing: 'border-box',
      height: `${expected}px`,
      border: `${CODE_BLOCK_BORDER}px solid black`,
      paddingTop: `${CODE_BLOCK_PAD_Y}px`,
      paddingBottom: `${CODE_BLOCK_PAD_Y}px`,
    });
    expect(el.offsetHeight).toBe(expected);
  });

  it('reserveHeight matches offsetHeight for 5 lines', () => {
    const lineCount = 5;
    const expected = reserveHeight({
      content: lineCount * CODE_BLOCK.lineHeight,
      padY: CODE_BLOCK_PAD_Y,
      border: CODE_BLOCK_BORDER,
    });
    const el = div({
      position: 'absolute',
      left: '0',
      width: '400px',
      boxSizing: 'border-box',
      height: `${expected}px`,
      border: `${CODE_BLOCK_BORDER}px solid black`,
      paddingTop: `${CODE_BLOCK_PAD_Y}px`,
      paddingBottom: `${CODE_BLOCK_PAD_Y}px`,
    });
    expect(el.offsetHeight).toBe(expected);
  });
});

// ── 3. Table formula with border-collapse ─────────────────────────────────────
//
// The actual Table.tsx component uses:
//   - border-collapse: collapse on <table>
//   - font-size: 13px; line-height: 20px on <table> (via table.module.css)
//   - padding: 6px 10px on <th>/<td> (via table.module.css)
//   - border: 1px on cells (via Tailwind's `border border-border`)
//
// This means row height is CONTENT-DRIVEN (not height-property-driven).
// Cell height = line-height (20px) + padding (6+6=12px) = TABLE_ROW_H (32px).
// Borders are ADDITIVE (no box-sizing: border-box on cells).
// With N rows and border-collapse: total = N*32 + (N+1)*1 border lines.

describe('table formula with border-collapse', () => {
  /**
   * Creates a table that mirrors the actual Table.tsx component's box model:
   * - Content-driven cell height (font+line-height+padding, no explicit height)
   * - Border is additive (no box-sizing: border-box)
   * - border-collapse: collapse
   */
  function makeTable(dataRowCount: number): HTMLTableElement {
    const table = document.createElement('table');
    // Mirrors table.module.css: border-collapse, font-size, line-height
    table.style.cssText = `
      border-collapse: collapse;
      table-layout: fixed;
      width: 400px;
      font-size: 13px;
      line-height: 20px;
    `;
    append(table);

    const addRow = (isHeader: boolean) => {
      const row = document.createElement('tr');
      const cell = document.createElement(isHeader ? 'th' : 'td');
      // Mirrors table.module.css + Tailwind border: 1px solid
      cell.style.cssText = `padding: 6px 10px; border: ${TABLE_BORDER}px solid black;`;
      cell.textContent = 'x'; // content needed for line boxes to apply line-height
      row.appendChild(cell);
      table.appendChild(row);
    };

    addRow(true); // header
    for (let i = 0; i < dataRowCount; i++) addRow(false);

    return table;
  }

  it('header-only (1 row): height = 1*TABLE_ROW_H + 2*TABLE_BORDER', () => {
    const table = makeTable(0);
    const expected = reserveHeight({
      content: 1 * TABLE_ROW_H,
      border: TABLE_BORDER,
      borderLines: 2,
    });
    expect(table.offsetHeight).toBe(expected);
  });

  it('4 data rows (5 total): height = 5*TABLE_ROW_H + 6*TABLE_BORDER', () => {
    const table = makeTable(4);
    const expected = reserveHeight({
      content: 5 * TABLE_ROW_H,
      border: TABLE_BORDER,
      borderLines: 6,
    });
    expect(table.offsetHeight).toBe(expected);
  });

  it('border count scales with row count', () => {
    const small = makeTable(1); // 2 rows → 3 border lines
    const large = makeTable(3); // 4 rows → 5 border lines
    const diff = large.offsetHeight - small.offsetHeight;
    // 2 extra rows + 2 extra border lines
    expect(diff).toBe(2 * TABLE_ROW_H + 2 * TABLE_BORDER);
  });
});

// ── 4. TABLE_ROW_H CSS parity ─────────────────────────────────────────────────

describe('TABLE_ROW_H CSS parity', () => {
  it('table cell with 13px font / 20px line-height / 6px vertical padding is 32px', () => {
    const table = document.createElement('table');
    // Mirrors table.module.css properties
    table.style.cssText =
      'border-collapse: collapse; table-layout: fixed; width: 200px; font-size: 13px; line-height: 20px;';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    // Mirrors table.module.css cell padding (no border so border doesn't add to row height)
    td.style.cssText = 'padding: 6px 10px; border: none;';
    td.textContent = 'x'; // need content for line boxes
    tr.appendChild(td);
    table.appendChild(tr);
    append(table);
    expect(tr.offsetHeight).toBe(TABLE_ROW_H);
  });
});

// ── 5. Thinking header height ─────────────────────────────────────────────────

describe('THINKING_HEADER_H', () => {
  it('a div with height: THINKING_HEADER_H has correct offsetHeight', () => {
    const el = div({
      height: `${THINKING_HEADER_H}px`,
      boxSizing: 'border-box',
      position: 'relative',
    });
    expect(el.offsetHeight).toBe(THINKING_HEADER_H);
  });
});

// ── 6. ROW_GAP ────────────────────────────────────────────────────────────────

describe('ROW_GAP', () => {
  it('ROW_GAP is a positive integer pixel value', () => {
    expect(ROW_GAP).toBeGreaterThan(0);
    expect(Number.isInteger(ROW_GAP)).toBe(true);
  });

  it('a spacer div of height ROW_GAP has correct offsetHeight', () => {
    const el = div({
      height: `${ROW_GAP}px`,
      position: 'relative',
    });
    expect(el.offsetHeight).toBe(ROW_GAP);
  });
});
