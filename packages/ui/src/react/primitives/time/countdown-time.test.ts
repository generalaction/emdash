import { describe, expect, it } from 'vitest';
import { formatCountdown } from './countdown-time';

describe('formatCountdown', () => {
  const now = 1_800_000_000_000;
  it.each([
    [30_000, '<1m'],
    [59 * 60_000, '59m'],
    [60 * 60_000, '1h'],
    [89 * 60_000, '1h 29m'],
    [24 * 60 * 60_000, '1d'],
    [164 * 60 * 60_000, '6d 20h'],
  ])('formats %i milliseconds until reset as %s', (duration, expected) => {
    expect(formatCountdown(now + duration, now)).toBe(expected);
  });

  it('marks elapsed resets as pending without assuming the allowance has refilled', () => {
    expect(formatCountdown(now, now)).toBeNull();
    expect(formatCountdown(now - 60_000, now)).toBeNull();
  });
});
