import type { Command } from '@emdash/core/primitives/exec/api';
import { hostRef } from '@emdash/core/primitives/host/api';
import { joinAbsolute, parsePortableRelativePath } from '@emdash/core/primitives/path/api';
import { fileSearchContract } from '@emdash/core/runtimes/file-search/api';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import { createLiveJobReplicaCache } from '@emdash/wire/live';
import type { ConnectConfig } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { createRemoteMachineService } from '@core/services/hosts/node';
import { workspaceServerLayout } from '@core/services/hosts/node/workspace-server/layout';
import { SshConnectionManager } from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import { createDesktopRuntimeBroker } from './runtime-broker';

const remoteTestEnabled = process.env['EMDASH_TEST_REMOTE_WSS'] === '1';
const defaultRemoteInstallBaseUrl = 'http://minio:9000/emdash-releases/workspace-server';
const defaultPublishedVersionUrl =
  'http://localhost:9000/emdash-releases/workspace-server/latest.txt';

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
    const installBaseUrl =
      process.env['EMDASH_TEST_REMOTE_WSS_INSTALL_BASE_URL'] ?? defaultRemoteInstallBaseUrl;
    const expectedVersion = await readPublishedVersion(
      process.env['EMDASH_TEST_REMOTE_WSS_LATEST_URL'] ?? defaultPublishedVersionUrl
    );
    const remoteMachine = createRemoteMachineService({
      scope,
      ssh: {
        manager,
        connect: { ensureConnected: connect },
      },
      machineEvents: { on: () => () => {} },
      installBaseUrl,
    });
    const broker = createDesktopRuntimeBroker({} as never, remoteMachine);
    const layout = workspaceServerLayout('/home/devuser');
    const invalidations: unknown[] = [];
    remoteMachine.onInvalidate((event) => invalidations.push(event));

    const host = hostRef('remote', connectionId);
    try {
      await connect();
      const bootstrapProxy = manager.getProxy(connectionId);
      if (!bootstrapProxy) throw new Error('Docker SSH proxy did not connect');
      await resetManagedRoot(bootstrapProxy, layout);

      const resolved = await broker.client(host);
      if (!resolved.success) throw new Error(resolved.error.message);
      const homeDirectory = await resolved.data.files.getHomeDir(undefined);
      expect(homeDirectory).toMatchObject({
        root: { kind: 'posix' },
        segments: ['home', 'devuser'],
      });
      const smokeDirectory = parsePortableRelativePath(`emdash-ripgrep-smoke-${Date.now()}`);
      if (!smokeDirectory.success) {
        throw new Error('Could not construct workspace-server ripgrep smoke-test directory');
      }
      const smokeFile = parsePortableRelativePath(`${smokeDirectory.data}/needle.txt`);
      const smokeRoot = joinAbsolute(homeDirectory, smokeDirectory.data);
      if (!smokeFile.success || !smokeRoot.success) {
        throw new Error('Could not construct workspace-server ripgrep smoke-test paths');
      }

      let searchRootRegistered = false;
      const contentJobs = createLiveJobReplicaCache(
        fileSearchContract.searchContent,
        resolved.data.fileSearch.searchContent
      );
      try {
        await expect(
          resolved.data.files.mutations.createDirectory({
            root: homeDirectory,
            path: smokeDirectory.data,
          })
        ).resolves.toMatchObject({ success: true });
        await expect(
          resolved.data.files.mutations.createFile({
            root: homeDirectory,
            path: smokeFile.data,
            content: 'bundled-ripgrep-smoke\n',
          })
        ).resolves.toMatchObject({ success: true });
        await expect(
          resolved.data.fileSearch.registerRoot({ root: smokeRoot.data })
        ).resolves.toMatchObject({ success: true });
        searchRootRegistered = true;

        const lease = await contentJobs.start({
          root: smokeRoot.data,
          query: 'bundled-ripgrep-smoke',
        });
        const handle = await lease.ready();
        await expect(handle.result).resolves.toMatchObject({
          complete: true,
          files: [{ path: 'needle.txt' }],
        });
        await lease.release();
      } finally {
        await contentJobs.dispose();
        if (searchRootRegistered) {
          await resolved.data.fileSearch.unregisterRoot({ root: smokeRoot.data });
        }
        await resolved.data.files.mutations.delete({
          root: homeDirectory,
          path: smokeDirectory.data,
          recursive: true,
        });
      }

      const connection = await remoteMachine.client(connectionId);
      expect(connection.target).toMatchObject({ socketPath: layout.socketPath });
      expect(connection.currentHandshake()?.server.appVersion).toBe(expectedVersion);
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
      const proxy = await manager
        .createConnection(connectionId, async () => ({
          config: connectConfig,
          cleanup: () => {},
          debugLogs: [],
        }))
        .catch(() => undefined);
      if (proxy) await stopDaemon(proxy, layout).catch(() => {});
      await remoteMachine.dispose();
      await manager.disconnectAll();
      await scope.dispose();
    }
  }, 120_000);
});

type ExecProxy = {
  exec(command: Command): Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

async function resetManagedRoot(
  proxy: ExecProxy,
  layout: ReturnType<typeof workspaceServerLayout>
): Promise<void> {
  await proxy
    .exec({
      command: layout.currentLauncher,
      args: ['stop', '--socket', layout.socketPath],
    })
    .catch(() => undefined);
  const result = await proxy.exec({ command: 'rm', args: ['-rf', '--', layout.root] });
  if (result.exitCode !== 0) {
    throw new Error(`Could not reset Docker workspace-server root: ${result.stderr}`);
  }
}

async function stopDaemon(
  proxy: ExecProxy,
  layout: ReturnType<typeof workspaceServerLayout>
): Promise<void> {
  const result = await proxy.exec({
    command: layout.currentLauncher,
    args: ['stop', '--socket', layout.socketPath],
  });
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

async function readPublishedVersion(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not read workspace-server latest.txt from ${url} (HTTP ${response.status})`
    );
  }
  const version = (await response.text()).trim();
  if (version.length === 0) {
    throw new Error(`workspace-server latest.txt from ${url} was empty`);
  }
  return version;
}
