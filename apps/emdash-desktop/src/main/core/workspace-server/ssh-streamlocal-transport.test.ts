import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Client, ClientChannel } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { openSshWorkspaceServerTransport } from './ssh-streamlocal-transport';

describe('openSshWorkspaceServerTransport', () => {
  it('connects through the managed SSH proxy and owns the returned channel', async () => {
    const channel = new PassThrough() as unknown as ClientChannel;
    const destroy = vi.spyOn(channel, 'destroy');
    const client = Object.assign(new EventEmitter(), {
      openssh_forwardOutStreamLocal: (
        _socketPath: string,
        callback: (error: Error | undefined, value: ClientChannel) => void
      ) => callback(undefined, channel),
    }) as unknown as Client;
    const proxy = new SshClientProxy('ssh-1');
    proxy.update(client);
    const connect = vi.fn(async () => proxy);

    const transport = await openSshWorkspaceServerTransport(
      {
        kind: 'ssh',
        sshConnectionId: 'ssh-1',
        socketPath: '/root/.emdash/workspace-server/run/workspace.sock',
      },
      { connect }
    );
    transport.close?.();
    transport.close?.();

    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith('ssh-1');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
