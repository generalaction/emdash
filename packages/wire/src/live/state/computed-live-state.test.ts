import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputedLiveState } from './computed-live-state';

describe('ComputedLiveState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes lazily and suppresses structurally identical updates', async () => {
    const compute = vi.fn(async () => ({ count: 1 }));
    const computed = new ComputedLiveState({ compute });

    expect(compute).not.toHaveBeenCalled();
    const source = await computed.prepare();
    expect(compute).toHaveBeenCalledTimes(1);
    expect(await source.snapshot()).toMatchObject({ sequence: 0, data: { count: 1 } });

    const cursor = await computed.refresh();
    expect(cursor.sequence).toBe(0);
    computed.dispose();
  });

  it('shares concurrent initial preparation', async () => {
    const gate = deferred<{ count: number }>();
    const compute = vi.fn(() => gate.promise);
    const computed = new ComputedLiveState({ compute });

    const first = computed.prepare();
    const second = computed.prepare();
    gate.resolve({ count: 1 });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(compute).toHaveBeenCalledOnce();
    computed.dispose();
  });

  it('defers unobserved invalidation until the next prepare', async () => {
    let count = 0;
    const compute = vi.fn(async () => ({ count: ++count }));
    const computed = new ComputedLiveState({ compute });

    await computed.prepare();
    computed.invalidate();
    await Promise.resolve();
    expect(compute).toHaveBeenCalledTimes(1);

    const source = await computed.prepare();
    expect(compute).toHaveBeenCalledTimes(2);
    expect(await source.snapshot()).toMatchObject({ data: { count: 2 } });
    computed.dispose();
  });

  it('refreshes an observed invalidation after the debounce', async () => {
    vi.useFakeTimers();
    let count = 0;
    const compute = vi.fn(async () => ({ count: ++count }));
    const computed = new ComputedLiveState({ compute, debounceMs: 20 });
    const source = await computed.prepare();
    const unsubscribe = source.subscribe(() => {});

    computed.invalidate();
    await vi.advanceTimersByTimeAsync(19);
    expect(compute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(compute).toHaveBeenCalledTimes(2);

    unsubscribe();
    computed.dispose();
  });

  it('runs a trailing computation when invalidated during a refresh', async () => {
    const gate = deferred<{ count: number }>();
    const compute = vi
      .fn<() => Promise<{ count: number }>>()
      .mockResolvedValueOnce({ count: 0 })
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValueOnce({ count: 2 });
    const computed = new ComputedLiveState({ compute });
    const source = await computed.prepare();
    const unsubscribe = source.subscribe(() => {});

    const refresh = computed.refresh();
    computed.invalidate();
    gate.resolve({ count: 1 });
    await refresh;
    await vi.waitFor(() => expect(compute).toHaveBeenCalledTimes(3));
    expect(await source.snapshot()).toMatchObject({ data: { count: 2 } });

    unsubscribe();
    computed.dispose();
  });

  it('retains the last successful value after a failed refresh', async () => {
    const onError = vi.fn();
    const compute = vi
      .fn<() => Promise<{ count: number }>>()
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('boom'));
    const computed = new ComputedLiveState({ compute, onError });
    const source = await computed.prepare();

    await expect(computed.refresh()).rejects.toThrow('boom');
    expect(await source.snapshot()).toMatchObject({ data: { count: 1 } });
    expect(onError).not.toHaveBeenCalled();
    computed.dispose();
  });

  it('tags changed refreshes with a mutation id', async () => {
    let count = 0;
    const computed = new ComputedLiveState({ compute: async () => ({ count: ++count }) });
    const source = await computed.prepare();
    const updates: unknown[] = [];
    const unsubscribe = source.subscribe((update) => updates.push(update));

    await computed.refresh({ mutationId: 'mutation-1' });
    expect(updates).toMatchObject([{ mutationIds: ['mutation-1'] }]);

    unsubscribe();
    computed.dispose();
  });

  it('does not publish a computation that finishes after disposal', async () => {
    const gate = deferred<{ count: number }>();
    const computed = new ComputedLiveState({ compute: () => gate.promise });
    const prepare = computed.prepare();

    computed.dispose();
    gate.resolve({ count: 1 });
    await expect(prepare).rejects.toThrow('disposed');
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
