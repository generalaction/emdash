import path from 'node:path';
import { hostRef } from '@emdash/core/primitives/host/api';
import { hostFileRef, parseAbsolute, type HostFileRef } from '@emdash/core/primitives/path/api';
import { workspaceContract } from '@emdash/core/runtimes/workspace/api';
import { step } from '@emdash/core/runtimes/workspace/api/provisioning';
import { retrySchedules } from '@emdash/shared/scheduling';
import { deferred, waitFor } from '@emdash/shared/testing';
import { createLiveJobReplica } from '@emdash/wire';
import type { Client, ConnectConfig } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { SshConnectionManager } from '@main/core/ssh/lifecycle/ssh-connection-manager';
import { quoteShellArg } from '@main/lib/shellEscape';
import { createWorkspaceServerClientSource } from './workspace-server-client-source';

const remoteTestEnabled = process.env['EMDASH_TEST_REMOTE_WSS'] === '1';

describe.skipIf(!remoteTestEnabled)('workspace server client over Docker SSH', () => {
  it(
    'survives SSH reconnect and reinitializes after a daemon restart',
    { timeout: 90_000 },
    async () => {
      const config = loadRemoteTestConfig();
      const manager = createRemoteTestConnectionManager(config.ssh);
      const source = createWorkspaceServerClientSource({
        idleTtlMs: 0,
        retrySchedule: retrySchedules.sequence([50, 100, 250], { repeatLast: true }),
        sshConnectionManager: manager,
      });
      const target = {
        kind: 'ssh' as const,
        sshConnectionId: config.connectionId,
        socketPath: config.socketPath,
      };
      const bootstrapProxy = await manager.connect(config.connectionId);
      await execRemote(bootstrapProxy.client, launcherPreflightCommand(config));
      await execRemote(bootstrapProxy.client, daemonCommand(config, 'start'));
      const lease = source.acquire(target);
      let detachState: (() => void) | undefined;
      let releaseJob: (() => Promise<void>) | undefined;
      let disposeJobs: (() => Promise<void>) | undefined;

      try {
        const workspaceServer = await lease.ready();
        const initialHandshake = workspaceServer.currentHandshake();
        if (!initialHandshake) throw new Error('Expected an initialized workspace-server client');
        await expect(workspaceServer.client.health(undefined)).resolves.toMatchObject({
          status: 'ok',
          version: initialHandshake.server.appVersion,
        });

        const proxy = await manager.connect(config.connectionId);
        await execRemote(proxy.client, `rm -rf -- ${quoteShellArg(config.workspacePath)}`);
        const workspace = remoteWorkspaceRef(config.connectionId, config.workspacePath);
        await expect(
          workspaceServer.client.workspace.reconcile({ workspace })
        ).resolves.toMatchObject({ success: true });

        const state = workspaceServer.client.workspace.workspace.state(workspace, 'state');
        let reattachCount = 0;
        detachState = await state.attach(() => {}, {
          onReattach: () => {
            reattachCount += 1;
          },
        });

        const jobs = createLiveJobReplica(
          workspaceContract.provision,
          workspaceServer.client.workspace.provision
        );
        disposeJobs = () => jobs.dispose();
        const jobLease = await jobs.start({
          workspace,
          lifecycle: {
            ref: {
              kind: 'directory',
              path: config.workspacePath,
              setupConfigHash: 'ssh-reconnect-smoke-v1',
            },
            context: { repoPath: config.workspacePath, preservePatterns: [] },
            setupPlan: {
              steps: [
                {
                  id: 'create-directory:1',
                  label: 'Create remote workspace',
                  step: step('create-directory', { path: config.workspacePath }),
                },
                {
                  id: 'run-script:1',
                  label: 'Hold job across SSH reconnect',
                  step: step('run-script', {
                    id: 'ssh-reconnect-smoke',
                    command: '/usr/bin/sleep 15; /usr/bin/printf docker-ok > .emdash-ssh-smoke',
                    cwd: 'worktree',
                  }),
                },
              ],
            },
          },
        });
        releaseJob = jobLease.release;
        const job = await jobLease.ready();
        const initialJobState = job.getState();
        if (initialJobState?.status !== 'running') {
          throw new Error(`Expected running remote job: ${JSON.stringify(initialJobState)}`);
        }

        const sshDisconnect = deferred<void>();
        const stopWatchingSshDisconnect = workspaceServer.connection.onDisconnect(() =>
          sshDisconnect.resolve()
        );
        proxy.client.destroy();
        await sshDisconnect.promise;
        stopWatchingSshDisconnect();
        const afterSshReconnect = await workspaceServer.ready();
        expect(afterSshReconnect.server.daemonId).toBe(initialHandshake.server.daemonId);
        await waitFor(() => reattachCount >= 1, { timeoutMs: 10_000 });
        await expect(job.result).resolves.toMatchObject({ workspace });
        await expect(
          execRemote(
            (await manager.connect(config.connectionId)).client,
            `/usr/bin/cat -- ${quoteShellArg(`${config.workspacePath}/.emdash-ssh-smoke`)}`
          )
        ).resolves.toContain('docker-ok');

        const daemonDisconnect = deferred<void>();
        const stopWatchingDaemonDisconnect = workspaceServer.connection.onDisconnect(() =>
          daemonDisconnect.resolve()
        );
        await execRemote(
          (await manager.connect(config.connectionId)).client,
          daemonCommand(config, 'stop')
        );
        await daemonDisconnect.promise;
        stopWatchingDaemonDisconnect();
        const afterDaemonRestart = workspaceServer.ready();
        await execRemote(
          (await manager.connect(config.connectionId)).client,
          daemonCommand(config, 'start')
        );
        const restartedHandshake = await afterDaemonRestart;
        expect(restartedHandshake.server.daemonId).not.toBe(initialHandshake.server.daemonId);
        await waitFor(() => reattachCount >= 2, { timeoutMs: 10_000 });
        await expect(
          workspaceServer.client.workspace.reconcile({ workspace })
        ).resolves.toMatchObject({ success: true });
      } finally {
        detachState?.();
        await releaseJob?.();
        await disposeJobs?.();
        await lease.release();
        await source.dispose();

        const proxy = await manager.connect(config.connectionId).catch(() => undefined);
        if (proxy) {
          await execRemote(proxy.client, daemonCommand(config, 'stop')).catch(() => {});
          await execRemote(proxy.client, `rm -rf -- ${quoteShellArg(config.workspacePath)}`).catch(
            () => {}
          );
        }
        await manager.disconnectAll();
      }
    }
  );
});

type RemoteTestConfig = {
  connectionId: string;
  socketPath: string;
  workspacePath: string;
  serverLauncher: string;
  ssh: ConnectConfig;
};

function loadRemoteTestConfig(): RemoteTestConfig {
  const testRoot = '/home/devuser/.emdash-workspace-server-test';
  if (
    !path.posix.isAbsolute(testRoot) ||
    path.posix.basename(testRoot) !== '.emdash-workspace-server-test'
  ) {
    throw new Error('Remote test root must be an absolute .emdash-workspace-server-test directory');
  }
  const workspacePath = path.posix.join(testRoot, 'workspaces/ssh-reconnect-smoke');

  return {
    connectionId: 'docker-workspace-server-smoke',
    socketPath: `${testRoot}/run/workspace.sock`,
    workspacePath,
    serverLauncher:
      '/home/devuser/.local/share/emdash/workspace-server/current/bin/emdash-workspace-server',
    ssh: {
      host: '127.0.0.1',
      port: 2223,
      username: 'devuser',
      password: 'devpass',
      readyTimeout: 10_000,
      keepaliveInterval: 1_000,
      keepaliveCountMax: 3,
    },
  };
}

function createRemoteTestConnectionManager(ssh: ConnectConfig): SshConnectionManager {
  return new SshConnectionManager({
    loadConnectionRow: async () => ({ id: 'docker-workspace-server-smoke' }) as never,
    resolveConnectConfig: async () => ({
      config: ssh,
      cleanup: () => {},
      debugLogs: [],
    }),
  });
}

function remoteWorkspaceRef(connectionId: string, workspacePath: string): HostFileRef {
  const parsed = parseAbsolute(workspacePath);
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(hostRef('remote', connectionId), parsed.data);
}

function daemonCommand(config: RemoteTestConfig, command: 'start' | 'stop'): string {
  return [
    quoteShellArg(config.serverLauncher),
    command,
    '--socket-path',
    quoteShellArg(config.socketPath),
  ].join(' ');
}

function launcherPreflightCommand(config: RemoteTestConfig): string {
  const message =
    'Workspace-server launcher is missing. Build the matching Linux artifact, then recreate ' +
    'the Docker remote with WORKSPACE_SERVER_PREINSTALL=1.';
  return [
    `if [ ! -x ${quoteShellArg(config.serverLauncher)} ]; then`,
    `printf '%s\\n' ${quoteShellArg(message)} >&2;`,
    'exit 1;',
    'fi',
  ].join(' ');
}

function execRemote(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, channel) => {
      if (error) {
        reject(error);
        return;
      }
      let stdout = '';
      let stderr = '';
      channel.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      channel.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      channel.once('error', reject);
      channel.once('close', (code: number | undefined) => {
        if (code && code !== 0) {
          reject(new Error(`Remote command exited ${code}: ${stderr.trim()}`));
          return;
        }
        resolve(stdout);
      });
    });
  });
}
