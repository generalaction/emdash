import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing';
import { createKeyedLanes } from './keyed-lanes';

describe('createKeyedLanes', () => {
  it('runs work in FIFO order per key while allowing other keys to run', async () => {
    const lanes = createKeyedLanes();
    const releaseFirst = deferred<void>();
    const started: string[] = [];
    const signal = new AbortController().signal;

    const first = lanes.run('a', signal, async () => {
      started.push('a:first');
      await releaseFirst.promise;
      return 1;
    });
    const second = lanes.run('a', signal, async () => {
      started.push('a:second');
      return 2;
    });
    const other = lanes.run('b', signal, async () => {
      started.push('b:first');
      return 3;
    });

    await vi.waitFor(() => expect(started).toEqual(['a:first', 'b:first']));
    expect(lanes.depth('a')).toBe(2);
    expect(lanes.depth('b')).toBe(0);

    releaseFirst.resolve();
    await expect(Promise.all([first, second, other])).resolves.toEqual([1, 2, 3]);
    expect(started).toEqual(['a:first', 'b:first', 'a:second']);
    expect(lanes.depth('a')).toBe(0);
  });

  it('removes aborted waiters from lane depth', async () => {
    const lanes = createKeyedLanes();
    const releaseFirst = deferred<void>();
    const first = lanes.run('a', new AbortController().signal, async () => {
      await releaseFirst.promise;
    });
    const waiting = new AbortController();
    const cancelled = lanes.run('a', waiting.signal, async () => 'cancelled operation ran');

    await vi.waitFor(() => expect(lanes.depth('a')).toBe(2));
    waiting.abort(new Error('cancel queued operation'));
    await expect(cancelled).rejects.toThrow('cancel queued operation');
    expect(lanes.depth('a')).toBe(1);

    releaseFirst.resolve();
    await first;
    expect(lanes.depth('a')).toBe(0);
  });

  it('coalesces repeated invalidations into one pending run', async () => {
    const lanes = createKeyedLanes();
    const releaseFirst = deferred<void>();
    const runs: string[] = [];

    lanes.coalesce('workspace', async () => {
      runs.push('first');
      await releaseFirst.promise;
    });
    await vi.waitFor(() => expect(runs).toEqual(['first']));

    lanes.coalesce('workspace', async () => {
      runs.push('second');
    });
    lanes.coalesce('workspace', async () => {
      runs.push('third');
    });

    expect(lanes.depth('workspace')).toBe(2);
    releaseFirst.resolve();
    await vi.waitFor(() => expect(runs).toEqual(['first', 'third']));
    expect(lanes.depth('workspace')).toBe(0);
  });

  it('routes coalesced errors and continues with the next pending run', async () => {
    const lanes = createKeyedLanes();
    const releaseFirst = deferred<void>();
    const errors: unknown[] = [];
    const runs: string[] = [];

    lanes.coalesce(
      'workspace',
      async () => {
        runs.push('first');
        await releaseFirst.promise;
        throw new Error('first failed');
      },
      (error) => errors.push(error)
    );
    await vi.waitFor(() => expect(runs).toEqual(['first']));
    lanes.coalesce('workspace', async () => {
      runs.push('second');
    });

    releaseFirst.resolve();
    await vi.waitFor(() => expect(runs).toEqual(['first', 'second']));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe('first failed');
  });
});
