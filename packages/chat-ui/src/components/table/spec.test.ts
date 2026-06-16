/**
 * Table spec parity tests.
 *
 * These guard the invariant that TABLE_ROW_H matches the CSS
 * (line-height:20 + padding:6+6 = 32), and that layoutTable produces the
 * correct geometry for both narrow and wide containers.
 */

import { describe, expect, it } from 'vitest';
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

describe('TABLE_ROW_H parity', () => {
  it('equals CSS line-height(20) + padding-top(6) + padding-bottom(6)', () => {
    expect(TABLE_ROW_H).toBe(32);
  });

  it('is exposed through tableSpec.metrics', () => {
    expect(tableSpec.metrics.rowHeight).toBe(TABLE_ROW_H);
  });
});

describe('layoutTable — height formula', () => {
  it('calculates height correctly: (1 + rowCount) * TABLE_ROW_H + TABLE_BORDER', () => {
    const block = makeBlock(3, 4);
    const result = layoutTable(block, 0, 600);
    expect(result.height).toBe((1 + 4) * TABLE_ROW_H + TABLE_BORDER);
  });

  it('counts header as 1 row', () => {
    const block = makeBlock(2, 0);
    const result = layoutTable(block, 0, 600);
    expect(result.height).toBe(1 * TABLE_ROW_H + TABLE_BORDER);
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
