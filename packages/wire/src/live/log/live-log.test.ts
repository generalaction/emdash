import { describe, expect, it, vi } from 'vitest';
import { LiveLogClient } from './client';
import { LiveLog } from './server';

function setup(options: { maxBufferBytes?: number; generation?: number } = {}) {
  const server = new LiveLog({
    generation: options.generation ?? 1000,
    maxBufferBytes: options.maxBufferBytes,
  });
  const onReset = vi.fn<(data: { baseOffset: number; text: string; truncated: boolean }) => void>();
  const onAppend = vi.fn<(chunk: string) => void>();
  const refetchSnapshot = vi.fn(async () => server.snapshot());
  const client = new LiveLogClient({ refetchSnapshot, onReset, onAppend });

  client.seed(server.snapshot());
  server.subscribe((update) => client.applyUpdate(update));

  return { server, client, onReset, onAppend, refetchSnapshot };
}

describe('LiveLog', () => {
  it('emits envelope-correct append updates', () => {
    const server = new LiveLog({ generation: 1000 });
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
    const server = new LiveLog({ generation: 1000, maxBufferBytes: 5 });

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
});

describe('LiveLogClient', () => {
  it('seeds from a snapshot and applies append updates', () => {
    const { server, client, onReset, onAppend } = setup();

    server.append('hello');
    server.append(' world');

    expect(onReset).toHaveBeenCalledWith({ baseOffset: 0, text: '', truncated: false });
    expect(onAppend).toHaveBeenNthCalledWith(1, 'hello');
    expect(onAppend).toHaveBeenNthCalledWith(2, ' world');
    expect(client.getSnapshot()).toEqual({ baseOffset: 0, text: 'hello world', truncated: false });
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
    const server = new LiveLog({ generation: 1000 });
    const onReset =
      vi.fn<(data: { baseOffset: number; text: string; truncated: boolean }) => void>();
    const onAppend = vi.fn<(chunk: string) => void>();
    const refetchSnapshot = vi.fn(async () => server.snapshot());
    const client = new LiveLogClient({ refetchSnapshot, onReset, onAppend });
    client.seed(server.snapshot());

    server.append('offline output');
    await client.refresh();

    expect(client.getSnapshot()).toEqual({
      baseOffset: 0,
      text: 'offline output',
      truncated: false,
    });
    expect(refetchSnapshot).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenLastCalledWith({
      baseOffset: 0,
      text: 'offline output',
      truncated: false,
    });
    expect(onAppend).not.toHaveBeenCalled();
  });
});
