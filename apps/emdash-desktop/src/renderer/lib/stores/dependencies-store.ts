import type { InstallMethod } from '@emdash/cli-agent-plugins';
import type {
  DependencyId,
  DependencyInstallResult,
  DependencyState,
  DependencyStatusMap,
  DependencyStatusUpdatedEvent,
  DependencyUpdateResult,
  HostDependency,
  HostDependencySelection,
} from '@emdash/shared/deps';
import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { log } from '@renderer/utils/logger';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { dependencyStatusUpdatedChannel } from '@shared/events/appEvents';
import { events, rpc } from '../../lib/ipc';
import { Resource } from './resource';

type InstallOperation = {
  kind: 'install';
  method?: InstallMethod;
  promise: Promise<DependencyInstallResult>;
};
type UpdateOperation = {
  kind: 'update';
  method?: InstallMethod;
  promise: Promise<DependencyUpdateResult>;
};
export type DependencyOperation = InstallOperation | UpdateOperation;

const FOCUS_AGENT_REFRESH_COOLDOWN_MS = 10_000;

export class DependenciesStore {
  readonly local: Resource<DependencyStatusMap, DependencyStatusUpdatedEvent>;
  readonly agents: Resource<AgentPayload[], DependencyStatusUpdatedEvent>;

  private readonly _remoteStores = new Map<string, Resource<DependencyStatusMap>>();
  /** Single observable map tracking all in-flight install and update operations. */
  private readonly _operations = observable.map<string, DependencyOperation>();
  /**
   * Per-host, per-dep HostDependency objects keyed by `${hostId}:${depId}`.
   * Populated from DependencyStatusUpdatedEvent.hostDependency when present.
   */
  private readonly _hostDependencies = observable.map<string, HostDependency>();
  private _focusRefresh: Promise<void> | null = null;
  private _lastFocusRefreshAt = 0;
  private _stopFocusRefresh: (() => void) | null = null;
  private _disposed = false;

  constructor() {
    makeObservable<this, '_operations' | '_hostDependencies'>(this, {
      _operations: observable,
      _hostDependencies: observable,
      allStatuses: computed,
      agentStatuses: computed,
      localInstalledAgents: computed,
      install: action,
      update: action,
      probeAll: action,
      setUsedInstallation: action,
    });

    this.local = new Resource<DependencyStatusMap, DependencyStatusUpdatedEvent>(async () => {
      const result = await rpc.dependencies.getAll();
      return (result ?? {}) as DependencyStatusMap;
    }, [
      {
        kind: 'event',
        subscribe: (handler) => events.on(dependencyStatusUpdatedChannel, handler),
        onEvent: ({ id, state, connectionId, hostDependency }, ctx) => {
          if (hostDependency) {
            const key = `${connectionId ?? 'local'}:${id}`;
            runInAction(() => {
              this._hostDependencies.set(key, hostDependency);
            });
          }
          if (connectionId) {
            const remote = this.getRemote(connectionId);
            remote.setValue({ ...remote.data, [id]: state as DependencyState });
            return;
          }
          ctx.set({ ...ctx.data, [id]: state as DependencyState });
        },
      },
    ]);

    this.agents = new Resource<AgentPayload[], DependencyStatusUpdatedEvent>(
      async () => await (rpc.agents.list() as Promise<AgentPayload[]>),
      [
        {
          kind: 'event',
          subscribe: (handler) => events.on(dependencyStatusUpdatedChannel, handler),
          onEvent: ({ connectionId }, ctx) => {
            if (!connectionId) ctx.reload();
          },
          debounceMs: 300,
        },
      ]
    );
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
        () => this.loadAgentStatuses(connectionId, { refreshShellEnv: true }),
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
    return this._operations.has(this.operationKey(id, connectionId, 'install'));
  }

  isUpdating(id: DependencyId, connectionId?: string): boolean {
    return this._operations.has(this.operationKey(id, connectionId, 'update'));
  }

  /** Returns the current in-flight operation for a dependency, if any. */
  getOperation(id: DependencyId, connectionId?: string): DependencyOperation | undefined {
    return (
      this._operations.get(this.operationKey(id, connectionId, 'install')) ??
      this._operations.get(this.operationKey(id, connectionId, 'update'))
    );
  }

  async install(
    id: DependencyId,
    connectionId?: string,
    method?: InstallMethod
  ): Promise<DependencyInstallResult> {
    const key = this.operationKey(id, connectionId, 'install');
    const existing = this._operations.get(key);
    if (existing) return (existing as InstallOperation).promise;

    const promise = this.runInstall(id, connectionId, key, method);
    runInAction(() => {
      this._operations.set(key, { kind: 'install', method, promise });
    });
    return promise;
  }

  private async runInstall(
    id: DependencyId,
    connectionId: string | undefined,
    key: string,
    method?: InstallMethod
  ): Promise<DependencyInstallResult> {
    try {
      const result = (await rpc.dependencies.install(
        id,
        connectionId,
        method
      )) as DependencyInstallResult;
      if (result.success) {
        // Update state directly from the install result; the async latestVersion
        // enrichment arrives via dependencyStatusUpdatedChannel events as usual.
        const newState = result.data;
        if (!connectionId) {
          this.local.setValue({ ...this.local.data, [id]: newState });
        } else {
          const remote = this.getRemote(connectionId);
          remote.setValue({ ...remote.data, [id]: newState });
        }
      }
      return result;
    } finally {
      runInAction(() => {
        this._operations.delete(key);
      });
    }
  }

  async update(
    id: DependencyId,
    connectionId?: string,
    method?: InstallMethod
  ): Promise<DependencyUpdateResult> {
    const key = this.operationKey(id, connectionId, 'update');
    const existing = this._operations.get(key);
    if (existing) return (existing as UpdateOperation).promise;

    const promise = this.runUpdate(id, connectionId, key, method);
    runInAction(() => {
      this._operations.set(key, { kind: 'update', method, promise });
    });
    return promise;
  }

  private async runUpdate(
    id: DependencyId,
    connectionId: string | undefined,
    key: string,
    method?: InstallMethod
  ): Promise<DependencyUpdateResult> {
    try {
      // update is agent-only; DependencyId is a superset of AgentProviderId
      const result = (await rpc.agents.update(
        id as AgentProviderId,
        connectionId,
        method
      )) as DependencyUpdateResult;
      if (result.success) {
        const newState = result.data;
        if (!connectionId) {
          this.local.setValue({ ...this.local.data, [id]: newState });
        } else {
          const remote = this.getRemote(connectionId);
          remote.setValue({ ...remote.data, [id]: newState });
        }
      }
      return result;
    } finally {
      runInAction(() => {
        this._operations.delete(key);
      });
    }
  }

  async probeAll(): Promise<void> {
    await rpc.dependencies.probeAll(undefined, { refreshShellEnv: true });
    this.local.invalidate();
  }

  /** Returns the HostDependency for a dep on a specific host, if available. */
  getHostDependency(id: DependencyId, connectionId?: string): HostDependency | undefined {
    return this._hostDependencies.get(`${connectionId ?? 'local'}:${id}`);
  }

  /** Persists a host-scoped installation selection and triggers a re-probe. */
  async setUsedInstallation(
    id: DependencyId,
    connectionId: string | undefined,
    selection: HostDependencySelection
  ): Promise<void> {
    await rpc.dependencies.setUsedInstallation(id, connectionId, selection);
    this.agents.invalidate();
  }

  /** Fetch the latest available version for a dep and update state. */
  async refreshLatestVersion(id: DependencyId, connectionId?: string): Promise<void> {
    await rpc.dependencies.refreshLatestVersion(id, connectionId);
  }

  async refreshAgents(
    connectionId?: string,
    options: { refreshShellEnv?: boolean } = {}
  ): Promise<void> {
    if (this._disposed) return;

    const statuses = await this.loadAgentStatuses(connectionId, options);
    if (this._disposed) return;

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
    this.agents.start();

    if (this._stopFocusRefresh || typeof window === 'undefined') return;

    const refreshLocalAgents = () => {
      const now = Date.now();
      if (this._focusRefresh || now - this._lastFocusRefreshAt < FOCUS_AGENT_REFRESH_COOLDOWN_MS) {
        return;
      }

      this._lastFocusRefreshAt = now;
      this._focusRefresh = this.refreshAgents(undefined, { refreshShellEnv: true })
        .catch((error) => {
          log.warn('DependenciesStore: failed to refresh local agents on focus', { error });
        })
        .finally(() => {
          this._focusRefresh = null;
        });
    };
    window.addEventListener('focus', refreshLocalAgents);
    this._stopFocusRefresh = () => {
      window.removeEventListener('focus', refreshLocalAgents);
    };
  }

  /** Dispose all resources (timers, event listeners). */
  dispose(): void {
    this._disposed = true;
    this._stopFocusRefresh?.();
    this._stopFocusRefresh = null;
    this.local.dispose();
    this.agents.dispose();
    for (const store of this._remoteStores.values()) {
      store.dispose();
    }
    this._remoteStores.clear();
  }

  private operationKey(
    id: DependencyId,
    connectionId: string | undefined,
    kind: 'install' | 'update'
  ): string {
    return `${connectionId ?? 'local'}:${id}:${kind}`;
  }

  private async loadAgentStatuses(
    connectionId?: string,
    options: { refreshShellEnv?: boolean } = {}
  ): Promise<DependencyStatusMap> {
    const probeOptions = options.refreshShellEnv ? { refreshShellEnv: true } : undefined;
    await rpc.dependencies.probeCategory('agent', connectionId, probeOptions);
    const all = await rpc.dependencies.getAll(connectionId);
    return (all ?? {}) as DependencyStatusMap;
  }
}
