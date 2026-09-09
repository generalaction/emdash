import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import type { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';
import { PortForwardService } from './port-forward-service';
import type { OpenPortForwardTunnelOptions, PortForwardTunnel } from './port-forward-tunnel';

function fakeProxy(): Pick<SshClientProxy, 'openTcpChannel' | 'isConnected'> {
  return {
    isConnected: true,
    async openTcpChannel() {
      throw new Error('Unused by this test');
    },
  };
}

describe('PortForwardService', () => {
  it('coalesces pending opens, cancels on stop, and closes a late tunnel', async () => {
    const pending = deferred<PortForwardTunnel>();
    let options!: OpenPortForwardTunnelOptions;
    const openTunnel = vi.fn((next: OpenPortForwardTunnelOptions) => {
      options = next;
      return pending.promise;
    });
    const errors = vi.fn();
    const service = new PortForwardService({ openTunnel, onConnectionError: errors });
    const request = {
      id: 'pending',
      projectId: 'p',
      workspaceId: 'w',
      connectionId: 'ssh',
      proxy: fakeProxy(),
      remotePort: 5173,
    };
    const first = service.open(request);
    const second = service.open(request);
    const rejected = Promise.all([
      expect(first).rejects.toThrow(),
      expect(second).rejects.toThrow(),
    ]);
    await Promise.resolve();
    expect(openTunnel).toHaveBeenCalledOnce();
    await service.stopForWorkspace('p', 'w');
    await rejected;
    expect(options.signal?.aborted).toBe(true);

    const replacementClose = vi.fn();
    openTunnel.mockImplementation(async () => ({ localPort: 6200, close: replacementClose }));
    await service.open(request);
    options.onConnectionError?.(new Error('stale'));
    expect(errors).not.toHaveBeenCalled();
    const close = vi.fn();
    pending.resolve({ localPort: 6100, close });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(close).toHaveBeenCalledOnce();
    expect(replacementClose).not.toHaveBeenCalled();
    await service.stop('pending');
    expect(replacementClose).toHaveBeenCalledOnce();
  });

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
