import { hostRef } from '@emdash/core/primitives/host/api';
import { runtimeHostUnavailable } from '@emdash/core/primitives/runtime-resolution/api';
import type { ReleaseChannel } from '@emdash/core/workspace-server';
import type { Scope } from '@emdash/shared/concurrency';
import { waitWithSignal } from '@emdash/shared/scheduling';
import { cell, derived, peek, snapshot, type Cell, type Readable } from '@emdash/wire/state';
import type {
  SshConnectionControl,
  SshConnectionLifecycle,
} from '@core/primitives/ssh/api/node/connection-control';
import type { SshClientProxy } from '@core/primitives/ssh/api/node/ssh-client-proxy';
import type {
  SshConnectionManager,
  SshConnectionManagerEvent,
} from '@core/primitives/ssh/api/node/ssh-connection-manager';
import type { HostInvalidation, MachineMutationEvents } from '../api';
import type { HostAvailabilityState, HostDemandMode, HostDemandLease } from '../api/availability';
import type { HostConnection } from '../api/node/host-connection';
import { HostConnectionSupervisor } from './connection-supervisor';
import { HostServerOperations } from './server-operations';
import { HostStateModel } from './state-model';
import { openSshWorkspaceServerTransport } from './workspace-server/connect/ssh-streamlocal-transport';
import {
  createWorkspaceServerDialer,
  type WorkspaceServerConnection,
} from './workspace-server/connect/wire-connection-manager';
import type { WorkspaceServerSshPort } from './workspace-server/ports';
import { RemoteWorkspaceServerDaemon } from './workspace-server/provision/daemon-control';
import { RemoteHostProbe } from './workspace-server/provision/host-probe';
import { WorkspaceServerInstaller } from './workspace-server/provision/installer';
import { WorkspaceServerProvisioner } from './workspace-server/provision/provisioner';

type HostServiceLog = {
  debug?(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
};

export type CreateHostServiceDeps = {
  scope: Scope;
  ssh: {
    manager: SshConnectionManager;
    control: SshConnectionControl;
  };
  machineEvents: MachineMutationEvents;
  installBaseUrl?: string;
  releaseChannel?: ReleaseChannel;
  devAutoUpdate?: boolean;
  client?: { id: string; appVersion: string };
  logger?: HostServiceLog;
};

export type HostClientOptions = {
  signal?: AbortSignal;
  /** RPC dispatch must fail fast; only attachment owners may await future readiness. */
  waitForReady?: boolean;
};

/**
 * Orchestrates transport, provisioning, and lifecycle for remote runtime clients.
 * Machine persistence and CRUD remain owned by the feature-level MachinesService.
 */
export interface HostService {
  availability(connectionId: string): Readable<HostAvailabilityState>;
  demand(connectionId: string, mode: HostDemandMode, owner: Scope): HostDemandLease;
  connection(connectionId: string): HostConnection;
  readonly lifecycle: SshConnectionLifecycle;
  wake(cause: 'online' | 'focus' | 'resume' | 'suspend'): void;
  readonly stateModel: HostStateModel;
  client(connectionId: string, options?: HostClientOptions): Promise<WorkspaceServerConnection>;
  refreshServerState(connectionId: string, options?: { force?: boolean }): Promise<void>;
  installServer(connectionId: string): Promise<void>;
  startServer(connectionId: string): Promise<void>;
  stopServer(connectionId: string): Promise<void>;
  restartServer(connectionId: string): Promise<void>;
  updateServer(connectionId: string): Promise<void>;
  onInvalidate(listener: (event: HostInvalidation) => void): () => void;
  onReady(
    listener: (connectionId: string, attachment: WorkspaceServerConnection) => void
  ): () => void;
  dispose(): Promise<void>;
}

export function createHostService(deps: CreateHostServiceDeps): HostService {
  const scope = deps.scope.child('host-service');
  const stateModel = scope.use(new HostStateModel());
  const supervisors = new Map<string, HostConnectionSupervisor>();
  let generation = 0;
  const availabilityStates = new Map<
    string,
    {
      source: Cell<Readable<HostAvailabilityState> | undefined>;
      value: Readable<HostAvailabilityState>;
    }
  >();
  const demands = new Map<
    string,
    Set<{ mode: HostDemandMode; owner: Scope; lease: HostDemandLease }>
  >();
  function availabilitySlot(connectionId: string) {
    let slot = availabilityStates.get(connectionId);
    if (!slot) {
      const source = cell<Readable<HostAvailabilityState> | undefined>(undefined);
      // Both branches synchronously produce a complete domain state.
      const value = derived((): HostAvailabilityState => {
        const current = snapshot(source).value;
        return current ? snapshot(current).value : { kind: 'unavailable', recovery: 'eligible' };
      }) as Readable<HostAvailabilityState>;
      slot = { source, value };
      availabilityStates.set(connectionId, slot);
    }
    return slot;
  }
  function availability(connectionId: string): Readable<HostAvailabilityState> {
    return availabilitySlot(connectionId).value;
  }
  const readyListeners = new Set<(id: string, attachment: WorkspaceServerConnection) => void>();
  const ssh = createWorkspaceServerSshPort(deps.ssh);
  const host = new RemoteHostProbe(ssh);
  const wire = createWorkspaceServerDialer({
    ssh,
    client: deps.client,
  });
  const installer = new WorkspaceServerInstaller({
    ssh,
    baseUrl: deps.installBaseUrl,
    releaseChannel: deps.releaseChannel,
  });
  const daemon = new RemoteWorkspaceServerDaemon(ssh);
  const provisioner = new WorkspaceServerProvisioner({
    scope,
    ssh,
    host,
    installer,
    daemon,
    model: stateModel,
    wire,
    devAutoUpdate: deps.devAutoUpdate,
    logger: deps.logger,
  });
  const serverOperations = new HostServerOperations({
    owner: (id) => supervisor(id).serverOperationOwner(),
    scope,
    state: stateModel,
    host,
    installer,
    daemon,
    wire,
    provision: provisioner,
  });
  const invalidationListeners = new Set<(event: HostInvalidation) => void>();
  function supervisor(connectionId: string): HostConnectionSupervisor {
    const existing = supervisors.get(connectionId);
    if (existing) return existing;
    const control = deps.ssh.control;
    const instance = new HostConnectionSupervisor({
      scope,
      nextGeneration: () => ++generation,
      host: hostRef('remote', connectionId),
      intent: {
        read: () => control.readIntent(connectionId),
        write: (enabled) => control.writeIntent(connectionId, enabled),
      },
      ssh: {
        connected: () => deps.ssh.manager.getProxy(connectionId)?.isConnected === true,
        establish: async (signal) => {
          await control.establish(connectionId, signal);
        },
        reset: () => control.reset(connectionId),
        probe: (signal) => control.probe(connectionId, signal),
      },
      runtime: {
        prepare: (signal) => {
          const abort = () => {
            void provisioner.cancel(connectionId);
          };
          signal.addEventListener('abort', abort, { once: true });
          return waitWithSignal(provisioner.ensure(connectionId), signal).finally(() =>
            signal.removeEventListener('abort', abort)
          );
        },
        open: (target, signal) => {
          if (target.kind !== 'ssh') throw new Error('Expected SSH target');
          return openSshWorkspaceServerTransport(target, ssh, { signal });
        },
        cancel: () => {
          void provisioner.cancel(connectionId);
        },
      },
      client: deps.client,
      log: (state, detail) =>
        deps.logger?.debug?.('Host connection supervisor', { ...detail, ...state }),
      onReady: (attachment) => {
        const handshake = attachment.currentHandshake();
        if (handshake)
          stateModel.set(connectionId, {
            status: 'healthy',
            version: handshake.server.appVersion,
            startedAt: handshake.server.startedAt,
          });
        for (const listener of readyListeners) {
          try {
            listener(connectionId, attachment);
          } catch (error) {
            deps.logger?.warn('Host readiness observer failed', { error });
          }
        }
      },
    });
    supervisors.set(connectionId, instance);
    availabilitySlot(connectionId).source.set(instance.availability);
    return instance;
  }

  const handleSshEvent = (event: SshConnectionManagerEvent) => {
    if (event.type === 'disconnected') supervisors.get(event.connectionId)?.sshDisconnected();
  };
  deps.ssh.manager.on('connection-event', handleSshEvent);
  scope.add(() => {
    deps.ssh.manager.off('connection-event', handleSshEvent);
  });
  scope.add(
    deps.machineEvents.on('machine:mutated', (event) => {
      const previous = supervisors.get(event.connectionId);
      supervisors.delete(event.connectionId);
      availabilitySlot(event.connectionId).source.set(undefined);
      void previous?.dispose();
      host.drop(event.connectionId);
      serverOperations.forget(event.connectionId);
      stateModel.remove(event.connectionId);
      notify({ connectionId: event.connectionId, reason: 'machine-mutation' });
      void provisioner.cancel(event.connectionId).catch((error: unknown) => {
        deps.logger?.warn('Host service mutation lifecycle handling failed', { error });
      });
      for (const demand of demands.get(event.connectionId) ?? []) {
        demand.lease = supervisor(event.connectionId).demand(demand.mode, demand.owner);
      }
    })
  );
  scope.add(() => invalidationListeners.clear());

  let disposePromise: Promise<void> | undefined;
  return {
    availability,
    demand(id, mode, owner) {
      const entry = { mode, owner, lease: supervisor(id).demand(mode, owner) };
      let leases = demands.get(id);
      if (!leases) {
        leases = new Set();
        demands.set(id, leases);
      }
      leases.add(entry);
      owner.add(() => {
        leases.delete(entry);
        if (leases.size === 0) demands.delete(id);
      });
      return {
        get mode() {
          return entry.mode;
        },
        setMode(next) {
          entry.mode = next;
          entry.lease.setMode(next);
        },
      };
    },
    connection: (id) => supervisor(id).control,
    lifecycle: {
      connect: async (id) => {
        await supervisor(id).connect(false);
        return 'connected';
      },
      ensureConnected: async (id) => {
        if (!(await deps.ssh.control.readIntent(id))) return 'disconnected';
        await supervisor(id).ensureSsh();
        return 'connected';
      },
      disconnect: (id) => supervisor(id).disconnect(),
      invalidate: async (id) => {
        const previous = supervisors.get(id);
        supervisors.delete(id);
        availabilitySlot(id).source.set(undefined);
        serverOperations.forget(id);
        await previous?.dispose();
        await deps.ssh.manager.dropConnection(id);
      },
    },
    wake(cause) {
      for (const instance of supervisors.values()) {
        if (cause === 'suspend') instance.suspendSystem();
        else if (cause === 'resume') instance.resume();
        else instance.revalidate(cause);
      }
    },
    stateModel,
    async client(connectionId, options) {
      const instance = supervisor(connectionId);
      if (options?.waitForReady === false) {
        const state = peek(instance.availability);
        if (state.kind !== 'ready') {
          throw state.kind === 'unavailable' && state.issue
            ? state.issue
            : runtimeHostUnavailable(
                hostRef('remote', connectionId),
                'runtime-unavailable',
                'Host runtime is not currently usable'
              );
        }
        return instance.attachment;
      }
      await instance.awaitUsable(options?.signal);
      return instance.attachment;
    },
    refreshServerState: (connectionId, options) => serverOperations.refresh(connectionId, options),
    installServer: (connectionId) => serverOperations.install(connectionId),
    startServer: (connectionId) => serverOperations.start(connectionId),
    stopServer: (connectionId) => serverOperations.stop(connectionId),
    restartServer: (connectionId) => serverOperations.restart(connectionId),
    updateServer: (connectionId) => serverOperations.update(connectionId),
    onInvalidate(listener) {
      invalidationListeners.add(listener);
      return () => invalidationListeners.delete(listener);
    },
    onReady(listener) {
      readyListeners.add(listener);
      for (const [id, instance] of supervisors) {
        if (peek(instance.availability).kind === 'ready') listener(id, instance.attachment);
      }
      return () => {
        readyListeners.delete(listener);
      };
    },
    dispose() {
      disposePromise ??= scope.dispose();
      return disposePromise;
    },
  };

  function notify(event: HostInvalidation): void {
    for (const listener of invalidationListeners) {
      try {
        listener(event);
      } catch {
        // One observer must not prevent lifecycle cleanup or remaining listeners.
      }
    }
  }
}

function createWorkspaceServerSshPort(ssh: CreateHostServiceDeps['ssh']): WorkspaceServerSshPort {
  return {
    async ensureProxy(connectionId: string): Promise<SshClientProxy> {
      const proxy = ssh.manager.getProxy(connectionId);
      if (!proxy?.isConnected) {
        throw new Error(`SSH connection '${connectionId}' did not provide a live proxy`);
      }
      return proxy;
    },
  };
}
