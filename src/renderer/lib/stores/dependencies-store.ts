import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type {
  DependencyId,
  DependencyInstallResult,
  DependencyState,
  DependencyStatusMap,
  DependencyStatusUpdatedEvent,
} from '@shared/dependencies';
import { dependencyStatusUpdatedChannel } from '@shared/events/appEvents';
import { events, rpc } from '../../lib/ipc';
import { Resource } from './resource';

export class DependenciesStore {
  readonly local: Resource<DependencyStatusMap, DependencyStatusUpdatedEvent>;

  private readonly _remoteStores = new Map<string, Resource<DependencyStatusMap>>();
  private readonly _installingDependencyKeys = observable.set<string>();
  private readonly _inFlightInstalls = new Map<string, Promise<DependencyInstallResult>>();

  constructor() {
    makeObservable<this, '_installingDependencyKeys'>(this, {
      _installingDependencyKeys: observable,
      allStatuses: computed,
      agentStatuses: computed,
      localInstalledAgents: computed,
      install: action,
      probeAll: action,
    });

    this.local = new Resource<DependencyStatusMap, DependencyStatusUpdatedEvent>(async () => {
      const result = await rpc.dependencies.getAll();
      return (result ?? {}) as DependencyStatusMap;
    }, [
      {
        kind: 'event',
        subscribe: (handler) => events.on(dependencyStatusUpdatedChannel, handler),
        onEvent: ({ id, state, connectionId }, ctx) => {
          if (connectionId) {
            const remote = this.getRemote(connectionId);
            remote.setValue({ ...(remote.data ?? {}), [id]: state as DependencyState });
            return;
          }
          ctx.set({ ...(ctx.data ?? {}), [id]: state as DependencyState });
        },
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  get allStatuses(): DependencyStatusMap {
    return this.local.data ?? {};
  }

  get agentStatuses(): DependencyStatusMap {
    return Object.fromEntries(
      Object.entries(this.allStatuses).filter(([, s]) => s.category === 'agent')
    );
  }

  get localInstalledAgents(): string[] {
    return Object.entries(this.agentStatuses)
      .filter(([, s]) => s.status === 'available')
      .map(([id]) => id);
  }

  // ---------------------------------------------------------------------------
  // Remote (per SSH connection)
  // ---------------------------------------------------------------------------

  /**
   * Returns (and lazily creates) a demand-loaded Resource for a remote connection.
   * The resource probes all agent-category dependencies over SSH then fetches
   * the results. It loads on first observer attachment.
   */
  getRemote(connectionId: string): Resource<DependencyStatusMap> {
    let store = this._remoteStores.get(connectionId);
    if (!store) {
      store = new Resource<DependencyStatusMap>(
        () => this.loadAgentStatuses(connectionId),
        [{ kind: 'demand' }]
      );
      this._remoteStores.set(connectionId, store);
    }
    return store;
  }

  /**
   * Returns the installed agent IDs for a remote connection.
   * Reads from the demand-loaded resource; returns [] while loading.
   */
  remoteInstalledAgents(connectionId: string): string[] {
    const data = this.getRemote(connectionId).data;
    if (!data) return [];
    return Object.entries(data)
      .filter(([, s]) => s.status === 'available')
      .map(([id]) => id);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  isInstalling(id: DependencyId, connectionId?: string): boolean {
    return this._installingDependencyKeys.has(this.installKey(id, connectionId));
  }

  async install(id: DependencyId, connectionId?: string): Promise<DependencyInstallResult> {
    const key = this.installKey(id, connectionId);
    const existing = this._inFlightInstalls.get(key);
    if (existing) return existing;

    const install = this.runInstall(id, connectionId, key);
    this._inFlightInstalls.set(key, install);
    return install;
  }

  private async runInstall(
    id: DependencyId,
    connectionId: string | undefined,
    key: string
  ): Promise<DependencyInstallResult> {
    runInAction(() => {
      this._installingDependencyKeys.add(key);
    });

    try {
      const result = (await rpc.dependencies.install(id, connectionId)) as DependencyInstallResult;
      if (!result.success) return result;

      await this.refreshAgents(connectionId);
      return result;
    } finally {
      this._inFlightInstalls.delete(key);
      runInAction(() => {
        this._installingDependencyKeys.delete(key);
      });
    }
  }

  async probeAll(): Promise<void> {
    await rpc.dependencies.probeAll();
    this.local.invalidate();
  }

  async refreshAgents(connectionId?: string): Promise<void> {
    const statuses = await this.loadAgentStatuses(connectionId);
    if (connectionId) {
      this.getRemote(connectionId).setValue(statuses);
      return;
    }
    this.local.setValue(statuses);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Activate the event subscription and trigger the initial local fetch. */
  start(): void {
    this.local.start();
  }

  /** Dispose all resources (timers, event listeners). */
  dispose(): void {
    this.local.dispose();
    for (const store of this._remoteStores.values()) {
      store.dispose();
    }
    this._remoteStores.clear();
  }

  private installKey(id: DependencyId, connectionId?: string): string {
    return `${connectionId ?? 'local'}:${id}`;
  }

  private async loadAgentStatuses(connectionId?: string): Promise<DependencyStatusMap> {
    await rpc.dependencies.probeCategory('agent', connectionId);
    const all = await rpc.dependencies.getAll(connectionId);
    return (all ?? {}) as DependencyStatusMap;
  }
}
