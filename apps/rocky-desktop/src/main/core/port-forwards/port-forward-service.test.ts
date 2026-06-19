import { describe, expect, it, vi } from 'vitest';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { PortForwardService } from './port-forward-service';

function fakeProxy(): Pick<SshClientProxy, 'client' | 'isConnected'> {
  return {
    isConnected: true,
    get client() {
      return {} as SshClientProxy['client'];
    },
  };
}

describe('PortForwardService', () => {
  it('deduplicates opens by id and closes the tunnel once', async () => {
    const close = vi.fn();
    const service = new PortForwardService({
      openTunnel: vi.fn(async () => ({ localPort: 6100, close })),
    });

    const first = await service.open({
      id: 'forward-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
      proxy: fakeProxy(),
      remotePort: 5173,
    });
    const second = await service.open({
      id: 'forward-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
      proxy: fakeProxy(),
      remotePort: 5173,
    });

    expect(second).toEqual(first);

    await service.stop('forward-1');
    await service.stop('forward-1');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stops only tunnels owned by the requested workspace', async () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const service = new PortForwardService({
      openTunnel: vi
        .fn()
        .mockResolvedValueOnce({ localPort: 6100, close: closeFirst })
        .mockResolvedValueOnce({ localPort: 6101, close: closeSecond }),
    });

    await service.open({
      id: 'forward-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
      proxy: fakeProxy(),
      remotePort: 5173,
    });
    await service.open({
      id: 'forward-2',
      projectId: 'project-1',
      workspaceId: 'workspace-2',
      connectionId: 'ssh-1',
      proxy: fakeProxy(),
      remotePort: 5174,
    });

    await service.stopForWorkspace('project-1', 'workspace-1');

    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(closeSecond).not.toHaveBeenCalled();
  });
});
