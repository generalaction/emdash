import type { PendingLease } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type {
  MachineMutationEvent,
  MachinesService,
} from '@core/features/machines/api/node/machines-service';
import type { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';
import type {
  SshConnectionManager,
  SshConnectionManagerEvent,
} from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import type { SshService } from '@core/services/ssh/node/ssh-service';
import {
  createWorkspaceServerClientSource,
  type WorkspaceServerConnection,
} from './connect/client-source';
import { WorkspaceServerLifecycle, type WorkspaceServerInvalidation } from './lifecycle';
import type { WorkspaceServerSshPort } from './ports';
import type { WorkspaceServerArtifactSource } from './provision/artifact-source';
import { RemoteWorkspaceServerDaemon } from './provision/daemon-control';
import { RemoteHostProbe } from './provision/host-probe';
import { WorkspaceServerInstaller } from './provision/installer';
import { WorkspaceServerProvisioner } from './provision/provisioner';
import { WorkspaceServerProvisioningModel } from './provision/provisioning-model';
import { workspaceServerTargetKey, type WorkspaceServerTarget } from './targets';

type WorkspaceServerSshHandle = {
  manager: SshConnectionManager;
  ssh: Pick<SshService, 'connect'>;
  machines: Pick<MachinesService, 'on'>;
};

type WorkspaceServerServiceLog = {
  warn(message: string, metadata?: Record<string, unknown>): void;
};

export type CreateWorkspaceServerServiceDeps = {
  scope: Scope;
  ssh: WorkspaceServerSshHandle;
  artifacts: WorkspaceServerArtifactSource;
  logger?: WorkspaceServerServiceLog;
  desiredVersion?: string;
};

export interface WorkspaceServerServiceHandle {
  readonly provisioningModel: WorkspaceServerProvisioningModel;
  client(connectionId: string): Promise<WorkspaceServerConnection>;
  onInvalidate(listener: (event: WorkspaceServerInvalidation) => void): () => void;
  dispose(): Promise<void>;
}

type PinnedConnection = {
  target: WorkspaceServerTarget;
  lease: PendingLease<WorkspaceServerConnection>;
};

export function createWorkspaceServerService(
  deps: CreateWorkspaceServerServiceDeps
): WorkspaceServerServiceHandle {
  const scope = deps.scope.child('workspace-server-service');
  const provisioningModel = scope.use(new WorkspaceServerProvisioningModel());
  const ssh = createWorkspaceServerSshPort(deps.ssh);
  const host = new RemoteHostProbe(ssh);
  const connections = createWorkspaceServerClientSource({
    scope,
    ssh,
  });
  const installer = new WorkspaceServerInstaller(ssh, deps.artifacts);
  const daemon = new RemoteWorkspaceServerDaemon(ssh);
  const provisioner = new WorkspaceServerProvisioner({
    scope,
    ssh,
    host,
    installer,
    daemon,
    model: provisioningModel,
    desiredVersion: deps.desiredVersion,
  });
  const lifecycle = new WorkspaceServerLifecycle({ host, connections, provisioner });
  const pinnedConnections = new Map<string, PinnedConnection>();
  scope.add(
    connections.onTerminalError((error, target) => lifecycle.handleTerminalError(error, target))
  );
  scope.add(
    lifecycle.onInvalidate(({ connectionId }) => {
      void releasePinnedConnections(connectionId);
    })
  );
  scope.add(() => releasePinnedConnections());

  const handleSshEvent = (event: SshConnectionManagerEvent) => {
    void lifecycle.handleSshEvent(event).catch((error: unknown) => {
      deps.logger?.warn('Workspace-server SSH lifecycle handling failed', { error });
    });
  };
  deps.ssh.manager.on('connection-event', handleSshEvent);
  scope.add(() => {
    deps.ssh.manager.off('connection-event', handleSshEvent);
  });
  scope.add(
    deps.ssh.machines.on('machine:mutated', (event: MachineMutationEvent) =>
      lifecycle.handleMachineMutation(event)
    )
  );

  let disposePromise: Promise<void> | undefined;
  return {
    provisioningModel,
    async client(connectionId) {
      const target = await provisioner.ensure(connectionId);
      const key = workspaceServerTargetKey(target);
      let pinned = pinnedConnections.get(key);
      if (!pinned) {
        pinned = { target, lease: connections.acquire(target) };
        pinnedConnections.set(key, pinned);
      }

      try {
        return await pinned.lease.ready();
      } catch (error) {
        if (pinnedConnections.get(key) === pinned) pinnedConnections.delete(key);
        await pinned.lease.release();
        throw error;
      }
    },
    onInvalidate: (listener) => lifecycle.onInvalidate(listener),
    dispose() {
      disposePromise ??= scope.dispose();
      return disposePromise;
    },
  };

  async function releasePinnedConnections(connectionId?: string): Promise<void> {
    const releases: Promise<void>[] = [];
    for (const [key, pinned] of pinnedConnections) {
      if (
        connectionId &&
        (pinned.target.kind !== 'ssh' || pinned.target.sshConnectionId !== connectionId)
      ) {
        continue;
      }
      pinnedConnections.delete(key);
      releases.push(pinned.lease.release());
    }
    await Promise.all(releases);
  }
}

function createWorkspaceServerSshPort(ssh: WorkspaceServerSshHandle): WorkspaceServerSshPort {
  return {
    async ensureProxy(connectionId: string): Promise<SshClientProxy> {
      await ssh.ssh.connect(connectionId);
      const proxy = ssh.manager.getProxy(connectionId);
      if (!proxy?.isConnected) {
        throw new Error(`SSH connection '${connectionId}' did not provide a live proxy`);
      }
      return proxy;
    },
  };
}
