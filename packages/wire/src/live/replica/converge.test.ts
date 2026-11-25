import { describe, expect, it } from 'vitest';
import type { LiveLogSnapshotData, LiveSnapshot, LiveUpdate } from '../../api/channel';
import type { LiveClientHandle, LiveLogClientHandle } from '../../api/client';
import { ReplicaLog } from './log';
import { ReplicaState } from './state';

type State = { count: number };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const stateSnapshot = (
  generation: number,
  sequence: number,
  count: number
): LiveSnapshot<State> => ({
  generation,
  sequence,
  timestamp: 0,
  data: { count },
});

const stateUpdate: LiveUpdate = {
  generation: 1,
  baseSequence: 0,
  sequence: 1,
  timestamp: 0,
  delta: [{ op: 'replace', path: ['count'], value: 100 }],
};

const logSnapshot = (
  generation: number,
  sequence: number,
  text: string
): LiveSnapshot<LiveLogSnapshotData> => ({
  generation,
  sequence,
  timestamp: 0,
  data: { baseOffset: 0, text, truncated: false },
});

const logUpdate: LiveUpdate = {
  generation: 1,
  baseSequence: 0,
  sequence: 1,
  timestamp: 0,
  delta: { chunk: 'NEW!' },
};

describe('replica snapshot ordering convergence', () => {
  it('keeps a newer resync snapshot when an older state snapshot resolves last', async () => {
    const oldInitial = deferred<LiveSnapshot<State>>();
    const newResync = deferred<LiveSnapshot<State>>();
    let calls = 0;
    let attached: ((update: LiveUpdate) => void) | undefined;

    const handle = {
      topic: 'state.test',
      snapshot: () => {
        calls += 1;
        return calls === 1 ? oldInitial.promise : newResync.promise;
      },
      attach: (cb: (update: LiveUpdate) => void) => {
        attached = cb;
        return Promise.resolve(() => {});
      },
    } as unknown as LiveClientHandle<State>;

    const replica = new ReplicaState<State>(handle);
    attached?.(stateUpdate);

    newResync.resolve(stateSnapshot(1, 1, 100));
    await flush();

    expect(replica.current()).toEqual({ count: 100 });
    expect(replica.stale).toBe(false);

    oldInitial.resolve(stateSnapshot(2, 0, 0));
    await replica.ready;
    await flush();

    expect(replica.current()).toEqual({ count: 100 });
    expect(replica.stale).toBe(false);
  });

  it('keeps a newer resync snapshot when an older log snapshot resolves last', async () => {
    const oldInitial = deferred<LiveSnapshot<LiveLogSnapshotData>>();
    const newResync = deferred<LiveSnapshot<LiveLogSnapshotData>>();
    let calls = 0;
    let attached: ((update: LiveUpdate) => void) | undefined;

    const handle = {
      topic: 'log.test',
      snapshot: () => {
        calls += 1;
        return calls === 1 ? oldInitial.promise : newResync.promise;
      },
      attach: (cb: (update: LiveUpdate) => void) => {
        attached = cb;
        return Promise.resolve(() => {});
      },
    } as unknown as ReturnType<LiveLogClientHandle['handle']>;

    const replica = new ReplicaLog(handle);
    attached?.(logUpdate);

    newResync.resolve(logSnapshot(1, 1, 'NEW!'));
    await flush();

    expect(replica.text()).toBe('NEW!');
    expect(replica.stale).toBe(false);

    oldInitial.resolve(logSnapshot(2, 0, 'old'));
    await replica.ready;
    await flush();

    expect(replica.text()).toBe('NEW!');
    expect(replica.stale).toBe(false);
  });

  it('resyncs to a newer-generation snapshot when an older request resolves last (state)', async () => {
    const firstRequest = deferred<LiveSnapshot<State>>();
    const secondRequest = deferred<LiveSnapshot<State>>();
    const authoritativeRequest = deferred<LiveSnapshot<State>>();
    let calls = 0;
    let attached: ((update: LiveUpdate) => void) | undefined;

    const handle = {
      topic: 'state.inverse',
      snapshot: () => {
        calls += 1;
        if (calls === 1) return firstRequest.promise;
        if (calls === 2) return secondRequest.promise;
        return authoritativeRequest.promise;
      },
      attach: (cb: (update: LiveUpdate) => void) => {
        attached = cb;
        return Promise.resolve(() => {});
      },
    } as unknown as LiveClientHandle<State>;

    const replica = new ReplicaState<State>(handle);
    attached?.(stateUpdate);

    secondRequest.resolve(stateSnapshot(100, 1, 100));
    await flush();

    expect(replica.current()).toEqual({ count: 100 });
    expect(replica.stale).toBe(false);

    firstRequest.resolve(stateSnapshot(101, 0, 101));
    await flush();

    expect(replica.current()).toEqual({ count: 100 });
    expect(replica.stale).toBe(true);

    authoritativeRequest.resolve(stateSnapshot(101, 0, 101));
    await replica.ready;
    await flush();

    expect(replica.current()).toEqual({ count: 101 });
    expect(replica.stale).toBe(false);
  });

  it('resyncs to a newer-generation snapshot when an older request resolves last (log)', async () => {
    const firstRequest = deferred<LiveSnapshot<LiveLogSnapshotData>>();
    const secondRequest = deferred<LiveSnapshot<LiveLogSnapshotData>>();
    const authoritativeRequest = deferred<LiveSnapshot<LiveLogSnapshotData>>();
    let calls = 0;
    let attached: ((update: LiveUpdate) => void) | undefined;

    const handle = {
      topic: 'log.inverse',
      snapshot: () => {
        calls += 1;
        if (calls === 1) return firstRequest.promise;
        if (calls === 2) return secondRequest.promise;
        return authoritativeRequest.promise;
      },
      attach: (cb: (update: LiveUpdate) => void) => {
        attached = cb;
        return Promise.resolve(() => {});
      },
    } as unknown as ReturnType<LiveLogClientHandle['handle']>;

    const replica = new ReplicaLog(handle);
    attached?.(logUpdate);

    secondRequest.resolve(logSnapshot(100, 1, 'new'));
    await flush();

    expect(replica.text()).toBe('new');
    expect(replica.stale).toBe(false);

    firstRequest.resolve(logSnapshot(101, 0, 'newer'));
    await flush();

    expect(replica.text()).toBe('new');
    expect(replica.stale).toBe(true);

    authoritativeRequest.resolve(logSnapshot(101, 0, 'newer'));
    await replica.ready;
    await flush();

    expect(replica.text()).toBe('newer');
    expect(replica.stale).toBe(false);
  });

  it('applies a same-generation older-request snapshot with a higher sequence (state)', async () => {
    const firstRequest = deferred<LiveSnapshot<State>>();
    const secondRequest = deferred<LiveSnapshot<State>>();
    let calls = 0;
    let attached: ((update: LiveUpdate) => void) | undefined;

    const handle = {
      topic: 'state.same-generation',
      snapshot: () => {
        calls += 1;
        return calls === 1 ? firstRequest.promise : secondRequest.promise;
      },
      attach: (cb: (update: LiveUpdate) => void) => {
        attached = cb;
        return Promise.resolve(() => {});
      },
    } as unknown as LiveClientHandle<State>;

    const replica = new ReplicaState<State>(handle);
    attached?.(stateUpdate);

    secondRequest.resolve(stateSnapshot(5, 10, 10));
    await flush();

    expect(replica.current()).toEqual({ count: 10 });
    expect(replica.stale).toBe(false);

    firstRequest.resolve(stateSnapshot(5, 11, 11));
    await replica.ready;
    await flush();

    expect(replica.current()).toEqual({ count: 11 });
    expect(replica.stale).toBe(false);
  });

  it('applies a same-generation older-request snapshot with a higher sequence (log)', async () => {
    const firstRequest = deferred<LiveSnapshot<LiveLogSnapshotData>>();
    const secondRequest = deferred<LiveSnapshot<LiveLogSnapshotData>>();
    let calls = 0;
    let attached: ((update: LiveUpdate) => void) | undefined;

    const handle = {
      topic: 'log.same-generation',
      snapshot: () => {
        calls += 1;
        return calls === 1 ? firstRequest.promise : secondRequest.promise;
      },
      attach: (cb: (update: LiveUpdate) => void) => {
        attached = cb;
        return Promise.resolve(() => {});
      },
    } as unknown as ReturnType<LiveLogClientHandle['handle']>;

    const replica = new ReplicaLog(handle);
    attached?.(logUpdate);

    secondRequest.resolve(logSnapshot(5, 10, 'new'));
    await flush();

    expect(replica.text()).toBe('new');
    expect(replica.stale).toBe(false);

    firstRequest.resolve(logSnapshot(5, 11, 'newer'));
    await replica.ready;
    await flush();

    expect(replica.text()).toBe('newer');
    expect(replica.stale).toBe(false);
  });
});
