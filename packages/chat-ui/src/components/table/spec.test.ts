/**
 * Table spec parity tests.
 *
 * Guard two invariants:
 *
 * 1. TABLE_ROW_H matches the CSS: line-height(20) + padding-top(6) + padding-bottom(6) = 32.
 *    (cell borders are collapsed and are NOT part of TABLE_ROW_H)
 *
 * 2. layoutTable uses the corrected border formula: a border-collapse table with N rows
 *    draws N+1 horizontal grid lines, so height = N*TABLE_ROW_H + (N+1)*TABLE_BORDER.
 *    The old formula (+1 border only) undercounted by (N-1)*TABLE_BORDER.
 */

import { describe, expect, it } from 'vitest';
import { reserveHeight } from '../../core/layout/reserve-height';
import { layoutTable } from './layout';
import { TABLE_BORDER, TABLE_MIN_COL_W, TABLE_ROW_H } from './metrics';
import { tableSpec } from './spec';

const BLOCK_ID = 'msg1#0';

function makeBlock(colCount: number, rowCount: number) {
  return {
    kind: 'table' as const,
    tier: 'table' as const,
    id: BLOCK_ID,
    header: Array.from({ length: colCount }, (_, i) => `H${i + 1}`),
    rows: Array.from({ length: rowCount }, (_, r) =>
      Array.from({ length: colCount }, (__, c) => `r${r + 1}c${c + 1}`)
    ),
  };
}

/** Canonical expected height for a table with the given total row count. */
function expectedHeight(rowCount: number): number {
  return reserveHeight({
    content: rowCount * TABLE_ROW_H,
    border: TABLE_BORDER,
    borderLines: rowCount + 1,
  });
}

describe('TABLE_ROW_H parity', () => {
  it('equals CSS line-height(20) + padding-top(6) + padding-bottom(6)', () => {
    expect(TABLE_ROW_H).toBe(32);
  });

  it('is exposed through tableSpec.metrics', () => {
    expect(tableSpec.metrics.rowHeight).toBe(TABLE_ROW_H);
  });
});

describe('layoutTable — height formula (corrected border-collapse counting)', () => {
  it('header-only table: 1 row * ROW_H + 2 border lines', () => {
    const block = makeBlock(2, 0);
    const result = layoutTable(block, 0, 600);
    // rowCount=1 → borderLines=2
    expect(result.height).toBe(expectedHeight(1));
    expect(result.height).toBe(1 * TABLE_ROW_H + 2 * TABLE_BORDER);
  });

  it('header + 4 data rows: 5 rows * ROW_H + 6 border lines', () => {
    const block = makeBlock(3, 4);
    const result = layoutTable(block, 0, 600);
    // rowCount=5 → borderLines=6
    expect(result.height).toBe(expectedHeight(5));
    expect(result.height).toBe(5 * TABLE_ROW_H + 6 * TABLE_BORDER);
  });

  it('border lines scale with row count (not a constant +1)', () => {
    const small = layoutTable(makeBlock(2, 1), 0, 600); // 2 rows → 3 border lines
    const large = layoutTable(makeBlock(2, 3), 0, 600); // 4 rows → 5 border lines
    // Height difference must account for 2 extra rows AND 2 extra border lines
    expect(large.height - small.height).toBe(2 * TABLE_ROW_H + 2 * TABLE_BORDER);
  });

  it('sets the correct top offset', () => {
    const block = makeBlock(2, 2);
    const result = layoutTable(block, 100, 600);
    expect(result.top).toBe(100);
  });
});

describe('layoutTable — column clamping', () => {
  it('distributes columns evenly when container is wide', () => {
    const block = makeBlock(4, 1);
    const contentWidth = 800;
    const result = layoutTable(block, 0, contentWidth);
    // target = floor(800/4) = 200, colW = max(80, 200) = 200
    expect(result.colWidths).toEqual([200, 200, 200, 200]);
    expect(result.tableWidth).toBe(800);
  });

  it('clamps columns to TABLE_MIN_COL_W when container is narrow', () => {
    const block = makeBlock(8, 1);
    const contentWidth = 400; // 400/8 = 50 < 80 → clamp to 80
    const result = layoutTable(block, 0, contentWidth);
    expect(result.colWidths.every((w) => w === TABLE_MIN_COL_W)).toBe(true);
    // tableWidth (8*80=640) exceeds contentWidth (400) → triggers horizontal scroll
    expect(result.tableWidth).toBeGreaterThan(contentWidth);
  });

  it('handles a single-column table', () => {
    const block = makeBlock(1, 2);
    const result = layoutTable(block, 0, 300);
    expect(result.colWidths).toHaveLength(1);
    expect(result.colWidths[0]).toBeGreaterThanOrEqual(TABLE_MIN_COL_W);
  });
});
