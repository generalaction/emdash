import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Client, ClientChannel } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';
import { openSshWorkspaceServerTransport } from './ssh-streamlocal-transport';

describe('openSshWorkspaceServerTransport', () => {
  it('uses the current managed proxy and owns the returned channel', async () => {
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
    const ensureProxy = vi.fn(async () => proxy);

    const transport = await openSshWorkspaceServerTransport(
      {
        kind: 'ssh',
        sshConnectionId: 'ssh-1',
        socketPath: '/home/devuser/.emdash/workspace-server/run/workspace.sock',
      },
      { ensureProxy }
    );
    transport.close?.();
    transport.close?.();

    expect(ensureProxy).toHaveBeenCalledWith('ssh-1');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
