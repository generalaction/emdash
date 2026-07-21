import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Command } from '@emdash/core/primitives/exec/api';
import { hostRef } from '@emdash/core/primitives/host/api';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import type { ConnectConfig } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { createRemoteMachineService } from '@core/services/remote-machine/node';
import { SshConnectionManager } from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import { createDesktopRuntimeBroker } from '@main/gateway/runtime-broker';
import { workspaceServerLayout } from './layout';

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
    const latestPointer = resolve(
      __dirname,
      '../../../../../../workspace-server/dist-artifacts/latest.txt'
    );
    const installScriptTarget = resolve(
      __dirname,
      '../../../../../../workspace-server/dist-artifacts/install.sh'
    );
    const [previousLatest, previousInstallScript, installScript] = await Promise.all([
      readOptionalFile(latestPointer),
      readOptionalFile(installScriptTarget),
      readFile(resolve(__dirname, '../../../../../../workspace-server/install.sh'), 'utf8'),
    ]);
    const packageMetadata = JSON.parse(
      await readFile(resolve(__dirname, '../../../../../../workspace-server/package.json'), 'utf8')
    ) as { version: string };
    await Promise.all([
      writeFile(latestPointer, `${packageMetadata.version}\n`, 'utf8'),
      writeFile(installScriptTarget, installScript, 'utf8'),
    ]);
    const remoteMachine = createRemoteMachineService({
      scope,
      ssh: {
        manager,
        connect: { connect },
      },
      machineEvents: { on: () => () => {} },
      installBaseUrl: 'file:///opt/emdash-artifacts',
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
      await expect(resolved.data.files.getHomeDir(undefined)).resolves.toMatchObject({
        root: { kind: 'posix' },
        segments: ['home', 'devuser'],
      });

      const connection = await remoteMachine.client(connectionId);
      expect(connection.target).toMatchObject({ socketPath: layout.socketPath });
      expect(connection.currentHandshake()?.server.appVersion).toBe(packageMetadata.version);
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
      await Promise.all([
        restoreOptionalFile(latestPointer, previousLatest),
        restoreOptionalFile(installScriptTarget, previousInstallScript),
      ]);
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

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function restoreOptionalFile(path: string, contents: string | undefined): Promise<void> {
  if (contents === undefined) {
    await rm(path, { force: true });
    return;
  }
  await writeFile(path, contents, 'utf8');
}
