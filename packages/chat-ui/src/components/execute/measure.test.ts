/**
 * execute height parity — CSS var must match the metrics constant,
 * and measureExecute must always return the header-only height.
 */

import { describe, expect, it } from 'vitest';
import { ROW_GAP } from '../../core/metrics';
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
  it('running — header only', () => {
    expect(measureExecute(makeItem())).toBe(EXEC_ROW_H + ROW_GAP);
  });

  it('done with duration — header only', () => {
    expect(measureExecute(makeItem({ status: 'done', durationMs: 2000 }))).toBe(
      EXEC_ROW_H + ROW_GAP
    );
  });

  it('done without duration — header only', () => {
    expect(measureExecute(makeItem({ status: 'done' }))).toBe(EXEC_ROW_H + ROW_GAP);
  });

  it('error — header only', () => {
    expect(measureExecute(makeItem({ status: 'error' }))).toBe(EXEC_ROW_H + ROW_GAP);
  });
});
