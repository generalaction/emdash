/**
 * file-op height — measureFileOp must produce expected heights for each state.
 */

import { describe, expect, it } from 'vitest';
import type { ChatFileOpToolCall } from '../../model';
import { FILEOP_VARS } from './metrics';
import { measureFileOp } from './measure';

const v = FILEOP_VARS;
const FILEOP_ROW_H = v.rowH;
const FILEOP_LINE_H = v.rowH;
const FILEOP_PAD_Y = v.padY;
const FILEOP_WINDOW_H = v.windowH;

function makeItem(
  overrides: Partial<ChatFileOpToolCall> & { ops?: ChatFileOpToolCall['ops'] },
): ChatFileOpToolCall {
  return {
    kind: 'file-op',
    id: 'test',
    op: 'read',
    status: 'running',
    ops: [],
    ...overrides,
  };
}

const notExpanded = (_id: string) => false;
const expanded = (_id: string) => true;

describe('measureFileOp()', () => {
  it('inline (0 ops, running) — FILEOP_ROW_H', () => {
    expect(measureFileOp(makeItem({ ops: [] }), notExpanded, v)).toBe(FILEOP_ROW_H);
  });

  it('inline (1 op, running) — FILEOP_ROW_H', () => {
    expect(measureFileOp(makeItem({ ops: [{ path: '/a.ts' }] }), notExpanded, v)).toBe(
      FILEOP_ROW_H,
    );
  });

  it('inline (1 op, done) — FILEOP_ROW_H', () => {
    expect(
      measureFileOp(makeItem({ ops: [{ path: '/a.ts' }], status: 'done' }), notExpanded, v),
    ).toBe(FILEOP_ROW_H);
  });

  it('multi (2 ops) collapsed + running — shows preview window', () => {
    expect(
      measureFileOp(makeItem({ ops: [{ path: '/a.ts' }, { path: '/b.ts' }] }), notExpanded, v),
    ).toBe(FILEOP_ROW_H + FILEOP_WINDOW_H);
  });

  it('multi (2 ops) collapsed + done — header only', () => {
    expect(
      measureFileOp(
        makeItem({ ops: [{ path: '/a.ts' }, { path: '/b.ts' }], status: 'done' }),
        notExpanded,
        v,
      ),
    ).toBe(FILEOP_ROW_H);
  });

  it('multi (2 ops) expanded — FILEOP_ROW_H + 2×FILEOP_LINE_H + 2×FILEOP_PAD_Y', () => {
    expect(
      measureFileOp(makeItem({ ops: [{ path: '/a.ts' }, { path: '/b.ts' }] }), expanded, v),
    ).toBe(FILEOP_ROW_H + 2 * FILEOP_LINE_H + 2 * FILEOP_PAD_Y);
  });

  it('multi (3 ops) expanded — scales by op count', () => {
    expect(
      measureFileOp(
        makeItem({ ops: [{ path: '/a.ts' }, { path: '/b.ts' }, { path: '/c.ts' }] }),
        expanded,
        v,
      ),
    ).toBe(FILEOP_ROW_H + 3 * FILEOP_LINE_H + 2 * FILEOP_PAD_Y);
  });

  it('multi expanded height is larger than preview height for 4+ files', () => {
    const expandedH = FILEOP_ROW_H + 4 * FILEOP_LINE_H + 2 * FILEOP_PAD_Y;
    const previewH = FILEOP_ROW_H + FILEOP_WINDOW_H;
    expect(expandedH).toBeGreaterThan(previewH);
  });
});
