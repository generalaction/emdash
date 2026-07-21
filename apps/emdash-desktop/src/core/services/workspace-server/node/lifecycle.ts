import type { MachineMutationEvent } from '@core/features/machines/node/machines-service';
import type { SshConnectionManagerEvent } from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import type { WorkspaceServerClientSource } from './connect/client-source';
import type { RemoteHostProbe } from './provision/host-probe';
import type { WorkspaceServerProvisioner } from './provision/provisioner';
import type { WorkspaceServerTarget } from './targets';

export type WorkspaceServerInvalidation = {
  connectionId: string;
  reason: 'reconnect-failed' | 'machine-mutation' | 'terminal-client';
  target?: WorkspaceServerTarget;
  error?: unknown;
};

export class WorkspaceServerLifecycle {
  private readonly listeners = new Set<(event: WorkspaceServerInvalidation) => void>();

  constructor(
    private readonly deps: {
      host: Pick<RemoteHostProbe, 'drop'>;
      connections: Pick<WorkspaceServerClientSource, 'invalidateConnection'>;
      provisioner: Pick<WorkspaceServerProvisioner, 'cancel'>;
    }
  ) {}

  async handleSshEvent(event: SshConnectionManagerEvent): Promise<void> {
    if (event.type !== 'reconnect-failed') return;
    this.deps.host.drop(event.connectionId);
    this.notify({ connectionId: event.connectionId, reason: 'reconnect-failed' });
    await this.deps.connections.invalidateConnection(event.connectionId);
  }

  async handleMachineMutation(event: MachineMutationEvent): Promise<void> {
    this.deps.host.drop(event.connectionId);
    this.notify({ connectionId: event.connectionId, reason: 'machine-mutation' });
    await Promise.all([
      this.deps.provisioner.cancel(event.connectionId),
      this.deps.connections.invalidateConnection(event.connectionId),
    ]);
  }

  handleTerminalError(error: unknown, target: WorkspaceServerTarget): void {
    if (target.kind !== 'ssh') return;
    this.notify({
      connectionId: target.sshConnectionId,
      reason: 'terminal-client',
      target,
      error,
    });
  }

  onInvalidate(listener: (event: WorkspaceServerInvalidation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(event: WorkspaceServerInvalidation): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // One observer must not prevent the remaining invalidation cleanup or listeners.
      }
    }
  }
}
