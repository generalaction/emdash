import { describe, expect, test } from 'vitest';
import { claimModes, COMPATIBLE, modesCompatible, type ClaimMode } from './claim-modes';

const expected: Record<ClaimMode, Record<ClaimMode, boolean>> = {
  'intent-shared': {
    'intent-shared': true,
    'intent-exclusive': true,
    shared: true,
    exclusive: false,
  },
  'intent-exclusive': {
    'intent-shared': true,
    'intent-exclusive': true,
    shared: false,
    exclusive: false,
  },
  shared: {
    'intent-shared': true,
    'intent-exclusive': false,
    shared: true,
    exclusive: false,
  },
  exclusive: {
    'intent-shared': false,
    'intent-exclusive': false,
    shared: false,
    exclusive: false,
  },
};

describe('claim mode compatibility', () => {
  test('matches the golden matrix', () => {
    expect(COMPATIBLE).toEqual(expected);

    for (const held of claimModes) {
      for (const requested of claimModes) {
        expect(modesCompatible(held, requested)).toBe(expected[held][requested]);
      }
    }
  });

  test('is symmetric', () => {
    for (const a of claimModes) {
      for (const b of claimModes) {
        expect(modesCompatible(a, b)).toBe(modesCompatible(b, a));
      }
    }
  });
});
