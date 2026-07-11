import { describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../testing/manual-clock';
import { retry } from './retry';
import { retrySchedules } from './retry-schedule';

describe('retrySchedules', () => {
  it('supports fixed and repeated sequence schedules', () => {
    expect(retrySchedules.fixed(5, 2).delayFor(0)).toBe(5);
    expect(retrySchedules.fixed(5, 2).delayFor(2)).toBeUndefined();

    const sequence = retrySchedules.sequence([1, 2], { repeatLast: true });
    expect(sequence.delayFor(0)).toBe(1);
    expect(sequence.delayFor(1)).toBe(2);
    expect(sequence.delayFor(2)).toBe(2);
  });

  it('supports exponential and deterministic jitter schedules', () => {
    const exponential = retrySchedules.exponential({ initialMs: 10, maxMs: 50 });
    expect(exponential.delayFor(0)).toBe(10);
    expect(exponential.delayFor(3)).toBe(50);

    const jittered = retrySchedules.jitter(retrySchedules.fixed(100, 1), {
      ratio: 0.5,
      random: () => 0,
    });
    expect(jittered.delayFor(0)).toBe(50);
  });
});

describe('retry', () => {
  it('retries retryable failures after scheduled delays', async () => {
    const clock = new ManualClock();
    const operation = vi.fn(async ({ attempt }: { attempt: number }) => {
      if (attempt === 0) throw new Error('first');
      return 'ok';
    });

    const result = retry(({ attempt }) => operation({ attempt }), {
      clock,
      schedule: retrySchedules.fixed(10, 1),
    });

    await Promise.resolve();
    expect(operation).toHaveBeenCalledTimes(1);
    await clock.advanceBy(10);

    await expect(result).resolves.toBe('ok');
    expect(operation).toHaveBeenNthCalledWith(2, { attempt: 1 });
  });

  it('does not retry when the classifier rejects the error', async () => {
    const error = new Error('fatal');
    await expect(
      retry(
        async () => {
          throw error;
        },
        {
          schedule: retrySchedules.fixed(0, 1),
          shouldRetry: () => false,
        }
      )
    ).rejects.toBe(error);
  });

  it('aborts while sleeping between attempts', async () => {
    const clock = new ManualClock();
    const abort = new AbortController();
    const operation = vi.fn(async () => {
      throw new Error('retry');
    });

    const result = retry(operation, {
      clock,
      signal: abort.signal,
      schedule: retrySchedules.fixed(10, 2),
    });

    await Promise.resolve();
    abort.abort(new Error('stop'));

    await expect(result).rejects.toThrow('stop');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
