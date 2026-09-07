import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Client, ClientChannel } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { SshClientProxy } from './ssh-client-proxy';

function fakeClient() {
  let reply!: (error: Error | undefined, channel: ClientChannel) => void;
  const open = vi.fn((...args: unknown[]) => {
    reply = args.at(-1) as typeof reply;
  });
  const client = Object.assign(new EventEmitter(), {
    forwardOut: open,
    openssh_forwardOutStreamLocal: open,
    exec: open,
  });
  return {
    client: client as unknown as Client,
    open,
    complete() {
      const channel = Object.assign(new PassThrough(), { stderr: new PassThrough() });
      reply(undefined, channel as unknown as ClientChannel);
      return channel;
    },
  };
}

const operations = {
  tcp: (proxy: SshClientProxy, signal?: AbortSignal) =>
    proxy.openTcpChannel(
      {
        sourceHost: '127.0.0.1',
        sourcePort: 0,
        remoteHost: '::1',
        remotePort: 5173,
      },
      { signal }
    ),
  streamlocal: (proxy: SshClientProxy, signal?: AbortSignal) =>
    proxy.forwardOutStreamLocal('/workspace.sock', { signal }),
  exec: (proxy: SshClientProxy, signal?: AbortSignal) =>
    proxy.exec({ command: 'pwd', args: [] }, { signal }),
  execScript: (proxy: SshClientProxy, signal?: AbortSignal) => proxy.execScript('pwd', { signal }),
};

describe.each(Object.entries(operations))('%s connection lifetime', (_name, start) => {
  it.each(['caller', 'invalidate', 'replace'] as const)(
    'cancels pending acquisition on %s',
    async (cause) => {
      const old = fakeClient();
      const replacement = fakeClient();
      const proxy = new SshClientProxy('test');
      const caller = new AbortController();
      proxy.update(old.client);
      const pending = start(proxy, caller.signal);
      const rejected = expect(pending).rejects.toThrow();
      if (cause === 'caller') caller.abort();
      else if (cause === 'invalidate') proxy.invalidate();
      else proxy.update(replacement.client);
      await rejected;
      expect(old.complete().destroyed).toBe(true);
      expect(old.client.eventNames()).toEqual([]);

      // A revoked lifetime must not poison subsequent operations on the same proxy.
      if (cause !== 'replace') proxy.update(replacement.client);
      const next = start(proxy);
      const channel = replacement.complete();
      channel.emit('close', 0);
      await expect(next).resolves.toBeDefined();
      channel.destroy();
    }
  );

  it('does not start an operation whose caller has already cancelled', async () => {
    const current = fakeClient();
    const proxy = new SshClientProxy('test');
    proxy.update(current.client);
    await expect(start(proxy, AbortSignal.abort())).rejects.toThrow();
    expect(current.open).not.toHaveBeenCalled();
  });
});

describe.each(['exec', 'execScript'] as const)('%s command ownership', (name) => {
  it.each(['caller', 'invalidate', 'replace'] as const)(
    'cancels a running command on %s',
    async (cause) => {
      const current = fakeClient();
      const proxy = new SshClientProxy('test');
      const caller = new AbortController();
      proxy.update(current.client);
      const pending = operations[name](proxy, caller.signal);
      const channel = current.complete();
      const rejected = expect(pending).rejects.toThrow();
      if (cause === 'caller') caller.abort();
      else if (cause === 'invalidate') proxy.invalidate();
      else proxy.update(fakeClient().client);
      await rejected;
      expect(channel.destroyed).toBe(true);
      expect(current.client.eventNames()).toEqual([]);
    }
  );
});

describe.each(['tcp', 'streamlocal'] as const)('%s channel ownership', (name) => {
  it('leaves an acquired channel with the caller after replacement', async () => {
    const current = fakeClient();
    const proxy = new SshClientProxy('test');
    const caller = new AbortController();
    proxy.update(current.client);
    const pending = operations[name](proxy, caller.signal);
    const channel = current.complete();
    expect(await pending).toBe(channel);
    caller.abort();
    proxy.update(fakeClient().client);
    expect(channel.destroyed).toBe(false);
    channel.destroy();
  });
});
