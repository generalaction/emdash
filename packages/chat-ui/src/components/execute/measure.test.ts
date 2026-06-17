/**
 * execute height parity — CSS vars must match metrics constants,
 * and measureExecute must produce the expected heights for each state.
 */

import { describe, expect, it } from 'vitest';
import { ROW_GAP } from '../../core/metrics';
import type { ChatExecute } from '../../model';
import { execCssVars } from './css-vars';
import { measureExecute } from './measure';
import { EXEC_LINE_H, EXEC_MAX_LINES, EXEC_PAD_Y, EXEC_ROW_H } from './metrics';

// ── CSS var parity ─────────────────────────────────────────────────────────────

describe('execCssVars() parity', () => {
  it('--chat-exec-row-h matches EXEC_ROW_H', () => {
    expect(execCssVars()['--chat-exec-row-h']).toBe(`${EXEC_ROW_H}px`);
  });

  it('--chat-exec-line-h matches EXEC_LINE_H', () => {
    expect(execCssVars()['--chat-exec-line-h']).toBe(`${EXEC_LINE_H}px`);
  });

  it('--chat-exec-pad-y matches EXEC_PAD_Y', () => {
    expect(execCssVars()['--chat-exec-pad-y']).toBe(`${EXEC_PAD_Y}px`);
  });

  it('--chat-exec-max-h matches EXEC_MAX_LINES * EXEC_LINE_H + 2 * EXEC_PAD_Y', () => {
    expect(execCssVars()['--chat-exec-max-h']).toBe(
      `${EXEC_MAX_LINES * EXEC_LINE_H + 2 * EXEC_PAD_Y}px`
    );
  });
});

// ── Height cases ───────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ChatExecute> = {}): ChatExecute {
  return {
    kind: 'execute',
    id: 'test',
    command: 'ls -a',
    status: 'running',
    startedAt: Date.now(),
    ...overrides,
  };
}

const notExpanded = (_id: string) => false;
const expanded = (_id: string) => true;

describe('measureExecute()', () => {
  it('collapsed + running — header only', () => {
    expect(measureExecute(makeItem(), notExpanded)).toBe(EXEC_ROW_H + ROW_GAP);
  });

  it('collapsed + done — header only', () => {
    expect(measureExecute(makeItem({ status: 'done', durationMs: 2000 }), notExpanded)).toBe(
      EXEC_ROW_H + ROW_GAP
    );
  });

  it('collapsed + error — header only', () => {
    expect(measureExecute(makeItem({ status: 'error' }), notExpanded)).toBe(EXEC_ROW_H + ROW_GAP);
  });

  it('expanded + no output — 1 line placeholder', () => {
    expect(measureExecute(makeItem(), expanded)).toBe(
      EXEC_ROW_H + 1 * EXEC_LINE_H + 2 * EXEC_PAD_Y + ROW_GAP
    );
  });

  it('expanded + 3-line output — scales by line count', () => {
    const output = 'line1\nline2\nline3';
    expect(measureExecute(makeItem({ output }), expanded)).toBe(
      EXEC_ROW_H + 3 * EXEC_LINE_H + 2 * EXEC_PAD_Y + ROW_GAP
    );
  });

  it('expanded + output exceeding EXEC_MAX_LINES — clamped', () => {
    const lines = Array.from({ length: EXEC_MAX_LINES + 5 }, (_, i) => `line${i}`).join('\n');
    expect(measureExecute(makeItem({ output: lines }), expanded)).toBe(
      EXEC_ROW_H + EXEC_MAX_LINES * EXEC_LINE_H + 2 * EXEC_PAD_Y + ROW_GAP
    );
  });

  it('expanded height is larger than collapsed height', () => {
    const collapsedH = EXEC_ROW_H + ROW_GAP;
    const expandedH = EXEC_ROW_H + 3 * EXEC_LINE_H + 2 * EXEC_PAD_Y + ROW_GAP;
    expect(expandedH).toBeGreaterThan(collapsedH);
  });
});
