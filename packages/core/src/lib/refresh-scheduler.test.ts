import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshScheduler } from './refresh-scheduler';

describe('RefreshScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a burst of invalidations into one refresh after the trailing debounce', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RefreshScheduler({ refresh, debounceMs: 100 });

    scheduler.invalidate();
    await vi.advanceTimersByTimeAsync(80);
    scheduler.invalidate();
    await vi.advanceTimersByTimeAsync(80);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it('runs single-flight: demand during a run coalesces into exactly one follow-up', async () => {
    let resolveRun: () => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        })
    );
    const scheduler = new RefreshScheduler({ refresh, debounceMs: 0 });

    scheduler.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    resolveRun();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);

    resolveRun();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.dispose();
  });

  it('refreshNow bypasses the debounce and subsumes a pending debounced run', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RefreshScheduler({ refresh, debounceMs: 10_000 });

    scheduler.invalidate();
    await scheduler.refreshNow();
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it('refreshNow during an in-flight run resolves only after a fresh run completes', async () => {
    const events: string[] = [];
    let resolveFirst: () => void = () => {};
    let call = 0;
    const refresh = vi.fn(() => {
      call += 1;
      const current = call;
      events.push(`start-${current}`);
      if (current === 1) {
        return new Promise<void>((resolve) => {
          resolveFirst = () => {
            events.push('end-1');
            resolve();
          };
        });
      }
      events.push(`end-${current}`);
      return Promise.resolve();
    });
    const scheduler = new RefreshScheduler({ refresh, debounceMs: 0 });

    scheduler.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    const now = scheduler.refreshNow().then(() => events.push('refreshNow-resolved'));
    await vi.advanceTimersByTimeAsync(0);

    resolveFirst();
    await now;

    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'refreshNow-resolved']);

    scheduler.dispose();
  });

  it('reports refresh errors to onError and keeps the loop alive', async () => {
    const onError = vi.fn();
    const refresh = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const scheduler = new RefreshScheduler({ refresh, debounceMs: 0, onError });

    await scheduler.refreshNow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));

    await scheduler.refreshNow();
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.dispose();
  });

  it('runs periodic revalidation through the same pipeline', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RefreshScheduler({ refresh, debounceMs: 0, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(3_100);
    expect(refresh).toHaveBeenCalledTimes(3);

    scheduler.dispose();
  });

  it('dispose cancels pending runs and ignores later demand', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RefreshScheduler({ refresh, debounceMs: 100, intervalMs: 1_000 });

    scheduler.invalidate();
    scheduler.dispose();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).not.toHaveBeenCalled();

    scheduler.invalidate();
    await expect(scheduler.refreshNow()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
