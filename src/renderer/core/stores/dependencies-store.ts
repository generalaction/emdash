import { action, computed, makeObservable, runInAction } from 'mobx';
import {
  dependencyStatusUpdatedChannel,
  type DependencyStatePayload,
} from '@shared/events/appEvents';
import { events, rpc } from '../ipc';
import { Resource } from './resource';

export type DependencyState = DependencyStatePayload;

type StatusMap = Record<string, DependencyState>;

export class DependenciesStore {
  readonly local: Resource<StatusMap, { id: string; state: DependencyState }>;

  private readonly _remoteStores = new Map<string, Resource<StatusMap>>();

  constructor() {
    makeObservable(this, {
      allStatuses: computed,
      agentStatuses: computed,
      localInstalledAgents: computed,
      install: action,
      probeAll: action,
    });

    this.local = new Resource<StatusMap, { id: string; state: DependencyState }>(async () => {
      const result = await rpc.dependencies.getAll();
      return (result ?? {}) as StatusMap;
    }, [
      {
        kind: 'event',
        subscribe: (handler) => events.on(dependencyStatusUpdatedChannel, handler),
        onEvent: ({ id, state }, ctx) => {
          ctx.set({ ...(ctx.data ?? {}), [id]: state as DependencyState });
        },
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  get allStatuses(): StatusMap {
    return this.local.data ?? {};
  }

  get agentStatuses(): StatusMap {
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
  getRemote(connectionId: string): Resource<StatusMap> {
    let store = this._remoteStores.get(connectionId);
    if (!store) {
      store = new Resource<StatusMap>(async () => {
        await rpc.dependencies.probeCategory('agent', connectionId);
        const all = await rpc.dependencies.getAll(connectionId);
        return (all ?? {}) as StatusMap;
      }, [{ kind: 'demand' }]);
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

  async install(id: string): Promise<DependencyState> {
    const updated = (await rpc.dependencies.install(
      id as Parameters<typeof rpc.dependencies.install>[0]
    )) as DependencyState;
    runInAction(() => {
      this.local.setValue({ ...this.allStatuses, [id]: updated });
    });
    return updated;
  }

  async probeAll(): Promise<void> {
    await rpc.dependencies.probeAll();
    this.local.invalidate();
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
}
