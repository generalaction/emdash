import { sshConnectionIdOf, type HostRef } from '@emdash/core/primitives/host/api';
import { runtimeHostUnavailable } from '@emdash/core/primitives/runtime-resolution/api';
import type { ReleaseChannel } from '@emdash/core/workspace-server';
import { err, ok } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { waitWithSignal } from '@emdash/shared/scheduling';
import { peek } from '@emdash/wire/state';
import type { SshConnectionControl } from '@core/primitives/ssh/api/node/connection-control';
import type { SshConnectionManager } from '@core/primitives/ssh/api/node/ssh-connection-manager';
import type { HostServerState } from '../api';
import type { HostService } from '../api/node/host-service';
import { ManagedHostConnection } from './managed-host-connection';
import { RemoteHostWorkspaceServer } from './remote-host-workspace-server';
import { translateHostPreparationError } from './runtime-resolution';
import type { HostStateModel } from './state-model';
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

export type CreateHostServiceOptions = {
  scope: Scope;
  host: HostRef;
  ssh: { manager: SshConnectionManager; control: SshConnectionControl };
  stateModel: HostStateModel;
  nextGeneration(): number;
  onReady(attachment: WorkspaceServerConnection): void;
  installBaseUrl?: string;
  releaseChannel?: ReleaseChannel;
  devAutoUpdate?: boolean;
  client?: { id: string; appVersion: string };
  logger?: {
    debug?(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
  };
};

/** Registry-owned lifetime controls are kept off the HostService consumer interface. */
export type HostServiceEntry = {
  service: HostService;
  readyAttachment(): WorkspaceServerConnection | undefined;
  connectSsh(): Promise<void>;
  ensureSsh(): Promise<void>;
  sshDisconnected(): void;
  wake(cause: 'online' | 'focus' | 'resume' | 'suspend'): void;
  dispose(): Promise<void>;
};

/** Composes one remote Host identity. Every operation closes over this identity's lifetime. */
export function createHostService(options: CreateHostServiceOptions): HostServiceEntry {
  const id = sshConnectionIdOf(options.host);
  if (!id) throw new Error('Local worker services are not managed SSH Hosts');
  const scope = options.scope.child(`host:${id}`);
  const control = options.ssh.control;
  const ssh: WorkspaceServerSshPort = {
    async ensureProxy(connectionId) {
      scope.signal.throwIfAborted();
      if (connectionId !== id) throw new Error('SSH request belongs to a different Host');
      const proxy = options.ssh.manager.getProxy(id);
      if (!proxy?.isConnected)
        throw new Error(`SSH connection '${id}' did not provide a live proxy`);
      return proxy;
    },
  };
  // Late work from a retired identity must not publish into the aggregate model by reused ID.
  const state = {
    runtime: options.stateModel.runtime,
    get: (connectionId: string) =>
      scope.disposed ? undefined : options.stateModel.get(connectionId),
    set: (connectionId: string, value: HostServerState) => {
      if (!scope.disposed) options.stateModel.set(connectionId, value);
    },
    remove: (connectionId: string) => {
      if (!scope.disposed) options.stateModel.remove(connectionId);
    },
  };
  const host = new RemoteHostProbe(id, ssh);
  const wire = createWorkspaceServerDialer({ ssh, client: options.client });
  const installer = new WorkspaceServerInstaller({
    ssh,
    baseUrl: options.installBaseUrl,
    releaseChannel: options.releaseChannel,
  });
  const daemon = new RemoteWorkspaceServerDaemon(ssh);
  const provisioner = new WorkspaceServerProvisioner({
    connectionId: id,
    scope,
    host,
    installer,
    daemon,
    model: state,
    wire,
    devAutoUpdate: options.devAutoUpdate,
    logger: options.logger,
  });
  const managed = new ManagedHostConnection({
    scope,
    host: options.host,
    nextGeneration: options.nextGeneration,
    intent: {
      read: () => {
        scope.signal.throwIfAborted();
        return control.readIntent(id);
      },
      write: (enabled) => {
        scope.signal.throwIfAborted();
        return control.writeIntent(id, enabled);
      },
    },
    ssh: {
      connected: () => !scope.disposed && options.ssh.manager.getProxy(id)?.isConnected === true,
      establish: async (signal) => {
        scope.signal.throwIfAborted();
        await control.establish(id, signal);
      },
      reset: () => control.reset(id),
      probe: (signal) => {
        scope.signal.throwIfAborted();
        return control.probe(id, signal);
      },
    },
    runtime: {
      prepare: (signal) => {
        scope.signal.throwIfAborted();
        const abort = () => {
          void provisioner.cancel();
        };
        signal.addEventListener('abort', abort, { once: true });
        return waitWithSignal(provisioner.ensure(), signal).finally(() =>
          signal.removeEventListener('abort', abort)
        );
      },
      open: (target, signal) => {
        if (target.kind !== 'ssh') throw new Error('Expected SSH target');
        return openSshWorkspaceServerTransport(target, ssh, { signal });
      },
      cancel: () => {
        void provisioner.cancel();
      },
    },
    client: options.client,
    log: (value, detail) =>
      options.logger?.debug?.('Host connection supervisor', { ...detail, ...value }),
    onReady: (attachment) => {
      if (scope.disposed) return;
      const handshake = attachment.currentHandshake();
      if (handshake)
        state.set(id, {
          status: 'healthy',
          version: handshake.server.appVersion,
          startedAt: handshake.server.startedAt,
        });
      options.onReady(attachment);
    },
  });
  const server = new RemoteHostWorkspaceServer({
    connectionId: id,
    scope,
    owner: () => managed.supervisor.serverOperationOwner(),
    state,
    host,
    installer,
    daemon,
    wire,
    provision: provisioner,
  });
  scope.add(() => host.drop());

  const service: HostService = {
    host: options.host,
    connection: managed,
    runtime: {
      waitUntilReady: async (signal) => {
        try {
          return ok({
            host: options.host,
            generation: await managed.supervisor.awaitUsable(signal),
          });
        } catch (error) {
          return err(translateHostPreparationError(options.host, 'handshaking', error));
        }
      },
      client: async (request) => {
        scope.signal.throwIfAborted();
        if (request?.waitForReady === false) {
          const availability = peek(managed.availability);
          if (availability.kind !== 'ready')
            throw availability.kind === 'unavailable' && availability.issue
              ? availability.issue
              : runtimeHostUnavailable(
                  options.host,
                  'runtime-unavailable',
                  'Host runtime is not currently usable'
                );
        } else await managed.supervisor.awaitUsable(request?.signal);
        return managed.supervisor.attachment;
      },
    },
    server,
  };
  return {
    service,
    readyAttachment: () =>
      peek(managed.availability).kind === 'ready' ? managed.supervisor.attachment : undefined,
    connectSsh: () => managed.connectSsh(),
    ensureSsh: () => managed.supervisor.ensureSsh(),
    sshDisconnected: () => managed.supervisor.sshDisconnected(),
    wake(cause) {
      if (cause === 'suspend') managed.supervisor.suspendSystem();
      else if (cause === 'resume') managed.supervisor.resume();
      else managed.supervisor.revalidate(cause);
    },
    dispose: () => scope.dispose(),
  };
}
