import { createLiveModelReplica, type ContractClient } from '@emdash/wire';
import { OptimisticLiveModel } from '@emdash/wire/util/mobx';
import {
  action,
  computed,
  makeObservable,
  observable,
  reaction,
  runInAction,
  type IReactionDisposer,
} from 'mobx';
import type {
  ConnectionState,
  ConnectionTestResult,
  SshConfig,
  SshConfigHost,
  SshHealthState,
} from '@core/primitives/ssh/api';
import { sshContract, type SshConnectionsRuntime } from '@core/services/ssh/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { Resource } from '@renderer/lib/stores/resource';
import type { machinesContract } from '../api';

type SaveConnectionInput = Partial<Pick<SshConfig, 'id'>> &
  Omit<SshConfig, 'id'> & { password?: string; passphrase?: string };
type SshClient = ContractClient<typeof sshContract>;
type MachinesClient = ContractClient<typeof machinesContract>;
type ConnectionsModel = OptimisticLiveModel<typeof sshContract.connections>;

export type MachinesStoreOptions = {
  onConnectionReady?: (connectionId: string) => void;
  sshClient?: SshClient;
  machinesClient?: MachinesClient;
};

export class MachinesStore {
  readonly connectionsResource: Resource<SshConfig[]>;

  private pendingMutations = 0;
  private started = false;
  private modelReady = false;
  private model: ConnectionsModel | undefined;
  private startPromise: Promise<void> | undefined;
  private disposeConnectionReaction: IReactionDisposer | undefined;
  private sshClientPromise: Promise<SshClient> | undefined;
  private machinesClientPromise: Promise<MachinesClient> | undefined;
  private readonly sshClientOverride?: SshClient;
  private readonly machinesClientOverride?: MachinesClient;
  private readonly onConnectionReady?: (connectionId: string) => void;

  constructor({ onConnectionReady, sshClient, machinesClient }: MachinesStoreOptions = {}) {
    this.onConnectionReady = onConnectionReady;
    this.sshClientOverride = sshClient;
    this.machinesClientOverride = machinesClient;
    this.connectionsResource = new Resource<SshConfig[]>(
      async () => (await this.getMachinesClient()).getMachines(undefined),
      []
    );

    makeObservable<MachinesStore, 'model' | 'modelReady' | 'pendingMutations' | 'started'>(this, {
      model: observable.ref,
      modelReady: observable,
      pendingMutations: observable,
      started: observable,
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
    return Object.fromEntries(
      Object.entries(this.runtime).map(([connectionId, value]) => [connectionId, value.state])
    );
  }

  get healthStates(): Record<string, SshHealthState> {
    return Object.fromEntries(
      Object.entries(this.runtime).map(([connectionId, value]) => [connectionId, value.health])
    );
  }

  get isLoading(): boolean {
    return (
      this.connectionsResource.loading ||
      !this.modelReady ||
      (this.model?.isPending ?? false) ||
      this.pendingMutations > 0
    );
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.started = true;
    this.startPromise = Promise.all([
      this.connectionsResource.load(),
      this.initializeConnectionsModel(),
    ]).then(() => {});
    return this.startPromise;
  }

  dispose(): void {
    this.started = false;
    this.modelReady = false;
    this.startPromise = undefined;
    this.connectionsResource.dispose();
    this.disposeConnectionReaction?.();
    this.disposeConnectionReaction = undefined;
    const model = this.model;
    this.model = undefined;
    if (model) void model.dispose();
  }

  stateFor(connectionId: string): ConnectionState {
    return this.runtime[connectionId]?.state ?? 'disconnected';
  }

  healthFor(connectionId: string): SshHealthState {
    return this.runtime[connectionId]?.health ?? { status: 'ok' };
  }

  async connect(connectionId: string, options: { force?: boolean } = {}): Promise<void> {
    await this.ensureConnectionsModel();
    const state = this.stateFor(connectionId);
    if (
      state === 'connected' ||
      state === 'connecting' ||
      (!options.force && state === 'reconnecting')
    ) {
      return;
    }

    await (await this.getSshClient()).connect({ connectionId });
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.ensureConnectionsModel();
    await (await this.getSshClient()).disconnect({ connectionId });
  }

  async saveConnection(config: SaveConnectionInput): Promise<SshConfig> {
    return await this.withMutation(async () => {
      const savedConnection = await (await this.getMachinesClient()).saveMachine(config);
      this.connectionsResource.setValue(this.upsertConnection(savedConnection));
      return savedConnection;
    });
  }

  async getSshConfigHosts(): Promise<SshConfigHost[]> {
    return await (await this.getSshClient()).getSshConfigHosts(undefined);
  }

  async getSshConfigHost(alias: string): Promise<SshConfigHost> {
    return await (await this.getSshClient()).getSshConfigHost({ alias });
  }

  async renameConnection(id: string, name: string): Promise<void> {
    await this.withMutation(async () => {
      await (await this.getMachinesClient()).renameMachine({ id, name });
      const current = this.connectionsResource.data ?? [];
      this.connectionsResource.setValue(
        current.map((connection) => (connection.id === id ? { ...connection, name } : connection))
      );
    });
  }

  async deleteConnection(id: string): Promise<void> {
    await this.withMutation(async () => {
      await (await this.getMachinesClient()).deleteMachine({ id });
      const currentConnections = this.connectionsResource.data ?? [];
      this.connectionsResource.setValue(
        currentConnections.filter((connection) => connection.id !== id)
      );
    });
  }

  async testConnection(
    config: SshConfig & { password?: string; passphrase?: string }
  ): Promise<ConnectionTestResult> {
    return await (await this.getSshClient()).testConnection(config);
  }

  private get runtime(): SshConnectionsRuntime {
    return this.model?.values.runtime ?? {};
  }

  private getSshClient(): Promise<SshClient> {
    this.sshClientPromise ??= this.sshClientOverride
      ? Promise.resolve(this.sshClientOverride)
      : getDesktopWireClient().then((desktopClient) => desktopClient.ssh);
    return this.sshClientPromise;
  }

  private getMachinesClient(): Promise<MachinesClient> {
    this.machinesClientPromise ??= this.machinesClientOverride
      ? Promise.resolve(this.machinesClientOverride)
      : getDesktopWireClient().then((desktopClient) => desktopClient.machines);
    return this.machinesClientPromise;
  }

  private async initializeConnectionsModel(): Promise<void> {
    const client = await this.getSshClient();
    if (!this.started) return;

    const replica = createLiveModelReplica(sshContract.connections, client.connections);
    const model = new OptimisticLiveModel(sshContract.connections, undefined, replica);
    runInAction(() => {
      this.model = model;
    });
    await model.ready;

    if (!this.started || this.model !== model) {
      await model.dispose();
      return;
    }

    this.disposeConnectionReaction = reaction(
      () => model.values.runtime ?? {},
      (runtime, previousRuntime) => {
        for (const [connectionId, value] of Object.entries(runtime)) {
          if (
            value.state === 'connected' &&
            previousRuntime?.[connectionId]?.state !== 'connected'
          ) {
            this.onConnectionReady?.(connectionId);
          }
        }
      },
      { fireImmediately: true }
    );
    runInAction(() => {
      this.modelReady = true;
    });
  }

  private async ensureConnectionsModel(): Promise<ConnectionsModel> {
    await this.start();
    if (!this.model || !this.modelReady) throw new Error('SSH connections model is not ready');
    return this.model;
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
