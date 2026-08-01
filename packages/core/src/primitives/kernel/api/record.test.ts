import { describe, expect, test } from 'vitest';
import { canTransition, isTerminalStatus, operationStatuses, terminalStatuses } from './record';

describe('operation status machine', () => {
  test('recognizes terminal statuses', () => {
    expect(terminalStatuses).toEqual([
      'succeeded',
      'failed',
      'rejected',
      'cancelled',
      'superseded',
    ]);

    for (const status of operationStatuses) {
      expect(isTerminalStatus(status)).toBe(terminalStatuses.includes(status as never));
    }
  });

  test('allows running to superseded', () => {
    expect(canTransition('running', 'superseded')).toBe(true);
  });

  test('allows running to pending for retry, crash reset, and shutdown', () => {
    expect(canTransition('running', 'pending')).toBe(true);
  });

  test('keeps terminal statuses immutable', () => {
    for (const from of terminalStatuses) {
      for (const to of operationStatuses) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });
});
