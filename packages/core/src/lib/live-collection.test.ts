import { err, ok, type Result } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveCollection, type CollectionUpdate } from './live-collection';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshot<K, V>(entries: Array<[K, V]>, sequence: number) {
  return { kind: 'snapshot', entries, generation: expect.any(Number), sequence };
}

function cachedSnapshot<K, V>(entries: Array<[K, V]>, sequence: number) {
  return { entries, generation: expect.any(Number), sequence };
}

function okSnapshot<K, V>(entries: Array<[K, V]>, sequence: number) {
  return { success: true, data: cachedSnapshot(entries, sequence) };
}

function delta<K, V>(
  ops: Array<{ op: 'put'; key: K; value: V } | { op: 'del'; key: K }>,
  sequence: number
) {
  return { kind: 'delta', generation: expect.any(Number), ops, sequence };
}

describe('LiveCollection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers a synchronous snapshot before deltas, even during an in-flight compute', async () => {
    const gate = deferred<Result<Array<[string, number]>>>();
    const collection = new LiveCollection<string, number>({ compute: () => gate.promise });

    const refresh = collection.refresh();
    expect(collection.put('local', 1)).toBe(1);

    const updates: Array<CollectionUpdate<string, number>> = [];
    collection.subscribe((update) => updates.push(update));
    expect(updates).toEqual([snapshot([['local', 1]], 1)]);

    expect(collection.put('after-subscribe', 2)).toBe(2);
    gate.resolve(ok([['remote', 3]]));
    await refresh;

    expect(updates).toEqual([
      snapshot([['local', 1]], 1),
      delta([{ op: 'put', key: 'after-subscribe', value: 2 }], 2),
      delta(
        [
          { op: 'del', key: 'local' },
          { op: 'del', key: 'after-subscribe' },
          { op: 'put', key: 'remote', value: 3 },
        ],
        3
      ),
    ]);
  });

  it('does not advance sequence for subscriber or read baselines', async () => {
    const collection = new LiveCollection<string, number>();
    const updates: Array<CollectionUpdate<string, number>> = [];

    const unsubscribe = collection.subscribe((update) => updates.push(update));
    expect(updates).toEqual([snapshot([], 0)]);
    await expect(collection.get()).resolves.toEqual(okSnapshot([], 0));
    await expect(collection.refresh()).resolves.toEqual(okSnapshot([], 0));
    expect(collection.getCached()).toEqual(cachedSnapshot([], 0));

    unsubscribe();
    collection.subscribe((update) => updates.push(update));
    expect(updates).toEqual([snapshot([], 0), snapshot([], 0)]);
  });

  it('emits derived compute results as diffs against the current mergebox', async () => {
    let entries: Array<[string, { id: number; value: string }]> = [
      ['a', { id: 1, value: 'one' }],
      ['b', { id: 2, value: 'two' }],
    ];
    const collection = new LiveCollection<string, { id: number; value: string }>({
      compute: async () => ok(entries),
    });
    const updates: Array<CollectionUpdate<string, { id: number; value: string }>> = [];

    collection.subscribe((update) => updates.push(update));
    await vi.runAllTimersAsync();
    expect(updates).toEqual([
      snapshot([], 0),
      delta(
        [
          { op: 'put', key: 'a', value: { id: 1, value: 'one' } },
          { op: 'put', key: 'b', value: { id: 2, value: 'two' } },
        ],
        1
      ),
    ]);

    entries = [
      ['b', { id: 2, value: 'changed' }],
      ['c', { id: 3, value: 'three' }],
    ];
    collection.invalidate();
    await vi.runAllTimersAsync();
    expect(updates).toEqual([
      snapshot([], 0),
      delta(
        [
          { op: 'put', key: 'a', value: { id: 1, value: 'one' } },
          { op: 'put', key: 'b', value: { id: 2, value: 'two' } },
        ],
        1
      ),
      delta(
        [
          { op: 'del', key: 'a' },
          { op: 'put', key: 'b', value: { id: 2, value: 'changed' } },
          { op: 'put', key: 'c', value: { id: 3, value: 'three' } },
        ],
        2
      ),
    ]);

    collection.invalidate();
    await vi.runAllTimersAsync();
    expect(updates).toHaveLength(3);
    expect(collection.getCached()).toEqual(
      cachedSnapshot(
        [
          ['b', { id: 2, value: 'changed' }],
          ['c', { id: 3, value: 'three' }],
        ],
        2
      )
    );
  });

  it('uses a custom isEqual for puts and recompute diffs', async () => {
    let entries: Array<[string, { id: number; noise: number }]> = [['a', { id: 1, noise: 1 }]];
    const collection = new LiveCollection<string, { id: number; noise: number }>({
      compute: async () => ok(entries),
      isEqual: (a, b) => a.id === b.id,
    });
    const updates: Array<CollectionUpdate<string, { id: number; noise: number }>> = [];
    collection.subscribe((update) => updates.push(update));
    await vi.runAllTimersAsync();

    entries = [['a', { id: 1, noise: 2 }]];
    collection.invalidate();
    await vi.runAllTimersAsync();
    expect(updates).toHaveLength(2);

    expect(collection.put('a', { id: 1, noise: 3 })).toBe(1);
    expect(updates).toHaveLength(2);
  });

  it('emits driven mutations with monotonic sequences and reset snapshots', () => {
    const collection = new LiveCollection<string, number>();
    const updates: Array<CollectionUpdate<string, number>> = [];
    collection.subscribe((update) => updates.push(update));

    expect(collection.apply([{ op: 'put', key: 'a', value: 1 }])).toBe(1);
    expect(collection.put('b', 2)).toBe(2);
    expect(collection.delete('a')).toBe(3);
    expect(collection.reset([['z', 9]])).toBe(4);
    expect(collection.reset([['z', 9]])).toBe(5);

    expect(updates).toEqual([
      snapshot([], 0),
      delta([{ op: 'put', key: 'a', value: 1 }], 1),
      delta([{ op: 'put', key: 'b', value: 2 }], 2),
      delta([{ op: 'del', key: 'a' }], 3),
      snapshot([['z', 9]], 4),
      snapshot([['z', 9]], 5),
    ]);
  });

  it('normalizes batches and suppresses net-zero mutations', () => {
    const collection = new LiveCollection<string, number>();
    const updates: Array<CollectionUpdate<string, number>> = [];
    collection.subscribe((update) => updates.push(update));

    expect(collection.apply([])).toBe(0);
    expect(collection.delete('missing')).toBe(0);
    expect(
      collection.apply([
        { op: 'put', key: 'k', value: 1 },
        { op: 'del', key: 'k' },
      ])
    ).toBe(0);
    expect(
      collection.apply([
        { op: 'put', key: 'k', value: 1 },
        { op: 'put', key: 'k', value: 2 },
      ])
    ).toBe(1);
    expect(collection.put('k', 2)).toBe(1);
    expect(
      collection.apply([
        { op: 'del', key: 'k' },
        { op: 'put', key: 'k', value: 2 },
      ])
    ).toBe(1);

    expect(updates).toEqual([snapshot([], 0), delta([{ op: 'put', key: 'k', value: 2 }], 1)]);
  });

  it('preserves the original value reference for isEqual no-op puts', () => {
    const original = { id: 1, label: 'original' };
    const equalReplacement = { id: 1, label: 'replacement' };
    const collection = new LiveCollection<string, { id: number; label: string }>({
      isEqual: (a, b) => a.id === b.id,
    });
    collection.put('k', original);

    expect(collection.put('k', equalReplacement)).toBe(1);
    expect(collection.getCached().entries).toEqual([['k', original]]);
    expect(collection.getCached().entries[0]![1]).toBe(original);
  });

  it('serves the current snapshot in driven mode', async () => {
    const collection = new LiveCollection<string, number>();
    collection.put('a', 1);
    collection.invalidate();

    await expect(collection.get()).resolves.toEqual(okSnapshot([['a', 1]], 1));
    await expect(collection.refresh()).resolves.toEqual(okSnapshot([['a', 1]], 1));
  });

  it('demand-gates invalidation until get or subscribe', async () => {
    let computes = 0;
    const collection = new LiveCollection<string, number>({
      compute: async () => ok([['value', ++computes]]),
    });

    collection.invalidate();
    await vi.runAllTimersAsync();
    expect(computes).toBe(0);

    await expect(collection.get()).resolves.toEqual(okSnapshot([['value', 1]], 1));
    collection.invalidate();
    await vi.runAllTimersAsync();
    expect(computes).toBe(1);

    const updates: Array<CollectionUpdate<string, number>> = [];
    collection.subscribe((update) => updates.push(update));
    expect(updates).toEqual([snapshot([['value', 1]], 1)]);
    await vi.runAllTimersAsync();

    expect(computes).toBe(2);
    expect(updates).toEqual([
      snapshot([['value', 1]], 1),
      delta([{ op: 'put', key: 'value', value: 2 }], 2),
    ]);
  });

  it('queues exactly one trailing recompute during an in-flight refresh', async () => {
    const gates: Array<ReturnType<typeof deferred<Result<Array<[string, number]>>>>> = [];
    const collection = new LiveCollection<string, number>({
      compute: () => {
        const gate = deferred<Result<Array<[string, number]>>>();
        gates.push(gate);
        return gate.promise;
      },
    });

    const first = collection.refresh();
    const second = collection.refresh();
    const third = collection.refresh();
    expect(gates).toHaveLength(1);

    gates[0]!.resolve(ok([['a', 1]]));
    await first;
    await vi.runAllTimersAsync();
    expect(gates).toHaveLength(2);

    gates[1]!.resolve(ok([['a', 2]]));
    await expect(second).resolves.toEqual(okSnapshot([['a', 2]], 2));
    await expect(third).resolves.toEqual(okSnapshot([['a', 2]], 2));
    await expect(first).resolves.toEqual(okSnapshot([['a', 1]], 1));
  });

  it('keeps last-good entries after expected failures and returns them as errors', async () => {
    let fail = false;
    let computes = 0;
    const errors: string[] = [];
    const collection = new LiveCollection<string, number, string>({
      compute: async () => {
        computes += 1;
        if (fail) return err('boom');
        return ok([['value', computes]]);
      },
      onError: (error) => errors.push(error),
    });
    const updates: Array<CollectionUpdate<string, number>> = [];
    collection.subscribe((update) => updates.push(update));
    await vi.runAllTimersAsync();

    fail = true;
    collection.invalidate();
    await vi.runAllTimersAsync();

    expect(errors).toHaveLength(1);
    expect(collection.getCached()).toEqual(cachedSnapshot([['value', 1]], 1));
    expect(updates).toEqual([snapshot([], 0), delta([{ op: 'put', key: 'value', value: 1 }], 1)]);
    await expect(collection.refresh()).resolves.toEqual(err('boom'));

    fail = false;
    await expect(collection.get()).resolves.toEqual(okSnapshot([['value', 4]], 2));
  });

  it('rejects direct refresh when compute throws unexpectedly', async () => {
    const unexpected = new Error('boom');
    const collection = new LiveCollection<string, number>({
      compute: async () => {
        throw unexpected;
      },
    });

    await expect(collection.refresh()).rejects.toBe(unexpected);
  });

  it('reconciles apply calls that occur during an in-flight refresh', async () => {
    const gate = deferred<Result<Array<[string, number]>>>();
    const collection = new LiveCollection<string, number>({ compute: () => gate.promise });

    const refresh = collection.refresh();
    expect(collection.put('optimistic', 1)).toBe(1);
    gate.resolve(ok([['truth', 2]]));

    await expect(refresh).resolves.toEqual(okSnapshot([['truth', 2]], 2));
    expect(collection.getCached()).toEqual(cachedSnapshot([['truth', 2]], 2));
  });

  it('unsubscribes if the initial snapshot callback throws', () => {
    const collection = new LiveCollection<string, number>();

    expect(() =>
      collection.subscribe(() => {
        throw new Error('subscriber failed');
      })
    ).toThrow('subscriber failed');
    expect(collection.subscriberCount).toBe(0);
    expect(collection.put('a', 1)).toBe(1);
  });

  it('rejects get/refresh/subscribe after dispose and makes mutations no-ops', async () => {
    let computes = 0;
    const collection = new LiveCollection<string, number>({
      compute: async () => ok([['value', ++computes]]),
      revalidateIntervalMs: 1_000,
    });
    const unsubscribe = collection.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(computes).toBe(1);

    collection.dispose();
    unsubscribe();
    unsubscribe();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(collection.get()).rejects.toThrow('LiveCollection disposed');
    await expect(collection.refresh()).rejects.toThrow('LiveCollection disposed');
    expect(() => collection.subscribe(() => {})).toThrow('LiveCollection disposed');
    expect(collection.invalidate()).toBeUndefined();
    expect(collection.put('a', 1)).toBe(1);
    expect(collection.delete('value')).toBe(1);
    expect(collection.reset()).toBe(1);
    expect(computes).toBe(1);
  });
});
