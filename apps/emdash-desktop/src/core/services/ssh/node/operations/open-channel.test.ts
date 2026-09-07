import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Client, ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SshClientProxy } from '../lifecycle/ssh-client-proxy';

function fixture() {
  let complete!: (error: Error | undefined, channel: ClientChannel) => void;
  const forwardOut = vi.fn((...args: unknown[]) => {
    complete = args.at(-1) as typeof complete;
  });
  const client = Object.assign(new EventEmitter(), { forwardOut });
  const proxy = new SshClientProxy('test');
  proxy.update(client as unknown as Client);
  const target = { sourceHost: '127.0.0.1', sourcePort: 0, remoteHost: '::1', remotePort: 5173 };
  return {
    client,
    proxy,
    forwardOut,
    open: (options?: { signal?: AbortSignal; timeoutMs?: number }) =>
      proxy.openTcpChannel(target, options),
    complete: (error?: Error) => {
      const channel = new PassThrough();
      complete(error, channel as unknown as ClientChannel);
      return channel;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('bounded TCP channel acquisition', () => {
  it('passes the destination and transfers ownership on success', async () => {
    const f = fixture();
    const pending = f.open();
    const channel = f.complete();
    expect(await pending).toBe(channel);
    expect(f.forwardOut).toHaveBeenCalledWith('127.0.0.1', 0, '::1', 5173, expect.any(Function));
    expect(f.client.eventNames()).toEqual([]);
    f.proxy.invalidate();
    expect(channel.destroyed).toBe(false);
    channel.destroy();
  });

  it('times out and destroys a channel delivered after the deadline', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const rejected = expect(f.open({ timeoutMs: 20 })).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(f.complete().destroyed).toBe(true);
    expect(f.client.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start an already cancelled request', async () => {
    const f = fixture();
    await expect(f.open({ signal: AbortSignal.abort() })).rejects.toThrow();
    expect(f.forwardOut).not.toHaveBeenCalled();
  });

  it.each(['abort', 'close', 'end', 'error', 'invalidate', 'replace'] as const)(
    'rejects on %s and disposes late resources',
    async (event) => {
      const f = fixture();
      const controller = new AbortController();
      const rejected = expect(f.open({ signal: controller.signal })).rejects.toThrow();
      switch (event) {
        case 'abort':
          controller.abort();
          break;
        case 'invalidate':
          f.proxy.invalidate();
          break;
        case 'replace':
          f.proxy.update(new EventEmitter() as Client);
          break;
        case 'error':
          f.client.emit('error', new Error('lost'));
          break;
        default:
          f.client.emit(event);
      }
      await rejected;
      expect(f.complete().destroyed).toBe(true);
      expect(f.client.eventNames()).toEqual([]);
    }
  );

  it('preserves SSH failure reasons for address-family fallback', async () => {
    const f = fixture();
    const error = Object.assign(new Error('refused'), { reason: 2 });
    const pending = f.open();
    expect(f.complete(error).destroyed).toBe(true);
    await expect(pending).rejects.toBe(error);
  });

  it('cleans up when ssh2 throws synchronously', async () => {
    const f = fixture();
    f.forwardOut.mockImplementation(() => {
      throw new Error('closed');
    });
    await expect(f.open()).rejects.toThrow('closed');
    expect(f.client.eventNames()).toEqual([]);
  });
});
