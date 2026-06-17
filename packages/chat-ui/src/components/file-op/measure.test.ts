/**
 * file-op height parity — CSS vars must match metrics constants,
 * and measureFileOp must produce the expected content-only heights for each state.
 * Row.tsx adds 2 * ROW_PAD_Y['file-op'] for the wrapper padding.
 */

import { describe, expect, it } from 'vitest';
import type { ChatFileOpToolCall } from '../../model';
import { fileOpCssVars } from './css-vars';
import { measureFileOp } from './measure';
import {
  FILEOP_FADE_H,
  FILEOP_LINE_H,
  FILEOP_PAD_Y,
  FILEOP_ROW_H,
  FILEOP_WINDOW_H,
} from './metrics';

// ── CSS var parity ─────────────────────────────────────────────────────────────

describe('fileOpCssVars() parity', () => {
  it('--chat-fileop-row-h matches FILEOP_ROW_H', () => {
    expect(fileOpCssVars()['--chat-fileop-row-h']).toBe(`${FILEOP_ROW_H}px`);
  });

  it('--chat-fileop-line-h matches FILEOP_LINE_H', () => {
    expect(fileOpCssVars()['--chat-fileop-line-h']).toBe(`${FILEOP_LINE_H}px`);
  });

  it('--chat-fileop-window-h matches FILEOP_WINDOW_H', () => {
    expect(fileOpCssVars()['--chat-fileop-window-h']).toBe(`${FILEOP_WINDOW_H}px`);
  });

  it('--chat-fileop-fade-h matches FILEOP_FADE_H', () => {
    expect(fileOpCssVars()['--chat-fileop-fade-h']).toBe(`${FILEOP_FADE_H}px`);
  });

  it('--chat-fileop-pad-y matches FILEOP_PAD_Y', () => {
    expect(fileOpCssVars()['--chat-fileop-pad-y']).toBe(`${FILEOP_PAD_Y}px`);
  });
});

// ── Height cases ───────────────────────────────────────────────────────────────

function makeItem(
  overrides: Partial<ChatFileOpToolCall> & { ops?: ChatFileOpToolCall['ops'] }
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
    expect(measureFileOp(makeItem({ ops: [] }), notExpanded)).toBe(FILEOP_ROW_H);
  });

  it('inline (1 op, running) — FILEOP_ROW_H', () => {
    expect(measureFileOp(makeItem({ ops: [{ path: '/a.ts' }] }), notExpanded)).toBe(FILEOP_ROW_H);
  });

  it('inline (1 op, done) — FILEOP_ROW_H', () => {
    expect(measureFileOp(makeItem({ ops: [{ path: '/a.ts' }], status: 'done' }), notExpanded)).toBe(
      FILEOP_ROW_H
    );
  });

  it('multi (2 ops) collapsed + running — shows preview window', () => {
    expect(
      measureFileOp(makeItem({ ops: [{ path: '/a.ts' }, { path: '/b.ts' }] }), notExpanded)
    ).toBe(FILEOP_ROW_H + FILEOP_WINDOW_H);
  });

  it('multi (2 ops) collapsed + done — header only', () => {
    expect(
      measureFileOp(
        makeItem({ ops: [{ path: '/a.ts' }, { path: '/b.ts' }], status: 'done' }),
        notExpanded
      )
    ).toBe(FILEOP_ROW_H);
  });

  it('multi (2 ops) expanded — FILEOP_ROW_H + 2×FILEOP_LINE_H + 2×FILEOP_PAD_Y', () => {
    expect(measureFileOp(makeItem({ ops: [{ path: '/a.ts' }, { path: '/b.ts' }] }), expanded)).toBe(
      FILEOP_ROW_H + 2 * FILEOP_LINE_H + 2 * FILEOP_PAD_Y
    );
  });

  it('multi (3 ops) expanded — scales by op count', () => {
    expect(
      measureFileOp(
        makeItem({ ops: [{ path: '/a.ts' }, { path: '/b.ts' }, { path: '/c.ts' }] }),
        expanded
      )
    ).toBe(FILEOP_ROW_H + 3 * FILEOP_LINE_H + 2 * FILEOP_PAD_Y);
  });

  it('multi expanded height is larger than preview height for 4+ files', () => {
    const expandedH = FILEOP_ROW_H + 4 * FILEOP_LINE_H + 2 * FILEOP_PAD_Y;
    const previewH = FILEOP_ROW_H + FILEOP_WINDOW_H;
    expect(expandedH).toBeGreaterThan(previewH);
  });
});
