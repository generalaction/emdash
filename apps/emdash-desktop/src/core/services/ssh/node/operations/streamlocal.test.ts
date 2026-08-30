import { EventEmitter } from 'node:events';
import type { Client, ClientCallback, ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forwardOutStreamLocalOnClient } from './streamlocal';

afterEach(() => vi.useRealTimers());

describe('forwardOutStreamLocalOnClient', () => {
  it('times out a hung channel open and destroys a late channel', async () => {
    vi.useFakeTimers();
    let callback: ClientCallback | undefined;
    const events = new EventEmitter();
    const client = Object.assign(events, {
      openssh_forwardOutStreamLocal(_path: string, next: ClientCallback) {
        callback = next;
        return client;
      },
    }) as unknown as Client;
    const pending = forwardOutStreamLocalOnClient(client, '/run/emdash.sock', { timeoutMs: 25 });
    const rejected = expect(pending).rejects.toThrow('Timed out after 25ms');

    await vi.advanceTimersByTimeAsync(25);
    await rejected;

    const channel = { destroy: vi.fn() } as unknown as ClientChannel;
    callback?.(undefined, channel);
    expect(channel.destroy).toHaveBeenCalledOnce();
    expect(events.eventNames()).toEqual([]);
  });
});
