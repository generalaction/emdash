import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import type {
  ConnectionState,
  ConnectionTestResult,
  SshConfig,
  SshConfigHost,
  SshHealthState,
} from '@shared/core/ssh/ssh';
import { sshConnectionEventChannel, type SshConnectionEvent } from '@shared/core/ssh/sshEvents';
import { Resource } from './resource';

type SaveConnectionInput = Partial<Pick<SshConfig, 'id'>> &
  Omit<SshConfig, 'id'> & { password?: string; passphrase?: string };

type SshConnectionStoreOptions = {
  onConnectionReady?: (connectionId: string) => void;
};

type SshConnectionStateEvent = Exclude<SshConnectionEvent, { type: 'health-changed' }>;

function toConnectionState(event: SshConnectionStateEvent): ConnectionState {
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
  readonly healthStatesResource: Resource<Record<string, SshHealthState>, SshConnectionEvent>;

  private pendingMutations = 0;
  private started = false;
  private readonly onConnectionReady?: (connectionId: string) => void;

  constructor({ onConnectionReady }: SshConnectionStoreOptions = {}) {
    this.onConnectionReady = onConnectionReady;
    this.connectionsResource = new Resource<SshConfig[]>(() => rpc.ssh.getConnections(), []);

    this.connectionStatesResource = new Resource<
      Record<string, ConnectionState>,
      SshConnectionEvent
    >(async () => {
      const states = await rpc.ssh.getConnectionState();
      for (const [connectionId, state] of Object.entries(states)) {
        if (state === 'connected') this.onConnectionReady?.(connectionId);
      }
      return states;
    }, [
      {
        kind: 'event',
        subscribe: (handler) => events.on(sshConnectionEventChannel, handler),
        onEvent: (event, ctx) => {
          if (event.type === 'health-changed') return;
          const next = { ...(ctx.data ?? {}) };
          next[event.connectionId] = toConnectionState(event);
          ctx.set(next);
          if (event.type === 'connected' || event.type === 'reconnected') {
            this.onConnectionReady?.(event.connectionId);
          }
        },
      },
    ]);

    this.healthStatesResource = new Resource<Record<string, SshHealthState>, SshConnectionEvent>(
      () => rpc.ssh.getHealthStates(),
      [
        {
          kind: 'event',
          subscribe: (handler) => events.on(sshConnectionEventChannel, handler),
          onEvent: (event, ctx) => {
            if (event.type !== 'health-changed') return;
            const next = { ...(ctx.data ?? {}) };
            if (event.health.status === 'ok') {
              delete next[event.connectionId];
            } else {
              next[event.connectionId] = event.health;
            }
            ctx.set(next);
          },
        },
      ]
    );

    makeObservable<SshConnectionStore, 'pendingMutations'>(this, {
      pendingMutations: observable,
      connections: computed,
      connectionStates: computed,
      healthStates: computed,
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

  get healthStates(): Record<string, SshHealthState> {
    return this.healthStatesResource.data ?? {};
  }

  get isLoading(): boolean {
    return (
      this.connectionsResource.loading ||
      this.connectionStatesResource.loading ||
      this.healthStatesResource.loading ||
      this.pendingMutations > 0
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connectionStatesResource.start();
    this.healthStatesResource.start();
    void this.connectionsResource.load();
  }

  dispose(): void {
    this.connectionsResource.dispose();
    this.connectionStatesResource.dispose();
    this.healthStatesResource.dispose();
    this.started = false;
  }

  stateFor(connectionId: string): ConnectionState {
    return this.connectionStates[connectionId] ?? 'disconnected';
  }

  healthFor(connectionId: string): SshHealthState {
    return this.healthStates[connectionId] ?? { status: 'ok' };
  }

  async connect(connectionId: string): Promise<void> {
    const state = this.stateFor(connectionId);
    if (state === 'connected' || state === 'connecting' || state === 'reconnecting') {
      return;
    }
    await rpc.ssh.connect(connectionId);
  }

  async saveConnection(config: SaveConnectionInput): Promise<SshConfig> {
    return await this.withMutation(async () => {
      const savedConnection = await rpc.ssh.saveConnection(config);
      this.connectionsResource.setValue(this.upsertConnection(savedConnection));
      return savedConnection;
    });
  }

  async getSshConfigHosts(): Promise<SshConfigHost[]> {
    return await rpc.ssh.getSshConfigHosts();
  }

  async getSshConfigHost(alias: string): Promise<SshConfigHost> {
    return await rpc.ssh.getSshConfigHost(alias);
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

      const currentHealthStates = this.healthStatesResource.data ?? {};
      if (id in currentHealthStates) {
        const { [id]: _removed, ...rest } = currentHealthStates;
        this.healthStatesResource.setValue(rest);
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
