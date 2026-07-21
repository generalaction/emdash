import { resolve } from 'node:path';
import { hostRef } from '@emdash/core/primitives/host/api';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import type { ConnectConfig } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { SshConnectionManager } from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import { escapeShellArg } from '@core/services/ssh/node/shell-quoting';
import { createDesktopRuntimeBroker } from '@main/gateway/runtime-broker';
import { createWorkspaceServerService } from './factory';
import { workspaceServerLayout } from './layout';
import { createRemoteFileWorkspaceServerArtifactSource } from './provision/artifact-source';
import { DESIRED_WORKSPACE_SERVER_VERSION } from './provision/desired-version';

const remoteTestEnabled = process.env['EMDASH_TEST_REMOTE_WSS'] === '1';

describe.skipIf(!remoteTestEnabled)('workspace-server cold install over Docker SSH', () => {
  it('installs, resolves a runtime, and preserves the session across an SSH reconnect', async () => {
    const connectionId = 'docker-workspace-server-smoke';
    const scope = createScope({ label: 'workspace-server-docker-test' });
    const manager = new SshConnectionManager();
    const connectConfig: ConnectConfig = {
      host: '127.0.0.1',
      port: 2223,
      username: 'devuser',
      password: 'devpass',
      readyTimeout: 10_000,
      keepaliveInterval: 1_000,
      keepaliveCountMax: 3,
    };
    const connect = async () => {
      await manager.createConnection(connectionId, async () => ({
        config: connectConfig,
        cleanup: () => {},
        debugLogs: [],
      }));
      return manager.getConnectionState(connectionId);
    };
    const workspaceServer = createWorkspaceServerService({
      scope,
      ssh: {
        manager,
        ssh: { connect },
        machines: { on: () => () => {} },
      },
      artifacts: createRemoteFileWorkspaceServerArtifactSource({
        localDirectory: resolve(__dirname, '../../../../../../workspace-server/dist-artifacts'),
        remoteDirectory: '/opt/emdash-artifacts',
      }),
    });
    const broker = createDesktopRuntimeBroker(scope, workspaceServer);
    const layout = workspaceServerLayout('/home/devuser');
    const invalidations: unknown[] = [];
    workspaceServer.onInvalidate((event) => invalidations.push(event));

    await connect();
    const bootstrapProxy = manager.getProxy(connectionId);
    if (!bootstrapProxy) throw new Error('Docker SSH proxy did not connect');
    await resetManagedRoot(bootstrapProxy, layout);

    const host = hostRef('remote', connectionId);
    const lease = broker.session(host);
    let directLease: Awaited<ReturnType<typeof workspaceServer.acquireConnection>> | undefined;
    try {
      const resolved = await lease.ready();
      if (!resolved.success) throw new Error(resolved.error.message);
      await expect(resolved.data.files.getHomeDir(undefined)).resolves.toMatchObject({
        root: { kind: 'posix' },
        segments: ['home', 'devuser'],
      });

      directLease = await workspaceServer.acquireConnection(connectionId);
      const connection = await directLease.ready();
      expect(connection.target).toMatchObject({ socketPath: layout.socketPath });
      expect(connection.currentHandshake()?.server.appVersion).toBe(
        DESIRED_WORKSPACE_SERVER_VERSION
      );
      const disconnected = deferred<void>();
      const stopWatchingDisconnect = connection.connection.onDisconnect(() =>
        disconnected.resolve()
      );
      const daemonId = connection.currentHandshake()?.server.daemonId;
      manager.getProxy(connectionId)?.client.destroy();
      await disconnected.promise;
      stopWatchingDisconnect();

      await expect(connection.ready()).resolves.toMatchObject({ server: { daemonId } });
      await expect(resolved.data.files.getHomeDir(undefined)).resolves.toMatchObject({
        root: { kind: 'posix' },
        segments: ['home', 'devuser'],
      });
      expect(invalidations).toEqual([]);
    } finally {
      await directLease?.release();
      await lease.release();
      const proxy = await manager
        .createConnection(connectionId, async () => ({
          config: connectConfig,
          cleanup: () => {},
          debugLogs: [],
        }))
        .catch(() => undefined);
      if (proxy) await stopDaemon(proxy, layout).catch(() => {});
      await broker.dispose();
      await workspaceServer.dispose();
      await manager.disconnectAll();
      await scope.dispose();
    }
  }, 120_000);
});

type ExecProxy = {
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

async function resetManagedRoot(
  proxy: ExecProxy,
  layout: ReturnType<typeof workspaceServerLayout>
): Promise<void> {
  const command = [
    `if [ -x ${escapeShellArg(layout.currentLauncher)} ]; then`,
    `${escapeShellArg(layout.currentLauncher)} stop --socket ${escapeShellArg(layout.socketPath)} || true;`,
    'fi;',
    `rm -rf -- ${escapeShellArg(layout.root)}`,
  ].join(' ');
  const result = await proxy.exec(command);
  if (result.exitCode !== 0) {
    throw new Error(`Could not reset Docker workspace-server root: ${result.stderr}`);
  }
}

async function stopDaemon(
  proxy: ExecProxy,
  layout: ReturnType<typeof workspaceServerLayout>
): Promise<void> {
  const result = await proxy.exec(
    `${escapeShellArg(layout.currentLauncher)} stop --socket ${escapeShellArg(layout.socketPath)}`
  );
  if (result.exitCode !== 0) throw new Error(result.stderr);
}
