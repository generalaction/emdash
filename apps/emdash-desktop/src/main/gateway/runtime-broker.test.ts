import { hostRef } from '@emdash/core/primitives/host/api';
import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceServerServiceHandle } from '@core/services/workspace-server/node';
import { createDesktopRuntimeBroker } from './runtime-broker';

describe('desktop runtime broker remote sessions', () => {
  it('routes remote client resolution through the workspace-server service', async () => {
    const runtimeClient = { files: { getHomeDir: vi.fn() } } as unknown as HostRuntimesClient;
    const client = vi.fn(async () => ({ client: runtimeClient }));
    const workspaceServer = {
      client,
    } as unknown as WorkspaceServerServiceHandle;
    const broker = createDesktopRuntimeBroker({} as never, workspaceServer);
    const host = hostRef('remote', 'ssh-1');

    const [firstResult, secondResult] = await Promise.all([
      broker.client(host),
      broker.client(host),
    ]);
    expect(firstResult).toEqual({ success: true, data: runtimeClient });
    expect(secondResult).toEqual({ success: true, data: runtimeClient });
    expect(client).toHaveBeenCalledTimes(2);
    expect(client).toHaveBeenCalledWith('ssh-1');
  });

  it('reports unavailable when a remote runtime connection fails', async () => {
    const broker = createDesktopRuntimeBroker(
      {} as never,
      {
        client: async () => {
          throw new Error('connection failed');
        },
      } as never
    );

    await expect(broker.client(hostRef('remote', 'ssh-1'))).resolves.toMatchObject({
      success: false,
      error: { type: 'host-unavailable', message: 'connection failed' },
    });
  });
});
