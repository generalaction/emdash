import { isNewerRelease, type WireInitializeResult } from '@emdash/core/workspace-server';
import { ok, err, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { throwIfAborted } from '@emdash/shared/scheduling';
import {
  retry,
  retrySchedules,
  runWithTimeout,
  systemClock,
  type Clock,
} from '@emdash/shared/scheduling';
import { cell, derived, snapshot, type Readable } from '@emdash/wire/state';
import type { HostServerState } from '../api/contract';
import type { HostWorkspaceServer } from '../api/node/host-workspace-server';
import type { HostStateModel } from './state-model';
import { WorkspaceServerProtocolError } from './workspace-server/connect/protocol';
import type { WorkspaceServerDialer } from './workspace-server/connect/wire-connection-manager';
import { workspaceServerLayout, type WorkspaceServerLayout } from './workspace-server/layout';
import {
  WorkspaceServerDaemonError,
  type RemoteWorkspaceServerDaemon,
} from './workspace-server/provision/daemon-control';
import {
  WINDOWS_SSH_UNSUPPORTED_MESSAGE,
  type RemoteHostProbe,
} from './workspace-server/provision/host-probe';
import {
  WorkspaceServerInstallError,
  type WorkspaceServerInstaller,
} from './workspace-server/provision/installer';
import { sshWorkspaceServerTarget } from './workspace-server/targets';

export type HostServerAction =
  | 'refresh'
  | 'refresh:force'
  | 'install'
  | 'start'
  | 'stop'
  | 'restart'
  | 'update';

/** Captured before queueing: an operation never migrates to a replacement Host identity. */
export type HostServerOperationOwner = {
  scope: Scope;
  before(action: HostServerAction, signal: AbortSignal): Promise<void>;
  settled(action: HostServerAction, result: Result<void, unknown>): void;
};

type HostWorkspaceServerDeps = {
  connectionId: string;
  scope: Scope;
  owner?(): HostServerOperationOwner;
  state: Pick<HostStateModel, 'get' | 'set' | 'runtime'>;
  host: Pick<RemoteHostProbe, 'probe'>;
  installer: Pick<WorkspaceServerInstaller, 'availableVersion' | 'installedVersion' | 'install'>;
  daemon: Pick<RemoteWorkspaceServerDaemon, 'start' | 'stop'>;
  wire: Pick<WorkspaceServerDialer, 'dialOnce' | 'invalidateConnection'>;
  /** Cached provisioned targets; dropped whenever an operation changes daemon state. */
  provision: { drop(): void };
  clock?: Clock;
};

type PendingOperation = {
  action: HostServerAction;
  scope: Scope;
  promise: Promise<void>;
};

type RefreshOptions = {
  force?: boolean;
};

type LatestVersionCacheEntry = {
  version: string;
  checkedAt: number;
};

const serverReadyRetrySchedule = retrySchedules.sequence([100, 250, 500, 1_000, 2_000]);
const latestVersionCacheTtlMs = 5 * 60_000;

export class RemoteHostWorkspaceServer implements HostWorkspaceServer {
  readonly state: Readable<HostServerState | undefined>;
  private operation: PendingOperation | undefined;
  private latestVersion: LatestVersionCacheEntry | undefined;
  private readonly clock: Clock;

  constructor(private readonly deps: HostWorkspaceServerDeps) {
    this.clock = deps.clock ?? systemClock;
    const active = cell(!deps.scope.disposed);
    this.state = derived(() =>
      snapshot(active).value ? snapshot(deps.state.runtime).value[deps.connectionId] : undefined
    ) as Readable<HostServerState | undefined>;
    deps.scope.add(() => {
      active.set(false);
    });
  }

  refresh(options: RefreshOptions = {}): Promise<void> {
    const connectionId = this.deps.connectionId;
    const action = options.force ? 'refresh:force' : 'refresh';
    return this.serialized(connectionId, action, (signal) =>
      this.refreshUnserialized(connectionId, signal, options)
    );
  }

  install(): Promise<void> {
    const connectionId = this.deps.connectionId;
    return this.serialized(connectionId, 'install', async (signal) => {
      this.deps.provision.drop();
      const layout = await this.resolveLayout(signal);
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        detail: 'Installing workspace server',
      });
      await this.deps.installer.install({ connectionId, layout, signal });
      throwIfAborted(signal);
      const version = await this.deps.installer.installedVersion(connectionId, layout, signal);
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        version,
        detail: 'Starting workspace server',
      });
      await this.deps.daemon.start(connectionId, layout, signal);
      throwIfAborted(signal);
      await this.publishWhenReady(connectionId, layout, signal);
      throwIfAborted(signal);
    });
  }

  start(): Promise<void> {
    const connectionId = this.deps.connectionId;
    return this.serialized(connectionId, 'start', async (signal) => {
      this.deps.provision.drop();
      const { layout, version } = await this.resolveInstalled(connectionId, signal);
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        version,
        detail: 'Starting workspace server',
      });
      await this.deps.daemon.start(connectionId, layout, signal);
      throwIfAborted(signal);
      await this.publishWhenReady(connectionId, layout, signal);
      throwIfAborted(signal);
    });
  }

  stop(): Promise<void> {
    const connectionId = this.deps.connectionId;
    return this.serialized(connectionId, 'stop', async (signal) => {
      this.deps.provision.drop();
      const { layout, version } = await this.resolveInstalled(connectionId, signal);
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'shutting-down',
        version,
        detail: 'Shutting down workspace server',
      });
      await this.deps.wire.invalidateConnection(connectionId);
      throwIfAborted(signal);
      await this.deps.daemon.stop(connectionId, layout, signal);
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'stopped',
        version,
        ...latestVersionState(this.cachedLatestVersion(), version),
      });
    });
  }

  restart(): Promise<void> {
    const connectionId = this.deps.connectionId;
    return this.serialized(connectionId, 'restart', async (signal) => {
      this.deps.provision.drop();
      const { layout, version } = await this.resolveInstalled(connectionId, signal);
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'shutting-down',
        version,
        detail: 'Restarting workspace server',
      });
      await this.deps.wire.invalidateConnection(connectionId);
      throwIfAborted(signal);
      await this.deps.daemon.stop(connectionId, layout, signal).catch(() => {});
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        version,
        detail: 'Restarting workspace server',
      });
      await this.deps.daemon.start(connectionId, layout, signal);
      throwIfAborted(signal);
      await this.publishWhenReady(connectionId, layout, signal);
      throwIfAborted(signal);
    });
  }

  update(): Promise<void> {
    const connectionId = this.deps.connectionId;
    return this.serialized(connectionId, 'update', async (signal) => {
      this.deps.provision.drop();
      const layout = await this.resolveLayout(signal);
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        detail: 'Updating workspace server',
      });
      await this.deps.installer.install({ connectionId, layout, signal });
      throwIfAborted(signal);
      const version = await this.deps.installer.installedVersion(connectionId, layout, signal);
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'shutting-down',
        version,
        detail: 'Restarting workspace server',
      });
      await this.deps.wire.invalidateConnection(connectionId);
      throwIfAborted(signal);
      await this.deps.daemon.stop(connectionId, layout, signal).catch(() => {});
      throwIfAborted(signal);
      this.deps.state.set(connectionId, {
        status: 'booting',
        version,
        detail: 'Restarting workspace server',
      });
      await this.deps.daemon.start(connectionId, layout, signal);
      throwIfAborted(signal);
      await this.publishWhenReady(connectionId, layout, signal);
      throwIfAborted(signal);
    });
  }

  private async refreshUnserialized(
    connectionId: string,
    signal: AbortSignal,
    options: RefreshOptions
  ): Promise<void> {
    // Do not clear the current entry first: every branch below ends with a
    // full set(), and blanking the state would flicker the UI on each refresh.
    try {
      const layout = await this.resolveLayout(signal);
      throwIfAborted(signal);
      const version = await this.deps.installer.installedVersion(connectionId, layout, signal);
      throwIfAborted(signal);
      if (!version) {
        this.deps.provision.drop();
        this.deps.state.set(connectionId, { status: 'not-installed' });
        return;
      }
      const latestVersion = await this.resolveLatestVersion(connectionId, signal, options);
      throwIfAborted(signal);

      try {
        const handshake = await this.deps.wire.dialOnce(
          sshWorkspaceServerTarget(connectionId, layout),
          { signal }
        );
        throwIfAborted(signal);
        this.publishHealthy(connectionId, handshake, latestVersion);
      } catch (error) {
        throwIfAborted(signal);
        this.deps.provision.drop();
        if (error instanceof WorkspaceServerProtocolError) {
          this.publishFailure(connectionId, error, { version, latestVersion });
        } else {
          this.deps.state.set(connectionId, {
            status: 'stopped',
            version,
            ...latestVersionState(latestVersion, version),
          });
        }
      }
    } catch (error) {
      throwIfAborted(signal);
      this.deps.provision.drop();
      this.publishFailure(connectionId, error);
      throw error;
    }
  }

  private async resolveLayout(signal: AbortSignal): Promise<WorkspaceServerLayout> {
    const host = await this.deps.host.probe(signal);
    throwIfAborted(signal);
    if (host.platform === 'win32') {
      throw new HostServerOperationError('unsupported-platform', WINDOWS_SSH_UNSUPPORTED_MESSAGE);
    }
    return workspaceServerLayout(host.home);
  }

  private async resolveInstalled(
    connectionId: string,
    signal: AbortSignal
  ): Promise<{ layout: WorkspaceServerLayout; version: string }> {
    const layout = await this.resolveLayout(signal);
    throwIfAborted(signal);
    const version = await this.deps.installer.installedVersion(connectionId, layout, signal);
    throwIfAborted(signal);
    if (!version) {
      this.deps.state.set(connectionId, { status: 'not-installed' });
      throw new HostServerOperationError('not-installed', 'The workspace server is not installed');
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
    throwIfAborted(signal);
    this.publishHealthy(connectionId, handshake);
  }

  private publishHealthy(
    connectionId: string,
    handshake: WireInitializeResult,
    latestVersion = this.cachedLatestVersion()
  ): void {
    this.deps.state.set(connectionId, {
      status: 'healthy',
      version: handshake.server.appVersion,
      ...latestVersionState(latestVersion, handshake.server.appVersion),
      startedAt: handshake.server.startedAt,
    });
  }

  private publishFailure(
    connectionId: string,
    error: unknown,
    metadata: { version?: string; latestVersion?: string } = {}
  ): void {
    const failure = operationFailure(error);
    if (failure.code === 'not-installed') return;
    const current = this.deps.state.get(connectionId);
    const version = metadata.version ?? current?.version;
    const latestVersion = metadata.latestVersion ?? this.cachedLatestVersion();
    if (isProtocolFailure(failure.code)) {
      this.deps.state.set(connectionId, {
        status: 'healthy',
        ...versionState(version),
        ...latestVersionState(latestVersion, version),
        ...startedAtState(current?.startedAt),
        error: failure,
      });
      return;
    }
    this.deps.state.set(connectionId, {
      status: 'failed',
      ...versionState(version),
      ...latestVersionState(latestVersion, version),
      error: failure,
    });
  }

  private async resolveLatestVersion(
    connectionId: string,
    signal: AbortSignal,
    options: RefreshOptions
  ): Promise<string | undefined> {
    const cached = this.latestVersion;
    if (
      !options.force &&
      cached !== undefined &&
      this.clock.now() - cached.checkedAt < latestVersionCacheTtlMs
    ) {
      return cached.version;
    }

    try {
      const version = await this.deps.installer.availableVersion(connectionId, signal);
      throwIfAborted(signal);
      this.latestVersion = { version, checkedAt: this.clock.now() };
      return version;
    } catch {
      throwIfAborted(signal);
      return cached?.version;
    }
  }

  private cachedLatestVersion(): string | undefined {
    return this.latestVersion?.version;
  }

  private serialized(
    connectionId: string,
    action: HostServerAction,
    operation: (signal: AbortSignal) => Promise<void>
  ): Promise<void> {
    const owner = this.deps.owner?.();
    const scope = owner?.scope ?? this.deps.scope;
    const existing = this.operation;
    if (existing?.scope === scope && existing.action === action) return existing.promise;

    const predecessor = existing?.scope === scope ? existing.promise.catch(() => {}) : undefined;
    const promise = (predecessor ?? Promise.resolve())
      .then(async () => {
        const result = await scope
          .run(`${action}:${connectionId}`, async (signal) => {
            try {
              await runWithTimeout(
                async (inner) => {
                  await owner?.before(action, inner);
                  throwIfAborted(inner);
                  await operation(inner);
                  throwIfAborted(inner);
                },
                { signal, clock: this.clock, timeoutMs: 120_000 }
              );
              return ok<void>();
            } catch (error) {
              return err(error);
            }
          })
          .value();
        if (!scope.disposed) owner?.settled(action, result);
        if (!result.success) throw result.error;
      })
      .catch((error: unknown) => {
        if (!scope.disposed) this.publishFailure(connectionId, error);
        throw error;
      })
      .finally(() => {
        if (this.operation?.promise === promise) {
          this.operation = undefined;
        }
      });
    this.operation = { action, promise, scope };
    return promise;
  }
}

type HostServerOperationErrorCode = 'not-installed' | 'unsupported-platform';

class HostServerOperationError extends Error {
  readonly name = 'HostServerOperationError';

  constructor(
    readonly code: HostServerOperationErrorCode,
    message: string
  ) {
    super(message);
  }
}

function operationFailure(error: unknown): { code: string; message: string } {
  if (error instanceof HostServerOperationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof WorkspaceServerInstallError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof WorkspaceServerProtocolError) {
    return { code: `protocol-${error.details.action}`, message: error.message };
  }
  if (error instanceof WorkspaceServerDaemonError) {
    return { code: 'daemon-operation-failed', message: error.message };
  }
  return {
    code: 'connection-failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

function isProtocolFailure(code: string): boolean {
  return code === 'protocol-upgrade-client' || code === 'protocol-upgrade-server';
}

function latestVersionState(
  latestVersion: string | undefined,
  installedVersion: string | undefined
): { latestVersion?: string; updateAvailable?: true } {
  if (latestVersion === undefined) return {};
  if (installedVersion === undefined || !isNewerRelease(latestVersion, installedVersion)) {
    return { latestVersion };
  }
  return { latestVersion, updateAvailable: true };
}

function versionState(version: string | undefined): { version?: string } {
  return version === undefined ? {} : { version };
}

function startedAtState(startedAt: number | undefined): { startedAt?: number } {
  return startedAt === undefined ? {} : { startedAt };
}
