import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type {
  ConnectionState,
  ConnectionTestResult,
  SshConfig,
  SshConfigHost,
  SshHealthState,
  SshConnectionEvent,
} from '@core/primitives/ssh/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
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
  private unsubscribeEvents: (() => void) | undefined;
  private readonly onConnectionReady?: (connectionId: string) => void;

  constructor({ onConnectionReady }: SshConnectionStoreOptions = {}) {
    this.onConnectionReady = onConnectionReady;
    this.connectionsResource = new Resource<SshConfig[]>(
      async () => (await getDesktopWireClient()).ssh.getConnections(undefined),
      []
    );

    this.connectionStatesResource = new Resource<
      Record<string, ConnectionState>,
      SshConnectionEvent
    >(async () => {
      const states = await (await getDesktopWireClient()).ssh.getConnectionState(undefined);
      for (const [connectionId, state] of Object.entries(states)) {
        if (state === 'connected') this.onConnectionReady?.(connectionId);
      }
      return states;
    }, []);

    this.healthStatesResource = new Resource<Record<string, SshHealthState>, SshConnectionEvent>(
      async () => (await getDesktopWireClient()).ssh.getHealthStates(undefined),
      []
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
    void this.subscribeEvents();
  }

  dispose(): void {
    this.connectionsResource.dispose();
    this.connectionStatesResource.dispose();
    this.healthStatesResource.dispose();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    this.started = false;
  }

  stateFor(connectionId: string): ConnectionState {
    return this.connectionStates[connectionId] ?? 'disconnected';
  }

  healthFor(connectionId: string): SshHealthState {
    return this.healthStates[connectionId] ?? { status: 'ok' };
  }

  async connect(connectionId: string, options: { force?: boolean } = {}): Promise<void> {
    const state = this.stateFor(connectionId);
    if (
      state === 'connected' ||
      state === 'connecting' ||
      (!options.force && state === 'reconnecting')
    ) {
      return;
    }
    await (await getDesktopWireClient()).ssh.connect({ connectionId });
  }

  async saveConnection(config: SaveConnectionInput): Promise<SshConfig> {
    return await this.withMutation(async () => {
      const savedConnection = await (await getDesktopWireClient()).ssh.saveConnection(config);
      this.connectionsResource.setValue(this.upsertConnection(savedConnection));
      return savedConnection;
    });
  }

  async getSshConfigHosts(): Promise<SshConfigHost[]> {
    return await (await getDesktopWireClient()).ssh.getSshConfigHosts(undefined);
  }

  async getSshConfigHost(alias: string): Promise<SshConfigHost> {
    return await (await getDesktopWireClient()).ssh.getSshConfigHost({ alias });
  }

  async renameConnection(id: string, name: string): Promise<void> {
    await this.withMutation(async () => {
      await (await getDesktopWireClient()).ssh.renameConnection({ id, name });
      const current = this.connectionsResource.data ?? [];
      this.connectionsResource.setValue(
        current.map((connection) => (connection.id === id ? { ...connection, name } : connection))
      );
    });
  }

  async deleteConnection(id: string): Promise<void> {
    await this.withMutation(async () => {
      await (await getDesktopWireClient()).ssh.deleteConnection({ id });

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
    return await (await getDesktopWireClient()).ssh.testConnection(config);
  }

  private async subscribeEvents(): Promise<void> {
    const client = await getDesktopWireClient();
    const unsubscribe = await client.ssh.events.subscribe(undefined, {
      onEvent: (event) => this.applyEvent(event),
      onGap: () => {
        this.connectionStatesResource.invalidate();
        this.healthStatesResource.invalidate();
      },
    });
    if (!this.started) {
      unsubscribe();
      return;
    }
    this.unsubscribeEvents = unsubscribe;
  }

  private applyEvent(event: SshConnectionEvent): void {
    if (event.type === 'health-changed') {
      const next = { ...(this.healthStatesResource.data ?? {}) };
      if (event.health.status === 'ok') delete next[event.connectionId];
      else next[event.connectionId] = event.health;
      this.healthStatesResource.setValue(next);
      return;
    }

    const next = { ...(this.connectionStatesResource.data ?? {}) };
    next[event.connectionId] = toConnectionState(event);
    this.connectionStatesResource.setValue(next);
    if (event.type === 'connected' || event.type === 'reconnected') {
      this.onConnectionReady?.(event.connectionId);
    }
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
