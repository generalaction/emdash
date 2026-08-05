import { describe, expect, it } from 'vitest';
import { getNextCycleIndex } from '@renderer/lib/find/cycle-index';

describe('getNextCycleIndex', () => {
  it('cycles forward and backward, wrapping at both ends', () => {
    expect(getNextCycleIndex(3, -1, 'next')).toBe(0);
    expect(getNextCycleIndex(3, -1, 'prev')).toBe(2);
    expect(getNextCycleIndex(3, 0, 'next')).toBe(1);
    expect(getNextCycleIndex(3, 0, 'prev')).toBe(2);
    expect(getNextCycleIndex(3, 2, 'next')).toBe(0);
  });

  it('returns -1 for an empty list', () => {
    expect(getNextCycleIndex(0, -1, 'next')).toBe(-1);
  });
});
