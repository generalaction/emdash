import { describe, expect, it, vi } from 'vitest';
import { resyncRetry } from '../follower';
import { LiveLogClient } from './client';
import { LiveLogSource } from './source';

function setup(options: { maxBufferBytes?: number; generation?: number } = {}) {
  const server = new LiveLogSource({
    generation: options.generation ?? 1000,
    maxBufferBytes: options.maxBufferBytes,
  });
  const onReset = vi.fn<(data: { baseOffset: number; text: string; truncated: boolean }) => void>();
  const onAppend = vi.fn<(chunk: string) => void>();
  const refetchSnapshot = vi.fn(async () => server.snapshot());
  const client = new LiveLogClient({
    refetchSnapshot,
    onReset,
    onAppend,
    onResyncFailed: resyncRetry(),
  });

  client.seed(server.snapshot());
  server.subscribe((update) => client.applyUpdate(update));

  return { server, client, onReset, onAppend, refetchSnapshot };
}

describe('LiveLogSource', () => {
  it('advances the output generation even when runs restart in the same millisecond', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const server = new LiveLogSource();
      const initial = server.snapshot().generation;
      server.reseed();
      const next = server.snapshot().generation;
      server.reseed();
      expect(next).toBeGreaterThan(initial);
      expect(server.snapshot().generation).toBeGreaterThan(next);
    } finally {
      now.mockRestore();
    }
  });

  it('emits envelope-correct append updates', () => {
    const server = new LiveLogSource({ generation: 1000 });
    const updates: unknown[] = [];
    server.subscribe((update) => updates.push(update));

    server.append('hello');

    expect(updates).toEqual([
      {
        generation: 1000,
        baseSequence: 0,
        sequence: 1,
        timestamp: expect.any(Number),
        delta: { chunk: 'hello' },
      },
    ]);
  });

  it('snapshots the retained tail with offset and truncation metadata', () => {
    const server = new LiveLogSource({ generation: 1000, maxBufferBytes: 5 });

    server.append('abc');
    server.append('de');
    server.append('fg');

    expect(server.snapshot()).toMatchObject({
      generation: 1000,
      sequence: 3,
      data: {
        baseOffset: 3,
        text: 'defg',
        truncated: true,
      },
    });
  });

  it('returns only bytes retained after a since offset', () => {
    const server = new LiveLogSource({ generation: 1000, maxBufferBytes: 5 });

    server.append('abc');
    server.append('de');
    server.append('fg');

    expect(server.snapshot({ since: { generation: 1000, offset: 5 } })).toMatchObject({
      generation: 1000,
      sequence: 3,
      data: {
        baseOffset: 5,
        text: 'fg',
        truncated: true,
      },
    });
  });

  it('returns the full tail when the since generation differs', () => {
    const server = new LiveLogSource({ generation: 1000, maxBufferBytes: 5 });

    server.append('abc');
    server.append('de');
    server.append('fg');

    expect(server.snapshot({ since: { generation: 999, offset: 5 } })).toMatchObject({
      generation: 1000,
      sequence: 3,
      data: {
        baseOffset: 3,
        text: 'defg',
        truncated: true,
      },
    });
  });

  it('returns the full tail when the since offset is outside the retained range', () => {
    const server = new LiveLogSource({ generation: 1000, maxBufferBytes: 5 });

    server.append('abc');
    server.append('de');
    server.append('fg');

    expect(server.snapshot({ since: { generation: 1000, offset: 2 } }).data).toMatchObject({
      baseOffset: 3,
      text: 'defg',
      truncated: true,
    });
    expect(server.snapshot({ since: { generation: 1000, offset: 8 } }).data).toMatchObject({
      baseOffset: 3,
      text: 'defg',
      truncated: true,
    });
  });

  it('never splits a multi-byte code point and accepts a valid boundary after it', () => {
    const server = new LiveLogSource({ generation: 1000 });

    server.append('a😀b');

    expect(server.snapshot({ since: { generation: 1000, offset: 3 } }).data).toMatchObject({
      baseOffset: 0,
      text: 'a😀b',
      truncated: false,
    });
    expect(server.snapshot({ since: { generation: 1000, offset: 5 } }).data).toMatchObject({
      baseOffset: 5,
      text: 'b',
      truncated: false,
    });
  });

  it('slices since offsets from retained chunk byte lengths, not joined text', () => {
    const server = new LiveLogSource({ generation: 1000 });

    server.append('\ud800');
    server.append('\udc00');
    server.append('abc');

    expect(server.snapshot({ since: { generation: 1000, offset: 6 } }).data).toMatchObject({
      baseOffset: 6,
      text: 'abc',
      truncated: false,
    });
  });
});

describe('LiveLogClient', () => {
  it('seeds from a snapshot and applies append updates', () => {
    const { server, client, onReset, onAppend } = setup();

    server.append('hello');
    server.append(' world');

    expect(onReset).toHaveBeenCalledWith({ baseOffset: 0, text: '', truncated: false });
    expect(onAppend).toHaveBeenNthCalledWith(1, 'hello');
    expect(onAppend).toHaveBeenNthCalledWith(2, ' world');
    expect(client.writtenOffset).toBe('hello world'.length);
  });

  it('resyncs on sequence gaps', async () => {
    const { client, refetchSnapshot } = setup();

    client.applyUpdate({
      generation: 1000,
      baseSequence: 99,
      sequence: 100,
      timestamp: 0,
      delta: { chunk: 'gap' },
    });

    await vi.waitFor(() => expect(refetchSnapshot).toHaveBeenCalledTimes(1));
  });

  it('refreshes from a fresh snapshot on demand', async () => {
    const server = new LiveLogSource({ generation: 1000 });
    const onReset =
      vi.fn<(data: { baseOffset: number; text: string; truncated: boolean }) => void>();
    const onAppend = vi.fn<(chunk: string) => void>();
    const refetchSnapshot = vi.fn(async () => server.snapshot());
    const client = new LiveLogClient({
      refetchSnapshot,
      onReset,
      onAppend,
      onResyncFailed: resyncRetry(),
    });
    client.seed(server.snapshot());

    server.append('offline output');
    await client.refresh();

    expect(client.writtenOffset).toBe('offline output'.length);
    expect(refetchSnapshot).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onAppend).toHaveBeenCalledWith('offline output');
  });
});
