import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { sshConnectionEventChannel, type SshConnectionEvent } from '@shared/events/sshEvents';
import type { ConnectionState, ConnectionTestResult, SshConfig } from '@shared/ssh';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from './resource';

type SaveConnectionInput = Omit<SshConfig, 'id'> & { password?: string; passphrase?: string };

function toConnectionState(event: SshConnectionEvent): ConnectionState {
  switch (event.type) {
    case 'connected':
    case 'reconnected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'disconnected':
    case 'reconnect-failed':
      return 'disconnected';
    case 'error':
      return 'error';
  }
}

export class SshConnectionStore {
  readonly connectionsResource: Resource<SshConfig[]>;
  readonly connectionStatesResource: Resource<Record<string, ConnectionState>, SshConnectionEvent>;

  private pendingMutations = 0;
  private started = false;

  constructor() {
    this.connectionsResource = new Resource<SshConfig[]>(() => rpc.ssh.getConnections(), []);

    this.connectionStatesResource = new Resource<
      Record<string, ConnectionState>,
      SshConnectionEvent
    >(
      () => rpc.ssh.getConnectionState(),
      [
        {
          kind: 'event',
          subscribe: (handler) => events.on(sshConnectionEventChannel, handler),
          onEvent: (event, ctx) => {
            const next = { ...(ctx.data ?? {}) };
            next[event.connectionId] = toConnectionState(event);
            ctx.set(next);
          },
        },
      ]
    );

    makeObservable<SshConnectionStore, 'pendingMutations'>(this, {
      pendingMutations: observable,
      connections: computed,
      connectionStates: computed,
      isLoading: computed,
      start: action,
      dispose: action,
    });
  }

  get connections(): SshConfig[] {
    return this.connectionsResource.data ?? [];
  }

  get connectionStates(): Record<string, ConnectionState> {
    return this.connectionStatesResource.data ?? {};
  }

  get isLoading(): boolean {
    return (
      this.connectionsResource.loading ||
      this.connectionStatesResource.loading ||
      this.pendingMutations > 0
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connectionStatesResource.start();
    void this.connectionsResource.load();
  }

  dispose(): void {
    this.connectionsResource.dispose();
    this.connectionStatesResource.dispose();
    this.started = false;
  }

  stateFor(connectionId: string): ConnectionState {
    return this.connectionStates[connectionId] ?? 'disconnected';
  }

  async saveConnection(config: SaveConnectionInput): Promise<SshConfig> {
    return await this.withMutation(async () => {
      const savedConnection = await rpc.ssh.saveConnection(config);
      this.connectionsResource.setValue(this.upsertConnection(savedConnection));
      return savedConnection;
    });
  }

  async renameConnection(id: string, name: string): Promise<void> {
    await this.withMutation(async () => {
      await rpc.ssh.renameConnection(id, name);
      const current = this.connectionsResource.data ?? [];
      this.connectionsResource.setValue(
        current.map((connection) => (connection.id === id ? { ...connection, name } : connection))
      );
    });
  }

  async deleteConnection(id: string): Promise<void> {
    await this.withMutation(async () => {
      await rpc.ssh.deleteConnection(id);

      const currentConnections = this.connectionsResource.data ?? [];
      this.connectionsResource.setValue(
        currentConnections.filter((connection) => connection.id !== id)
      );

      const currentStates = this.connectionStatesResource.data ?? {};
      if (id in currentStates) {
        const { [id]: _removed, ...rest } = currentStates;
        this.connectionStatesResource.setValue(rest);
      }
    });
  }

  async testConnection(
    config: SshConfig & { password?: string; passphrase?: string }
  ): Promise<ConnectionTestResult> {
    return await rpc.ssh.testConnection(config);
  }

  private upsertConnection(savedConnection: SshConfig): SshConfig[] {
    const current = this.connectionsResource.data ?? [];
    const index = current.findIndex((connection) => connection.id === savedConnection.id);
    if (index === -1) return [...current, savedConnection];

    const next = [...current];
    next[index] = savedConnection;
    return next;
  }

  private async withMutation<T>(run: () => Promise<T>): Promise<T> {
    runInAction(() => {
      this.pendingMutations += 1;
    });

    try {
      return await run();
    } finally {
      runInAction(() => {
        this.pendingMutations = Math.max(0, this.pendingMutations - 1);
      });
    }
  }
}
