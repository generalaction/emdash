/**
 * execute height — executeDef must always return execRowH for any item state.
 */

import { describe, expect, it } from 'vitest';
import type { ChatExecute } from '../../model';
import { EXEC_ROW_H, measureExecute } from './measure';

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
