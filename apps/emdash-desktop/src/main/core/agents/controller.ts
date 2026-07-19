import type {
  DependencyId,
  HostDependencySnapshot,
} from '@emdash/core/services/host-dependencies/node';
import { runtimeResolveErrorAsError } from '@emdash/core/services/runtime-broker/api';
import type { AgentProviderId } from '@emdash/plugins/agents';
import type { ProviderCustomConfig } from '@core/primitives/app-settings/api';
import {
  ensureAgentDependenciesProbed,
  getDependencyManager,
  type HostDependenciesClient,
} from '../dependencies/dependency-managers';
import { providerOverrideSettings } from '../settings/provider-settings-service';
import {
  buildAgentMetadataList,
  buildAgentPayload,
  buildAgentPayloads,
  toAgentInstallationStatus,
} from './agent-payload-builder';

export const agentOperations = {
  // ── Metadata ────────────────────────────────────────────────────────────────

  list: async (connectionId?: string, manager?: HostDependenciesClient) => {
    const mgr = await resolveDependencyManager(connectionId, manager);
    const snapshot = await snapshotFor(mgr);
    return buildAgentPayloads(snapshot, connectionId);
  },

  get: async (id: string, connectionId?: string, manager?: HostDependenciesClient) => {
    const mgr = await resolveDependencyManager(connectionId, manager);
    const snapshot = await snapshotFor(mgr);
    return buildAgentPayload(id, snapshot, connectionId);
  },

  // ── Installation status ──────────────────────────────────────────────────────

  listAgentInstallationStatus: async (connectionId?: string, manager?: HostDependenciesClient) => {
    const mgr = await resolveDependencyManager(connectionId, manager);
    const snapshot = await snapshotFor(mgr);
    return Object.values(snapshot.dependencies)
      .filter((view) => view.definition.category === 'agent')
      .map((view) => toAgentInstallationStatus(view.definition.id, connectionId, view));
  },

  getAgentInstallationStatus: async (
    id: string,
    connectionId?: string,
    manager?: HostDependenciesClient
  ) => {
    const mgr = await resolveDependencyManager(connectionId, manager);
    const snapshot = await snapshotFor(mgr);
    return toAgentInstallationStatus(id, connectionId, snapshot.dependencies[id]);
  },

  // ── Install / update ─────────────────────────────────────────────────────────

  update: async (_id: AgentProviderId, _connectionId?: string, _method?: unknown) => ({
    success: false as const,
    error: { type: 'no-update-command' as const, id: _id },
  }),

  install: async (id: AgentProviderId, _connectionId?: string, _method?: unknown) => ({
    success: false as const,
    error: { type: 'no-install-command' as const, id },
  }),

  uninstall: async (id: AgentProviderId, _connectionId?: string, _method?: unknown) => ({
    success: false as const,
    error: { type: 'no-uninstall-strategy' as const, id },
  }),

  // ── Settings ─────────────────────────────────────────────────────────────────

  getDefaultSettings: async (id: string): Promise<ProviderCustomConfig> => {
    const meta = await providerOverrideSettings.getItemWithMeta(id);
    return meta.defaults;
  },

  getSettings: async (id: string) => {
    return providerOverrideSettings.getItemWithMeta(id);
  },

  updateSettings: (id: string, config: Partial<ProviderCustomConfig>): Promise<void> =>
    providerOverrideSettings.updateItem(id, config),

  // ── Selection + probe ────────────────────────────────────────────────────────

  setUsedInstallation: async (
    id: DependencyId,
    connectionId?: string,
    selection?: unknown,
    manager?: HostDependenciesClient
  ): Promise<void> => {
    // undefined = no-op; null = explicit auto (clear override)
    if (selection === undefined) return;
    const mgr = await resolveDependencyManager(connectionId, manager);
    await mgr.snapshot.mutate('setSelection', {
      key: undefined,
      input: { id, selection: normalizeSelection(selection) },
    });
  },

  probe: async (id: DependencyId, connectionId?: string, manager?: HostDependenciesClient) => {
    const mgr = await resolveDependencyManager(connectionId, manager);
    const result = await mgr.snapshot.mutate('refresh', {
      key: undefined,
      input: { id },
    });
    return result.success ? result.data.data.dependencies[id] : result;
  },

  probeOverride: async (
    _id: DependencyId,
    _selection: { path?: string; cli?: string },
    _connectionId?: string
  ) => null,

  refreshLatestVersion: async (_id: DependencyId, _connectionId?: string): Promise<void> => {},

  probeAll: async (connectionId?: string, manager?: HostDependenciesClient) => {
    const mgr = await resolveDependencyManager(connectionId, manager);
    await ensureAgentDependenciesProbed(mgr);
  },

  listMetadata: async () => {
    return buildAgentMetadataList();
  },
};

async function resolveDependencyManager(
  connectionId?: string,
  manager?: HostDependenciesClient
): Promise<HostDependenciesClient> {
  if (manager) return manager;
  const result = await getDependencyManager(connectionId);
  if (!result.success) throw runtimeResolveErrorAsError(result.error);
  return result.data;
}

async function snapshotFor(manager: HostDependenciesClient): Promise<HostDependencySnapshot> {
  await ensureAgentDependenciesProbed(manager);
  const snapshot = await manager.snapshot.state(undefined, 'current').snapshot();
  return snapshot.data;
}

function normalizeSelection(selection: unknown): { kind: 'path'; path: string } | null {
  if (selection === null) return null;
  if (typeof selection !== 'object' || selection === null) return null;
  const candidate = selection as {
    kind?: unknown;
    path?: unknown;
    realpath?: unknown;
    command?: unknown;
  };
  if (candidate.kind === 'path' && typeof candidate.path === 'string') {
    return { kind: 'path', path: candidate.path };
  }
  if (candidate.kind === 'pinned' && typeof candidate.realpath === 'string') {
    return { kind: 'path', path: candidate.realpath };
  }
  if (
    candidate.kind === 'cli' &&
    typeof candidate.command === 'string' &&
    candidate.command.startsWith('/')
  ) {
    return { kind: 'path', path: candidate.command };
  }
  return null;
}
