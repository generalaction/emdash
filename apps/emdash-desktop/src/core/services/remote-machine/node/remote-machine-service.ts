import type { Scope } from '@emdash/shared/concurrency';
import type { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';
import type {
  SshConnectionManager,
  SshConnectionManagerEvent,
} from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import type { SshService } from '@core/services/ssh/node/ssh-service';
import {
  createWireConnectionManager,
  type WorkspaceServerConnection,
} from '../../workspace-server/node/connect/wire-connection-manager';
import type { WorkspaceServerSshPort } from '../../workspace-server/node/ports';
import { RemoteWorkspaceServerDaemon } from '../../workspace-server/node/provision/daemon-control';
import { RemoteHostProbe } from '../../workspace-server/node/provision/host-probe';
import { WorkspaceServerInstaller } from '../../workspace-server/node/provision/installer';
import { WorkspaceServerProvisioner } from '../../workspace-server/node/provision/provisioner';
import type { MachineMutationEvents, RemoteMachineInvalidation } from '../api';
import { RemoteMachineServerOperations } from './server-operations';
import { RemoteMachineStateModel } from './state-model';

type RemoteMachineServiceLog = {
  warn(message: string, metadata?: Record<string, unknown>): void;
};

export type CreateRemoteMachineServiceDeps = {
  scope: Scope;
  ssh: {
    manager: SshConnectionManager;
    connect: Pick<SshService, 'connect'>;
  };
  machineEvents: MachineMutationEvents;
  installBaseUrl?: string;
  installCommand?: string;
  logger?: RemoteMachineServiceLog;
};

/**
 * Orchestrates transport, provisioning, and lifecycle for remote runtime clients.
 * Machine persistence and CRUD remain owned by the feature-level MachinesService.
 */
export interface RemoteMachineService {
  readonly stateModel: RemoteMachineStateModel;
  client(connectionId: string): Promise<WorkspaceServerConnection>;
  refreshServerState(connectionId: string): Promise<void>;
  installServer(connectionId: string): Promise<void>;
  startServer(connectionId: string): Promise<void>;
  stopServer(connectionId: string): Promise<void>;
  restartServer(connectionId: string): Promise<void>;
  updateServer(connectionId: string): Promise<void>;
  onInvalidate(listener: (event: RemoteMachineInvalidation) => void): () => void;
  dispose(): Promise<void>;
}

export function createRemoteMachineService(
  deps: CreateRemoteMachineServiceDeps
): RemoteMachineService {
  const scope = deps.scope.child('remote-machine-service');
  const stateModel = scope.use(new RemoteMachineStateModel());
  const ssh = createWorkspaceServerSshPort(deps.ssh);
  const host = new RemoteHostProbe(ssh);
  const wire = createWireConnectionManager({ scope, ssh });
  const installer = new WorkspaceServerInstaller(ssh, deps.installBaseUrl, deps.installCommand);
  const daemon = new RemoteWorkspaceServerDaemon(ssh);
  const provisioner = new WorkspaceServerProvisioner({
    scope,
    ssh,
    host,
    installer,
    daemon,
    model: stateModel,
    wire,
  });
  const serverOperations = new RemoteMachineServerOperations({
    scope,
    state: stateModel,
    host,
    installer,
    daemon,
    wire,
  });
  const invalidationListeners = new Set<(event: RemoteMachineInvalidation) => void>();

  const handleSshEvent = (event: SshConnectionManagerEvent) => {
    if (event.type !== 'reconnect-failed') return;
    host.drop(event.connectionId);
    stateModel.remove(event.connectionId);
    notify({ connectionId: event.connectionId, reason: 'reconnect-failed' });
    void wire.invalidateConnection(event.connectionId).catch((error: unknown) => {
      deps.logger?.warn('Remote-machine SSH lifecycle handling failed', { error });
    });
  };
  deps.ssh.manager.on('connection-event', handleSshEvent);
  scope.add(() => {
    deps.ssh.manager.off('connection-event', handleSshEvent);
  });
  scope.add(
    deps.machineEvents.on('machine:mutated', (event) => {
      host.drop(event.connectionId);
      stateModel.remove(event.connectionId);
      notify({ connectionId: event.connectionId, reason: 'machine-mutation' });
      void Promise.all([
        provisioner.cancel(event.connectionId),
        wire.invalidateConnection(event.connectionId),
      ]).catch((error: unknown) => {
        deps.logger?.warn('Remote-machine mutation lifecycle handling failed', { error });
      });
    })
  );
  scope.add(
    wire.onConnectionLost((target, error) => {
      if (target.kind !== 'ssh') return;
      stateModel.markConnectionLost(target.sshConnectionId);
      notify({
        connectionId: target.sshConnectionId,
        reason: 'connection-lost',
        target,
        error,
      });
    })
  );
  scope.add(() => invalidationListeners.clear());

  let disposePromise: Promise<void> | undefined;
  return {
    stateModel,
    async client(connectionId) {
      const target = await provisioner.ensure(connectionId);
      return wire.client(target);
    },
    refreshServerState: (connectionId) => serverOperations.refresh(connectionId),
    installServer: (connectionId) => serverOperations.install(connectionId),
    startServer: (connectionId) => serverOperations.start(connectionId),
    stopServer: (connectionId) => serverOperations.stop(connectionId),
    restartServer: (connectionId) => serverOperations.restart(connectionId),
    updateServer: (connectionId) => serverOperations.update(connectionId),
    onInvalidate(listener) {
      invalidationListeners.add(listener);
      return () => invalidationListeners.delete(listener);
    },
    dispose() {
      disposePromise ??= scope.dispose();
      return disposePromise;
    },
  };

  function notify(event: RemoteMachineInvalidation): void {
    for (const listener of invalidationListeners) {
      try {
        listener(event);
      } catch {
        // One observer must not prevent lifecycle cleanup or remaining listeners.
      }
    }
  }
}

function createWorkspaceServerSshPort(
  ssh: CreateRemoteMachineServiceDeps['ssh']
): WorkspaceServerSshPort {
  return {
    async ensureProxy(connectionId: string): Promise<SshClientProxy> {
      await ssh.connect.connect(connectionId);
      const proxy = ssh.manager.getProxy(connectionId);
      if (!proxy?.isConnected) {
        throw new Error(`SSH connection '${connectionId}' did not provide a live proxy`);
      }
      return proxy;
    },
  };
}
