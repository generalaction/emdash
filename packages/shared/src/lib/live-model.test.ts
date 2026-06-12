import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveModel, type LiveValue } from './live-model';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LiveModel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes lazily on first get and serves the cache afterwards', async () => {
    let computes = 0;
    const model = new LiveModel({ compute: async () => ++computes });

    await expect(model.get()).resolves.toEqual({ value: 1, seq: 1 });
    await expect(model.get()).resolves.toEqual({ value: 1, seq: 1 });
    expect(computes).toBe(1);
    expect(model.getCached()).toEqual({ value: 1, seq: 1 });
  });

  it('only marks dirty on invalidate without subscribers, recomputes on next get', async () => {
    let computes = 0;
    const model = new LiveModel({ compute: async () => ++computes });

    await model.get();
    model.invalidate();
    await vi.runAllTimersAsync();
    expect(computes).toBe(1); // no subscriber: no background recompute

    await expect(model.get()).resolves.toEqual({ value: 2, seq: 2 });
  });

  it('recomputes and pushes on invalidate while subscribed, with debounce coalescing', async () => {
    let computes = 0;
    const model = new LiveModel({ compute: async () => ++computes, debounceMs: 50 });
    const pushed: LiveValue<number>[] = [];

    model.subscribe((update) => pushed.push(update));
    await vi.runAllTimersAsync();
    expect(pushed).toEqual([{ value: 1, seq: 1 }]); // initial compute on first subscribe

    model.invalidate();
    model.invalidate();
    model.invalidate();
    await vi.runAllTimersAsync();

    expect(computes).toBe(2); // three invalidations coalesced
    expect(pushed).toEqual([
      { value: 1, seq: 1 },
      { value: 2, seq: 2 },
    ]);
  });

  it('queues exactly one trailing run when refreshed during an in-flight compute', async () => {
    const gates: Array<ReturnType<typeof deferred<number>>> = [];
    const model = new LiveModel({
      compute: () => {
        const gate = deferred<number>();
        gates.push(gate);
        return gate.promise;
      },
    });

    const first = model.refresh();
    const second = model.refresh();
    const third = model.refresh();
    expect(gates).toHaveLength(1);

    gates[0]!.resolve(10);
    await first;
    await vi.runAllTimersAsync();
    expect(gates).toHaveLength(2);

    gates[1]!.resolve(20);
    await expect(second).resolves.toEqual({ value: 20, seq: 2 });
    await expect(third).resolves.toEqual({ value: 20, seq: 2 });
    await expect(first).resolves.toEqual({ value: 10, seq: 1 });
  });

  it('runs again after a compute that was invalidated mid-flight (subscribed)', async () => {
    const gates: Array<ReturnType<typeof deferred<number>>> = [];
    const model = new LiveModel({
      compute: () => {
        const gate = deferred<number>();
        gates.push(gate);
        return gate.promise;
      },
    });
    const pushed: number[] = [];
    model.subscribe((update) => pushed.push(update.value));
    expect(gates).toHaveLength(1);

    model.invalidate(); // arrives mid-compute
    gates[0]!.resolve(1);
    await vi.runAllTimersAsync();
    expect(gates).toHaveLength(2);

    gates[1]!.resolve(2);
    await vi.runAllTimersAsync();
    expect(pushed).toEqual([1, 2]);
  });

  it('keeps last-good cache and stays dirty after a failed recompute', async () => {
    let fail = false;
    let computes = 0;
    const errors: unknown[] = [];
    const model = new LiveModel({
      compute: async () => {
        computes += 1;
        if (fail) throw new Error('boom');
        return computes;
      },
      onError: (error) => errors.push(error),
    });
    const pushed: number[] = [];
    model.subscribe((update) => pushed.push(update.value));
    await vi.runAllTimersAsync();

    fail = true;
    model.invalidate();
    await vi.runAllTimersAsync();

    expect(errors).toHaveLength(1);
    expect(model.getCached()).toEqual({ value: 1, seq: 1 });
    expect(pushed).toEqual([1]);

    await expect(model.refresh()).rejects.toThrow('boom');

    fail = false;
    await expect(model.get()).resolves.toEqual({ value: 4, seq: 2 }); // dirty: recomputes
  });

  it('revalidates on the configured interval while subscribed', async () => {
    let computes = 0;
    const model = new LiveModel({ compute: async () => ++computes, revalidateIntervalMs: 1_000 });

    const unsubscribe = model.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(computes).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(computes).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(computes).toBe(3);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(computes).toBe(3); // no subscribers: no revalidation
  });

  it('resets the revalidation timer on any recompute', async () => {
    let computes = 0;
    const model = new LiveModel({ compute: async () => ++computes, revalidateIntervalMs: 1_000 });
    model.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(computes).toBe(1);

    await vi.advanceTimersByTimeAsync(900);
    await model.refresh();
    expect(computes).toBe(2);

    await vi.advanceTimersByTimeAsync(900);
    expect(computes).toBe(2); // timer was reset by refresh
    await vi.advanceTimersByTimeAsync(100);
    expect(computes).toBe(3);
  });

  it('rejects get/refresh/subscribe after dispose and stops timers', async () => {
    let computes = 0;
    const model = new LiveModel({ compute: async () => ++computes, revalidateIntervalMs: 1_000 });
    model.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);

    model.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(computes).toBe(1);
    await expect(model.get()).rejects.toThrow('LiveModel disposed');
    expect(() => model.subscribe(() => {})).toThrow('LiveModel disposed');
  });
});
