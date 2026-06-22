import { err, ok, type Result } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
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

function delta<K, V>(
  ops: Array<{ op: 'put'; key: K; value: V } | { op: 'del'; key: K }>,
  sequence: number
) {
  return { kind: 'delta', generation: expect.any(Number), ops, sequence };
}

describe('LiveCollection', () => {
  it('does not advance sequence for subscriber or read baselines', () => {
    const collection = new LiveCollection<string, number>();
    const updates: Array<CollectionUpdate<string, number>> = [];

    const unsubscribe = collection.subscribe((update) => updates.push(update));
    expect(updates).toEqual([snapshot([], 0)]);
    expect(collection.getCached()).toEqual(cachedSnapshot([], 0));

    unsubscribe();
    collection.subscribe((update) => updates.push(update));
    expect(updates).toEqual([snapshot([], 0), snapshot([], 0)]);
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

  it('loads one scope by diffing only entries owned by that scope', async () => {
    type Entry = { scope: string | null; value: number };
    const collection = new LiveCollection<string, Entry>({
      scopeOf: (entry) => entry.scope,
    });
    const updates: Array<CollectionUpdate<string, Entry>> = [];
    collection.subscribe((update) => updates.push(update));

    await expect(
      collection.loadScope('src', async () =>
        ok([
          ['src/a', { scope: 'src', value: 1 }],
          ['src/b', { scope: 'src', value: 2 }],
        ])
      )
    ).resolves.toEqual(ok(1));
    await expect(
      collection.loadScope('test', async () => ok([['test/a', { scope: 'test', value: 3 }]]))
    ).resolves.toEqual(ok(2));
    await expect(
      collection.loadScope('src', async () =>
        ok([
          ['src/b', { scope: 'src', value: 20 }],
          ['src/c', { scope: 'src', value: 4 }],
        ])
      )
    ).resolves.toEqual(ok(3));

    expect(collection.loadedScopes()).toEqual(['src', 'test']);
    expect(collection.isScopeLoaded('src')).toBe(true);
    expect(collection.getCached()).toEqual(
      cachedSnapshot(
        [
          ['src/b', { scope: 'src', value: 20 }],
          ['test/a', { scope: 'test', value: 3 }],
          ['src/c', { scope: 'src', value: 4 }],
        ],
        3
      )
    );
    expect(updates).toEqual([
      snapshot([], 0),
      delta(
        [
          { op: 'put', key: 'src/a', value: { scope: 'src', value: 1 } },
          { op: 'put', key: 'src/b', value: { scope: 'src', value: 2 } },
        ],
        1
      ),
      delta([{ op: 'put', key: 'test/a', value: { scope: 'test', value: 3 } }], 2),
      delta(
        [
          { op: 'del', key: 'src/a' },
          { op: 'put', key: 'src/b', value: { scope: 'src', value: 20 } },
          { op: 'put', key: 'src/c', value: { scope: 'src', value: 4 } },
        ],
        3
      ),
    ]);
  });

  it('single-flights concurrent loads for the same scope', async () => {
    type Entry = { scope: string | null; value: number };
    const gate = deferred<Result<Array<[string, Entry]>>>();
    let loads = 0;
    const collection = new LiveCollection<string, Entry>({
      scopeOf: (entry) => entry.scope,
    });

    const first = collection.loadScope('src', () => {
      loads += 1;
      return gate.promise;
    });
    const second = collection.loadScope('src', () => {
      loads += 1;
      return gate.promise;
    });

    expect(loads).toBe(1);
    gate.resolve(ok([['src/a', { scope: 'src', value: 1 }]]));
    await expect(first).resolves.toEqual(ok(1));
    await expect(second).resolves.toEqual(ok(1));

    await expect(
      collection.loadScope('src', async () => ok([['src/a', { scope: 'src', value: 2 }]]))
    ).resolves.toEqual(ok(2));
    expect(loads).toBe(1);
  });

  it('suppresses no-op scope loads and preserves equal existing values', async () => {
    type Entry = { scope: string | null; id: number; label: string };
    const original = { scope: 'src', id: 1, label: 'original' };
    const equalReplacement = { scope: 'src', id: 1, label: 'replacement' };
    const collection = new LiveCollection<string, Entry>({
      scopeOf: (entry) => entry.scope,
      isEqual: (a, b) => a.id === b.id,
    });
    const updates: Array<CollectionUpdate<string, Entry>> = [];
    collection.subscribe((update) => updates.push(update));

    await expect(
      collection.loadScope('src', async () => ok([['src/a', original]]))
    ).resolves.toEqual(ok(1));
    await expect(
      collection.loadScope('other', async () =>
        ok([['other/a', { scope: 'other', id: 2, label: 'x' }]])
      )
    ).resolves.toEqual(ok(2));
    await expect(
      collection.loadScope('src', async () => ok([['src/a', equalReplacement]]))
    ).resolves.toEqual(ok(2));

    expect(updates).toHaveLength(3);
    expect(collection.getCached().entries.find(([key]) => key === 'src/a')?.[1]).toBe(original);
  });

  it('does not mark a scope loaded when its loader returns an expected error', async () => {
    type Entry = { scope: string | null; value: number };
    const collection = new LiveCollection<string, Entry, string>({
      scopeOf: (entry) => entry.scope,
    });

    await expect(collection.loadScope('src', async () => err('boom'))).resolves.toEqual(
      err('boom')
    );

    expect(collection.isScopeLoaded('src')).toBe(false);
    expect(collection.getCached()).toEqual(cachedSnapshot([], 0));
  });

  it('propagates unexpected load errors without marking the scope loaded', async () => {
    type Entry = { scope: string | null; value: number };
    const unexpected = new Error('boom');
    const collection = new LiveCollection<string, Entry>({
      scopeOf: (entry) => entry.scope,
    });

    await expect(
      collection.loadScope('src', async (): Promise<Result<Array<[string, Entry]>>> => {
        throw unexpected;
      })
    ).rejects.toBe(unexpected);

    expect(collection.isScopeLoaded('src')).toBe(false);
    await expect(
      collection.loadScope('src', async () => ok([['src/a', { scope: 'src', value: 1 }]]))
    ).resolves.toEqual(ok(1));
  });

  it('throws when a scoped load returns entries outside the requested scope', async () => {
    type Entry = { scope: string | null; value: number };
    const collection = new LiveCollection<string, Entry>({
      scopeOf: (entry) => entry.scope,
    });

    await expect(
      collection.loadScope('src', async () => ok([['test/a', { scope: 'test', value: 1 }]]))
    ).rejects.toThrow('LiveCollection loadScope loaded an entry outside the requested scope');
    expect(collection.isScopeLoaded('src')).toBe(false);
  });

  it('unloads only direct entries in the requested scope', async () => {
    type Entry = { scope: string | null; value: number };
    const collection = new LiveCollection<string, Entry>({
      scopeOf: (entry) => entry.scope,
    });
    await collection.loadScope(null, async () => ok([['src', { scope: null, value: 1 }]]));
    await collection.loadScope('src', async () => ok([['src/a', { scope: 'src', value: 2 }]]));

    expect(collection.unloadScope(null)).toBe(3);

    expect(collection.isScopeLoaded(null)).toBe(false);
    expect(collection.isScopeLoaded('src')).toBe(true);
    expect(collection.getCached()).toEqual(
      cachedSnapshot([['src/a', { scope: 'src', value: 2 }]], 3)
    );
  });

  it('can reset with a new generation for resync baselines', () => {
    const collection = new LiveCollection<string, number>();
    const updates: Array<CollectionUpdate<string, number>> = [];
    collection.subscribe((update) => updates.push(update));
    const initialGeneration = updates[0]!.generation;

    expect(collection.put('a', 1)).toBe(1);
    expect(collection.resetWithNewGeneration([['b', 2]])).toBe(2);

    expect(updates[2]).toEqual(snapshot([['b', 2]], 2));
    expect(updates[2]!.generation).toBeGreaterThan(initialGeneration);
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

  it('rejects subscribe/loadScope after dispose and makes mutations no-ops', async () => {
    const collection = new LiveCollection<string, { scope: string | null; value: number }>({
      scopeOf: (entry) => entry.scope,
    });
    const unsubscribe = collection.subscribe(() => {});
    collection.put('value', { scope: null, value: 1 });

    collection.dispose();
    unsubscribe();
    unsubscribe();

    expect(() => collection.subscribe(() => {})).toThrow('LiveCollection disposed');
    expect(() =>
      collection.loadScope(null, async () => ok([['value', { scope: null, value: 2 }]]))
    ).toThrow('LiveCollection disposed');
    expect(collection.put('a', { scope: null, value: 3 })).toBe(1);
    expect(collection.delete('value')).toBe(1);
    expect(collection.reset()).toBe(1);
  });
});
