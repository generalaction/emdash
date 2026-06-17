/**
 * execute height parity — CSS var must match the metrics constant,
 * and measureExecute must always return the content-only height.
 * Row.tsx adds 2 * ROW_PAD_Y['execute'] for the wrapper padding.
 */

import { describe, expect, it } from 'vitest';
import type { ChatExecute } from '../../model';
import { execCssVars } from './css-vars';
import { measureExecute } from './measure';
import { EXEC_ROW_H } from './metrics';

// ── CSS var parity ─────────────────────────────────────────────────────────────

describe('execCssVars() parity', () => {
  it('--chat-exec-row-h matches EXEC_ROW_H', () => {
    expect(execCssVars()['--chat-exec-row-h']).toBe(`${EXEC_ROW_H}px`);
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

describe('measureExecute()', () => {
  it('running — content height only', () => {
    expect(measureExecute(makeItem())).toBe(EXEC_ROW_H);
  });

  it('done with duration — content height only', () => {
    expect(measureExecute(makeItem({ status: 'done', durationMs: 2000 }))).toBe(EXEC_ROW_H);
  });

  it('done without duration — content height only', () => {
    expect(measureExecute(makeItem({ status: 'done' }))).toBe(EXEC_ROW_H);
  });

  it('error — content height only', () => {
    expect(measureExecute(makeItem({ status: 'error' }))).toBe(EXEC_ROW_H);
  });
});
