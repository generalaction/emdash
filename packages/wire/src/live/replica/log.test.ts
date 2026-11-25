import { waitFor } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LiveLogSnapshotData, LiveUpdate, SnapshotOptions } from '../../api/channel';
import type { LiveClientHandle } from '../../api/client';
import { defineContract, liveLog } from '../../api/define';
import { createTestWire } from '../../testing';
import { LiveLogSource } from '../log';
import { createLiveLogReplicaCache, ReplicaLog } from './log';

const api = defineContract({
  output: liveLog({ key: z.object({ id: z.string() }) }),
});

function fakeLogHandle(source: LiveLogSource) {
  let push: ((update: LiveUpdate) => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let reattach: (() => void) | undefined;
  let markAttached: (() => void) | undefined;
  const attached = new Promise<void>((resolve) => {
    markAttached = resolve;
  });
  const snapshotOptions: SnapshotOptions[] = [];

  const handle: LiveClientHandle<LiveLogSnapshotData> = {
    topic: 'fake-log',
    async snapshot(options?: SnapshotOptions) {
      snapshotOptions.push(options ?? {});
      return source.snapshot(options);
    },
    async attach(nextPush, options) {
      push = nextPush;
      reattach = options?.onReattach;
      unsubscribe = source.subscribe(nextPush);
      markAttached?.();
      return () => unsubscribe?.();
    },
    asLiveSource() {
      throw new Error('fake handle does not support asLiveSource');
    },
  };

  return {
    handle,
    snapshotOptions,
    attached,
    disconnect() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
    reconnect() {
      if (!push) throw new Error('reconnect before attach');
      unsubscribe = source.subscribe(push);
      reattach?.();
    },
  };
}

function deferSnapshots(fake: ReturnType<typeof fakeLogHandle>) {
  const originalSnapshot = fake.handle.snapshot.bind(fake.handle);
  let defer = false;
  let pending = false;
  let release: (() => void) | undefined;

  fake.handle.snapshot = (options) => {
    if (!defer) return originalSnapshot(options);
    defer = false;
    pending = true;
    return new Promise((resolve) => {
      release = () => {
        pending = false;
        release = undefined;
        resolve(originalSnapshot(options));
      };
    });
  };

  return {
    deferNext() {
      defer = true;
    },
    releaseSnapshot() {
      release?.();
    },
    get pending() {
      return pending;
    },
  };
}

describe('createLiveLogReplicaCache', () => {
  it('seeds retained text and passes through appends under local cursors', async () => {
    const key = { id: 'session' };
    const log = new LiveLogSource({ generation: 1000 });
    log.append('seed\n');
    const contractClient = createTestWire(api, { output: () => log }).client;

    const replica = createLiveLogReplicaCache(api.output, contractClient.output);
    const lease = replica.acquire(key);
    const output = await lease.ready();
    const appends: string[] = [];
    output.onAppend((chunk) => appends.push(chunk));

    expect(output.text()).toBe('seed\n');
    log.append('next\n');
    await waitFor(() => appends.length === 1);

    expect(appends).toEqual(['next\n']);
    expect((await output.snapshot()).data.text).toBe('seed\nnext\n');

    await lease.release();
    await replica.dispose();
  });

  it('writes through to a custom log store', async () => {
    const key = { id: 'session' };
    const log = new LiveLogSource({ generation: 1000 });
    log.append('seed');
    const contractClient = createTestWire(api, { output: () => log }).client;
    let text = '';

    const replica = createLiveLogReplicaCache(api.output, contractClient.output, {
      store: () => ({
        reset: (data) => {
          text = data.text;
        },
        append: (chunk) => {
          text += chunk;
        },
        text: () => text,
      }),
    });
    const lease = replica.acquire(key);
    const output = await lease.ready();

    expect(output.text()).toBe('seed');
    log.append('\nnext');
    await waitFor(() => output.text() === 'seed\nnext');

    await lease.release();
    await replica.dispose();
  });

  it('supports write-only log sinks without readable text', async () => {
    const key = { id: 'session' };
    const log = new LiveLogSource({ generation: 1000 });
    log.append('seed');
    const contractClient = createTestWire(api, { output: () => log }).client;
    const writes: string[] = [];

    const replica = createLiveLogReplicaCache(api.output, contractClient.output, {
      store: () => ({
        reset: (data) => {
          writes.push(`reset:${data.text}`);
        },
        append: (chunk) => {
          writes.push(`append:${chunk}`);
        },
      }),
    });
    const lease = replica.acquire(key);
    const output = await lease.ready();

    expect(() => output.text()).toThrow('write-only LogSink');
    log.append('\nnext');
    await waitFor(() => writes.length === 2);
    expect(writes).toEqual(['reset:seed', 'append:\nnext']);

    await lease.release();
    await replica.dispose();
  });

  it('serves downstream clients from the local log buffer', async () => {
    const key = { id: 'session' };
    const log = new LiveLogSource({ generation: 1000 });
    const upstream = createTestWire(api, { output: () => log }).client;
    const replica = createLiveLogReplicaCache(api.output, upstream.output);
    const downstream = createTestWire(api, { output: replica }).client;

    const handle = downstream.output.handle(key);
    const updates: string[] = [];
    const detach = await handle.attach((update) => {
      updates.push((update.delta as { chunk: string }).chunk);
    });
    await handle.snapshot();
    log.append('served\n');
    await waitFor(() => updates.length === 1);

    expect((await handle.snapshot()).data.text).toBe('served\n');

    detach();
    await replica.dispose();
  });
});

describe('ReplicaLog resync', () => {
  it('refetches a ranged snapshot from its current position after a gap', async () => {
    const source = new LiveLogSource({ generation: 1000 });
    source.append('seed\n');
    const fake = fakeLogHandle(source);
    const replica = new ReplicaLog(fake.handle);
    await fake.attached;
    await replica.ready;

    expect(replica.text()).toBe('seed\n');

    fake.disconnect();
    source.append('missed\n');
    fake.reconnect();

    await waitFor(() => replica.text() === source.snapshot().data.text && !replica.stale);
    expect(replica.text()).toBe(source.snapshot().data.text);
    expect(replica.stale).toBe(false);
    expect(fake.snapshotOptions.some((options) => options.since?.offset === 5)).toBe(true);

    await replica.dispose();
  });

  it('resyncs from a full tail when its position is no longer retained', async () => {
    const source = new LiveLogSource({ generation: 1000, maxBufferBytes: 4 });
    source.append('seed');
    const fake = fakeLogHandle(source);
    const replica = new ReplicaLog(fake.handle);
    await fake.attached;
    await replica.ready;

    expect(replica.text()).toBe('seed');

    fake.disconnect();
    source.append('123');
    source.append('456');
    fake.reconnect();

    await waitFor(() => replica.text() === source.snapshot().data.text && !replica.stale);
    expect(replica.text()).toBe('456');
    expect(replica.stale).toBe(false);
    expect(fake.snapshotOptions.some((options) => options.since?.offset === 4)).toBe(true);

    await replica.dispose();
  });

  it('does not duplicate or reset when a live update races a ranged resync snapshot', async () => {
    const source = new LiveLogSource({ generation: 1000 });
    source.append('seed');
    const fake = fakeLogHandle(source);
    const snapshots = deferSnapshots(fake);
    const replica = new ReplicaLog(fake.handle);
    await fake.attached;
    await replica.ready;

    fake.disconnect();
    source.append('missed');
    snapshots.deferNext();
    fake.reconnect();

    await waitFor(() => snapshots.pending);
    source.append(' tail');
    snapshots.releaseSnapshot();

    await waitFor(() => replica.text() === source.snapshot().data.text && !replica.stale);
    expect(replica.text()).toBe('seedmissed tail');
    expect(replica.stale).toBe(false);

    await replica.dispose();
  });

  it('resets cleanly when the snapshot generation changes while the resync is in flight', async () => {
    const source = new LiveLogSource({ generation: 1000 });
    source.append('old');
    const fake = fakeLogHandle(source);
    const snapshots = deferSnapshots(fake);
    const replica = new ReplicaLog(fake.handle);
    await fake.attached;
    await replica.ready;

    fake.disconnect();
    source.reseed({ baseOffset: 0, text: 'new', truncated: false });
    snapshots.deferNext();
    fake.reconnect();

    await waitFor(() => snapshots.pending);
    source.append(' gen');
    snapshots.releaseSnapshot();

    await waitFor(() => replica.text() === source.snapshot().data.text && !replica.stale);
    expect(replica.text()).toBe('new gen');
    expect(replica.stale).toBe(false);

    await replica.dispose();
  });

  it('does not duplicate when the resync falls back to a full tail', async () => {
    const source = new LiveLogSource({ generation: 1000, maxBufferBytes: 4 });
    source.append('seed');
    const fake = fakeLogHandle(source);
    const snapshots = deferSnapshots(fake);
    const replica = new ReplicaLog(fake.handle);
    await fake.attached;
    await replica.ready;

    fake.disconnect();
    source.append('123');
    source.append('456');
    snapshots.deferNext();
    fake.reconnect();

    await waitFor(() => snapshots.pending);
    source.append(' tail');
    snapshots.releaseSnapshot();

    await waitFor(() => replica.text() === source.snapshot().data.text && !replica.stale);
    expect(replica.text()).toBe(source.snapshot().data.text);
    expect(replica.stale).toBe(false);

    await replica.dispose();
  });
});
