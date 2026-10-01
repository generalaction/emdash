import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { SshClientProxy } from '@core/primitives/ssh/api/node/ssh-client-proxy';
import { openSshWorkspaceServerTransport } from './ssh-streamlocal-transport';

describe('openSshWorkspaceServerTransport', () => {
  it('uses the current managed proxy and owns the returned channel', async () => {
    const channel = new PassThrough();
    const destroy = vi.spyOn(channel, 'destroy');
    const openStream = vi.fn<SshClientProxy['openStream']>().mockResolvedValue(channel);
    const proxy = { openStream } as Pick<SshClientProxy, 'openStream'> as SshClientProxy;
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
    expect(openStream).toHaveBeenCalledWith(
      expect.objectContaining({ command: '/home/devuser/.emdash/workspace-server/current/node' }),
      undefined
    );
    expect(destroy).toHaveBeenCalledOnce();
  });
});
