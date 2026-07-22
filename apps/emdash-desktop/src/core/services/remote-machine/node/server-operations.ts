import type { WireInitializeResult } from '@emdash/core/workspace-server';
import type { Scope } from '@emdash/shared/concurrency';
import { retry, retrySchedules, systemClock, type Clock } from '@emdash/shared/scheduling';
import { WorkspaceServerProtocolError } from '../../workspace-server/node/connect/protocol';
import type { WireConnectionManager } from '../../workspace-server/node/connect/wire-connection-manager';
import {
  workspaceServerLayout,
  type WorkspaceServerLayout,
} from '../../workspace-server/node/layout';
import {
  WorkspaceServerDaemonError,
  type RemoteWorkspaceServerDaemon,
} from '../../workspace-server/node/provision/daemon-control';
import type { RemoteHostProbe } from '../../workspace-server/node/provision/host-probe';
import {
  WorkspaceServerInstallError,
  type WorkspaceServerInstaller,
} from '../../workspace-server/node/provision/installer';
import { sshWorkspaceServerTarget } from '../../workspace-server/node/targets';
import type { RemoteMachineStateModel } from './state-model';

type RemoteMachineServerOperationsDeps = {
  scope: Scope;
  state: RemoteMachineStateModel;
  host: Pick<RemoteHostProbe, 'probe'>;
  installer: Pick<WorkspaceServerInstaller, 'installedVersion' | 'install'>;
  daemon: Pick<RemoteWorkspaceServerDaemon, 'start' | 'stop'>;
  wire: Pick<WireConnectionManager, 'dialOnce' | 'invalidateConnection'>;
  clock?: Clock;
};

type PendingOperation = {
  action: string;
  promise: Promise<void>;
};

const serverReadyRetrySchedule = retrySchedules.sequence([100, 250, 500, 1_000, 2_000]);

export class RemoteMachineServerOperations {
  private readonly operations = new Map<string, PendingOperation>();
  private readonly clock: Clock;

  constructor(private readonly deps: RemoteMachineServerOperationsDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  refresh(connectionId: string): Promise<void> {
    return this.serialized(connectionId, 'refresh', (signal) =>
      this.refreshUnserialized(connectionId, signal)
    );
  }

  install(connectionId: string): Promise<void> {
    return this.serialized(connectionId, 'install', async (signal) => {
      const layout = await this.resolveLayout(connectionId, signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        detail: 'Installing workspace server',
      });
      await this.deps.installer.install(connectionId, signal);
      const version = await this.deps.installer.installedVersion(connectionId, layout, signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        version,
        detail: 'Starting workspace server',
      });
      await this.deps.daemon.start(connectionId, layout, signal);
      await this.publishWhenReady(connectionId, layout, signal);
    });
  }

  start(connectionId: string): Promise<void> {
    return this.serialized(connectionId, 'start', async (signal) => {
      const { layout, version } = await this.resolveInstalled(connectionId, signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        version,
        detail: 'Starting workspace server',
      });
      await this.deps.daemon.start(connectionId, layout, signal);
      await this.publishWhenReady(connectionId, layout, signal);
    });
  }

  stop(connectionId: string): Promise<void> {
    return this.serialized(connectionId, 'stop', async (signal) => {
      const { layout, version } = await this.resolveInstalled(connectionId, signal);
      this.deps.state.set(connectionId, {
        status: 'shutting-down',
        version,
        detail: 'Shutting down workspace server',
      });
      await this.deps.wire.invalidateConnection(connectionId);
      await this.deps.daemon.stop(connectionId, layout, signal);
      this.deps.state.set(connectionId, { status: 'stopped', version });
    });
  }

  restart(connectionId: string): Promise<void> {
    return this.serialized(connectionId, 'restart', async (signal) => {
      const { layout, version } = await this.resolveInstalled(connectionId, signal);
      this.deps.state.set(connectionId, {
        status: 'shutting-down',
        version,
        detail: 'Restarting workspace server',
      });
      await this.deps.wire.invalidateConnection(connectionId);
      await this.deps.daemon.stop(connectionId, layout, signal).catch(() => {});
      this.deps.state.set(connectionId, {
        status: 'booting',
        version,
        detail: 'Restarting workspace server',
      });
      await this.deps.daemon.start(connectionId, layout, signal);
      await this.publishWhenReady(connectionId, layout, signal);
    });
  }

  update(connectionId: string): Promise<void> {
    return this.serialized(connectionId, 'update', async (signal) => {
      const layout = await this.resolveLayout(connectionId, signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        detail: 'Updating workspace server',
      });
      await this.deps.installer.install(connectionId, signal);
      const version = await this.deps.installer.installedVersion(connectionId, layout, signal);
      this.deps.state.set(connectionId, {
        status: 'shutting-down',
        version,
        detail: 'Restarting workspace server',
      });
      await this.deps.wire.invalidateConnection(connectionId);
      await this.deps.daemon.stop(connectionId, layout, signal).catch(() => {});
      this.deps.state.set(connectionId, {
        status: 'booting',
        version,
        detail: 'Restarting workspace server',
      });
      await this.deps.daemon.start(connectionId, layout, signal);
      await this.publishWhenReady(connectionId, layout, signal);
    });
  }

  private async refreshUnserialized(connectionId: string, signal: AbortSignal): Promise<void> {
    this.deps.state.remove(connectionId);
    try {
      const layout = await this.resolveLayout(connectionId, signal);
      const version = await this.deps.installer.installedVersion(connectionId, layout, signal);
      if (!version) {
        this.deps.state.set(connectionId, { status: 'not-installed' });
        return;
      }

      try {
        const handshake = await this.deps.wire.dialOnce(
          sshWorkspaceServerTarget(connectionId, layout),
          { signal }
        );
        this.publishHealthy(connectionId, handshake);
      } catch (error) {
        if (error instanceof WorkspaceServerProtocolError) {
          this.publishFailure(connectionId, error, version);
        } else {
          this.deps.state.set(connectionId, { status: 'stopped', version });
        }
      }
    } catch (error) {
      this.publishFailure(connectionId, error);
      throw error;
    }
  }

  private async resolveLayout(
    connectionId: string,
    signal: AbortSignal
  ): Promise<WorkspaceServerLayout> {
    const host = await this.deps.host.probe(connectionId, signal);
    return workspaceServerLayout(host.home);
  }

  private async resolveInstalled(
    connectionId: string,
    signal: AbortSignal
  ): Promise<{ layout: WorkspaceServerLayout; version: string }> {
    const layout = await this.resolveLayout(connectionId, signal);
    const version = await this.deps.installer.installedVersion(connectionId, layout, signal);
    if (!version) {
      this.deps.state.set(connectionId, { status: 'not-installed' });
      throw new RemoteMachineServerOperationError(
        'not-installed',
        'The workspace server is not installed'
      );
    }
    return { layout, version };
  }

  private async publishWhenReady(
    connectionId: string,
    layout: WorkspaceServerLayout,
    signal: AbortSignal
  ): Promise<void> {
    const target = sshWorkspaceServerTarget(connectionId, layout);
    const handshake = await retry(() => this.deps.wire.dialOnce(target, { signal }), {
      clock: this.clock,
      schedule: serverReadyRetrySchedule,
      signal,
      shouldRetry: (error) => !(error instanceof WorkspaceServerProtocolError),
    });
    this.publishHealthy(connectionId, handshake);
  }

  private publishHealthy(connectionId: string, handshake: WireInitializeResult): void {
    this.deps.state.set(connectionId, {
      status: 'healthy',
      version: handshake.server.appVersion,
      startedAt: handshake.server.startedAt,
    });
  }

  private publishFailure(connectionId: string, error: unknown, version?: string): void {
    const failure = operationFailure(error);
    if (failure.code === 'not-installed') return;
    this.deps.state.set(connectionId, {
      status: 'failed',
      version,
      error: failure,
    });
  }

  private serialized(
    connectionId: string,
    action: string,
    operation: (signal: AbortSignal) => Promise<void>
  ): Promise<void> {
    const existing = this.operations.get(connectionId);
    if (existing?.action === action) return existing.promise;

    const predecessor = existing?.promise.catch(() => {});
    const promise = (predecessor ?? Promise.resolve())
      .then(() => this.deps.scope.run(`${action}:${connectionId}`, operation).value())
      .catch((error: unknown) => {
        this.publishFailure(connectionId, error);
        throw error;
      })
      .finally(() => {
        if (this.operations.get(connectionId)?.promise === promise) {
          this.operations.delete(connectionId);
        }
      });
    this.operations.set(connectionId, { action, promise });
    return promise;
  }
}

class RemoteMachineServerOperationError extends Error {
  readonly name = 'RemoteMachineServerOperationError';

  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function operationFailure(error: unknown): { code: string; message: string } {
  if (error instanceof RemoteMachineServerOperationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof WorkspaceServerInstallError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof WorkspaceServerProtocolError) {
    return { code: 'protocol-incompatible', message: error.message };
  }
  if (error instanceof WorkspaceServerDaemonError) {
    return { code: 'daemon-operation-failed', message: error.message };
  }
  return {
    code: 'connection-failed',
    message: error instanceof Error ? error.message : String(error),
  };
}
