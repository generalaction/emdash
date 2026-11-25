import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LiveLogSnapshotData, LiveSnapshot, LiveUpdate } from '../api/channel';
import { resyncRetry } from './follower';
import { LiveLogClient } from './log';
import { LiveStateClient } from './state';

const stateSchema = z.object({ count: z.number() });
type State = z.infer<typeof stateSchema>;

const snapshotOf = (count: number, sequence: number): LiveSnapshot<State> => ({
  generation: 1,
  sequence,
  timestamp: 0,
  data: { count },
});

const updateOf = (baseSequence: number, count: number): LiveUpdate => ({
  generation: 1,
  baseSequence,
  sequence: baseSequence + 1,
  timestamp: 0,
  delta: [{ op: 'replace', path: ['count'], value: count }],
});

const logSnapshot = (sequence: number, text: string): LiveSnapshot<LiveLogSnapshotData> => ({
  generation: 1,
  sequence,
  timestamp: 0,
  data: { baseOffset: 0, text, truncated: false },
});

const logUpdate = (baseSequence: number, chunk: string): LiveUpdate => ({
  generation: 1,
  baseSequence,
  sequence: baseSequence + 1,
  timestamp: 0,
  delta: { chunk },
});

describe('follower stale updates', () => {
  it('drops an update the seeded snapshot already covers instead of resyncing', () => {
    let refetches = 0;
    const values: number[] = [];
    const client = new LiveStateClient<State>(
      stateSchema,
      async () => {
        refetches += 1;
        return snapshotOf(0, 0);
      },
      (value) => values.push(value.count),
      { onResyncFailed: resyncRetry() }
    );
    client.seed(snapshotOf(5, 5));

    client.applyUpdate(updateOf(3, 4));
    client.applyUpdate(updateOf(4, 5));
    client.applyUpdate(updateOf(5, 6));

    expect(refetches).toBe(0);
    expect(client.stale).toBe(false);
    expect(values.at(-1)).toBe(6);
  });
});

describe('follower stale snapshots', () => {
  it('keeps output applied while an older resync snapshot was in flight', async () => {
    const text: string[] = [];
    let resolveRefetch: (snapshot: LiveSnapshot<LiveLogSnapshotData>) => void = () => {};
    const client = new LiveLogClient({
      refetchSnapshot: () => new Promise((resolve) => (resolveRefetch = resolve)),
      onReset: (data) => text.splice(0, text.length, data.text),
      onAppend: (chunk) => text.push(chunk),
      onResyncFailed: resyncRetry(),
    });
    client.seed(logSnapshot(0, ''));
    client.applyUpdate(logUpdate(0, 'a'));

    // Snapshot 1 is captured, update 2 arrives, then snapshot 1 resolves and output goes silent.
    client.invalidate();
    client.applyUpdate(logUpdate(1, 'b'));
    resolveRefetch(logSnapshot(1, 'a'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(text.join('')).toBe('ab');
    expect(client.writtenOffset).toBe(2);
    expect(client.stale).toBe(false);
  });
});
