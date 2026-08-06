import { describe, expect, it } from 'vitest';
import { backoffSchedule } from './backoff';

describe('backoffSchedule', () => {
  it('walks the delay sequence and exhausts past the end', () => {
    const schedule = backoffSchedule({ delaysMs: [100, 250, 500] });

    expect(schedule.delayFor(0)).toBe(100);
    expect(schedule.delayFor(1)).toBe(250);
    expect(schedule.delayFor(2)).toBe(500);
    expect(schedule.delayFor(3)).toBeUndefined();
  });

  it('repeats the final delay when repeatLast is set', () => {
    const schedule = backoffSchedule({ delaysMs: [100, 250], repeatLast: true });

    expect(schedule.delayFor(1)).toBe(250);
    expect(schedule.delayFor(50)).toBe(250);
  });

  it('caps retries at maxRetries even with repeatLast', () => {
    const schedule = backoffSchedule({ delaysMs: [250, 1_000], repeatLast: true, maxRetries: 3 });

    expect(schedule.delayFor(2)).toBe(1_000);
    expect(schedule.delayFor(3)).toBeUndefined();
  });

  it('applies deterministic jitter around each delay', () => {
    const schedule = backoffSchedule({
      delaysMs: [1_000],
      jitter: { ratio: 0.5, random: () => 1 },
    });

    expect(schedule.delayFor(0)).toBe(1_500);
  });
});
