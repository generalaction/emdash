import type { CollectionSnapshot, CollectionUpdate } from '@emdash/core/lib';
import { describe, expect, it } from 'vitest';
import { CollectionMirror } from './collection-mirror';

type Entry = { label: string };

function snapshot(
  entries: Array<[string, Entry]>,
  sequence: number,
  generation = 1
): CollectionSnapshot<string, Entry> {
  return { entries, generation, sequence };
}

function delta(
  ops: Array<{ op: 'put'; key: string; value: Entry } | { op: 'del'; key: string }>,
  sequence: number,
  generation = 1
): CollectionUpdate<string, Entry> {
  return { kind: 'delta', generation, ops, sequence };
}

describe('CollectionMirror', () => {
  it('applies snapshots and exposes collection accessors', () => {
    const mirror = new CollectionMirror<string, Entry>();
    expect(mirror.current).toBeNull();
    expect(mirror.sequence).toBe(-1);
    expect(mirror.generation).toBe(-1);

    mirror.setSnapshot(snapshot([['a', { label: 'a' }]], 3, 5));

    expect(mirror.current).toEqual(snapshot([['a', { label: 'a' }]], 3, 5));
    expect(mirror.sequence).toBe(3);
    expect(mirror.generation).toBe(5);
    expect(mirror.size).toBe(1);
    expect(mirror.has('a')).toBe(true);
    expect(mirror.get('a')).toEqual({ label: 'a' });
    expect(mirror.keys()).toEqual(['a']);
    expect(mirror.values()).toEqual([{ label: 'a' }]);
    expect(mirror.entries()).toEqual([['a', { label: 'a' }]]);
  });

  it('applies deltas after a snapshot baseline', () => {
    const mirror = new CollectionMirror<string, Entry>();
    mirror.setSnapshot(
      snapshot(
        [
          ['a', { label: 'a' }],
          ['b', { label: 'b' }],
        ],
        1
      )
    );

    mirror.applyUpdate(
      delta(
        [
          { op: 'put', key: 'c', value: { label: 'c' } },
          { op: 'del', key: 'a' },
        ],
        2
      )
    );

    expect(mirror.sequence).toBe(2);
    expect(mirror.entries()).toEqual([
      ['b', { label: 'b' }],
      ['c', { label: 'c' }],
    ]);
  });

  it('ignores stale updates within the same or an older generation', () => {
    const mirror = new CollectionMirror<string, Entry>();
    mirror.setSnapshot(snapshot([['a', { label: 'a' }]], 3, 2));

    mirror.applyUpdate(delta([{ op: 'put', key: 'b', value: { label: 'b' } }], 3, 2));
    mirror.applyUpdate(delta([{ op: 'put', key: 'c', value: { label: 'c' } }], 20, 1));
    expect(mirror.entries()).toEqual([['a', { label: 'a' }]]);

    mirror.applyUpdate(delta([{ op: 'put', key: 'b', value: { label: 'b' } }], 4, 2));
    expect(mirror.entries()).toEqual([
      ['a', { label: 'a' }],
      ['b', { label: 'b' }],
    ]);
  });

  it('buffers deltas until a compatible snapshot baseline arrives', () => {
    const mirror = new CollectionMirror<string, Entry>();

    mirror.applyUpdate(delta([{ op: 'put', key: 'b', value: { label: 'b' } }], 2));
    expect(mirror.current).toBeNull();
    expect(mirror.entries()).toEqual([]);

    mirror.setSnapshot(snapshot([['a', { label: 'a' }]], 1));

    expect(mirror.sequence).toBe(2);
    expect(mirror.entries()).toEqual([
      ['a', { label: 'a' }],
      ['b', { label: 'b' }],
    ]);
  });

  it('buffers newer-generation deltas until that generation has a snapshot', () => {
    const mirror = new CollectionMirror<string, Entry>();
    mirror.setSnapshot(snapshot([['a', { label: 'a' }]], 5, 1));

    mirror.applyUpdate(delta([{ op: 'put', key: 'b', value: { label: 'b' } }], 1, 2));
    expect(mirror.generation).toBe(1);
    expect(mirror.entries()).toEqual([['a', { label: 'a' }]]);

    mirror.setSnapshot(snapshot([['c', { label: 'c' }]], 0, 2));

    expect(mirror.generation).toBe(2);
    expect(mirror.sequence).toBe(1);
    expect(mirror.entries()).toEqual([
      ['c', { label: 'c' }],
      ['b', { label: 'b' }],
    ]);
  });

  it('drops pre-baseline deltas after the pending buffer limit is exceeded', () => {
    const mirror = new CollectionMirror<string, Entry>({ maxBufferedDeltas: 1 });

    mirror.applyUpdate(delta([{ op: 'put', key: 'b', value: { label: 'b' } }], 2));
    mirror.applyUpdate(delta([{ op: 'put', key: 'c', value: { label: 'c' } }], 3));
    mirror.applyUpdate(delta([{ op: 'put', key: 'd', value: { label: 'd' } }], 4));
    mirror.setSnapshot(snapshot([['a', { label: 'a' }]], 1));

    expect(mirror.sequence).toBe(1);
    expect(mirror.entries()).toEqual([['a', { label: 'a' }]]);

    mirror.applyUpdate(delta([{ op: 'put', key: 'e', value: { label: 'e' } }], 2));
    expect(mirror.entries()).toEqual([
      ['a', { label: 'a' }],
      ['e', { label: 'e' }],
    ]);
  });

  it('keeps later-generation deltas after an earlier generation overflows', () => {
    const mirror = new CollectionMirror<string, Entry>({ maxBufferedDeltas: 1 });

    mirror.applyUpdate(delta([{ op: 'put', key: 'b', value: { label: 'b' } }], 2, 1));
    mirror.applyUpdate(delta([{ op: 'put', key: 'c', value: { label: 'c' } }], 3, 1));
    mirror.applyUpdate(delta([{ op: 'put', key: 'd', value: { label: 'd' } }], 2, 2));

    mirror.setSnapshot(snapshot([['a', { label: 'a' }]], 1, 1));

    expect(mirror.generation).toBe(1);
    expect(mirror.entries()).toEqual([['a', { label: 'a' }]]);

    mirror.setSnapshot(snapshot([['e', { label: 'e' }]], 1, 2));

    expect(mirror.generation).toBe(2);
    expect(mirror.sequence).toBe(2);
    expect(mirror.entries()).toEqual([
      ['e', { label: 'e' }],
      ['d', { label: 'd' }],
    ]);
  });

  it('notifies only when snapshots and deltas are accepted', () => {
    const applied: string[] = [];
    const mirror = new CollectionMirror<string, Entry>({
      onApplied: (change) => {
        applied.push(
          `${change.kind}:${change.kind === 'snapshot' ? change.snapshot.sequence : change.update.sequence}`
        );
      },
    });

    mirror.applyUpdate(delta([{ op: 'put', key: 'buffered', value: { label: 'buffered' } }], 2));
    mirror.setSnapshot(snapshot([['a', { label: 'a' }]], 1));
    mirror.applyUpdate(delta([{ op: 'put', key: 'stale', value: { label: 'stale' } }], 1));
    mirror.applyUpdate(delta([{ op: 'put', key: 'b', value: { label: 'b' } }], 3));

    expect(applied).toEqual(['snapshot:1', 'delta:2', 'delta:3']);
  });

  it('accepts snapshot-shaped updates', () => {
    const mirror = new CollectionMirror<string, Entry>();
    mirror.applyUpdate({ kind: 'snapshot', ...snapshot([['a', { label: 'a' }]], 1) });
    expect(mirror.entries()).toEqual([['a', { label: 'a' }]]);
  });

  it('resolves waitForSequence once the target sequence is reached', async () => {
    const mirror = new CollectionMirror<string, Entry>();
    mirror.setSnapshot(snapshot([], 1));

    const waited = mirror.waitForSequence(3);
    mirror.applyUpdate(delta([{ op: 'put', key: 'a', value: { label: 'a' } }], 2));
    let resolved = false;
    void waited.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    mirror.applyUpdate(delta([{ op: 'put', key: 'b', value: { label: 'b' } }], 3));
    await waited;
    expect(resolved).toBe(true);
  });

  it('resolves pending waiters on a generation change regardless of sequence', async () => {
    const mirror = new CollectionMirror<string, Entry>();
    mirror.setSnapshot(snapshot([], 1, 1));

    const waited = mirror.waitForSequence(100);
    mirror.setSnapshot(snapshot([], 1, 2));

    await expect(waited).resolves.toBeUndefined();
  });

  it('rejects pending waiters on dispose', async () => {
    const mirror = new CollectionMirror<string, Entry>();
    mirror.setSnapshot(snapshot([], 1));

    const waited = mirror.waitForSequence(5);
    mirror.dispose();

    await expect(waited).rejects.toThrow(/disposed/);
  });
});
