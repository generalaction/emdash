import { describe, expect, it } from 'vitest';
import { durationToMs, msToDuration } from './duration';

describe('durationToMs', () => {
  it('converts minutes to ms', () => {
    expect(durationToMs(5, 'minutes')).toBe(5 * 60 * 1000);
  });

  it('converts hours to ms', () => {
    expect(durationToMs(2, 'hours')).toBe(2 * 60 * 60 * 1000);
  });

  it('converts days to ms', () => {
    expect(durationToMs(3, 'days')).toBe(3 * 24 * 60 * 60 * 1000);
  });
});

describe('msToDuration', () => {
  it('picks days when ms divides evenly by a day', () => {
    expect(msToDuration(24 * 60 * 60 * 1000)).toEqual({ value: 1, unit: 'days' });
    expect(msToDuration(7 * 24 * 60 * 60 * 1000)).toEqual({ value: 7, unit: 'days' });
  });

  it('falls back to hours when not a whole number of days', () => {
    expect(msToDuration(2 * 60 * 60 * 1000)).toEqual({ value: 2, unit: 'hours' });
    expect(msToDuration(36 * 60 * 60 * 1000)).toEqual({ value: 36, unit: 'hours' });
  });

  it('falls back to minutes when not a whole number of hours', () => {
    expect(msToDuration(90 * 60 * 1000)).toEqual({ value: 90, unit: 'minutes' });
  });

  it('uses minutes for very short durations', () => {
    expect(msToDuration(60 * 1000)).toEqual({ value: 1, unit: 'minutes' });
  });
});
