import { hostRef } from '@emdash/core/primitives/host/api';
import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceServerServiceHandle } from '@core/services/workspace-server/node';
import { createDesktopRuntimeBroker } from './runtime-broker';

describe('desktop runtime broker remote sessions', () => {
  it('ensures a target and owns exactly one long-lived workspace-server lease', async () => {
    const scope = createScope({ label: 'runtime-broker-test' });
    const runtimeClient = { files: { getHomeDir: vi.fn() } } as unknown as HostRuntimesClient;
    const releaseConnection = vi.fn(async () => {});
    const acquireConnection = vi.fn(async () => ({
      ready: async () => ({ client: runtimeClient }),
      release: releaseConnection,
    }));
    const workspaceServer = {
      acquireConnection,
      onInvalidate: () => () => {},
    } as unknown as WorkspaceServerServiceHandle;
    const broker = createDesktopRuntimeBroker(scope, {} as never, workspaceServer);
    const host = hostRef('remote', 'ssh-1');
    const first = broker.session(host);
    const second = broker.session(host);

    const [firstResult, secondResult] = await Promise.all([first.ready(), second.ready()]);
    expect(firstResult).toEqual({ success: true, data: runtimeClient });
    expect(secondResult).toEqual({ success: true, data: runtimeClient });
    expect(acquireConnection).toHaveBeenCalledOnce();
    expect(acquireConnection).toHaveBeenCalledWith('ssh-1');

    await first.release();
    await second.release();
    expect(releaseConnection).not.toHaveBeenCalled();
    await broker.dispose();
    expect(releaseConnection).toHaveBeenCalledOnce();
    await scope.dispose();
  });

  it('reports unavailable when a remote runtime connection fails', async () => {
    const scope = createScope({ label: 'runtime-broker-unavailable-test' });
    const broker = createDesktopRuntimeBroker(
      scope,
      {} as never,
      {
        acquireConnection: async () => {
          throw new Error('connection failed');
        },
        onInvalidate: () => () => {},
      } as never
    );
    const lease = broker.session(hostRef('remote', 'ssh-1'));

    await expect(lease.ready()).resolves.toMatchObject({
      success: false,
      error: { type: 'host-unavailable', message: 'connection failed' },
    });

    await lease.release();
    await broker.dispose();
    await scope.dispose();
  });
});
