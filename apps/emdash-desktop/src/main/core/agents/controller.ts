import type { InstallMethod } from '@emdash/shared/deps';
import type {
  DependencyId,
  DependencyProbeOptions,
  HostDependencySelection,
} from '@emdash/shared/deps/runtime';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/core/app-settings';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { getDependencyManager } from '../dependencies/dependency-managers';
import { providerOverrideSettings } from '../settings/provider-settings-service';
import {
  buildAgentMetadataList,
  buildAgentPayload,
  buildAgentPayloads,
} from './agent-payload-builder';

export const agentsController = createRPCController({
  // ── Metadata ────────────────────────────────────────────────────────────────

  list: async (connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return buildAgentPayloads(mgr.platform, mgr);
  },

  get: async (id: string, connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return buildAgentPayload(id, mgr.platform, mgr);
  },

  // ── Installation status ──────────────────────────────────────────────────────

  listAgentInstallationStatus: async (connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    const all = mgr.getAll();
    return Array.from(all.values())
      .filter((s) => s.category === 'agent')
      .map((state) => {
        const hostDep = mgr.getHostDependency(state.id as DependencyId);
        return {
          id: state.id,
          connectionId,
          status: state.status,
          version: state.version,
          latestVersion: state.latestVersion ?? null,
          updateAvailable: state.updateAvailable ?? false,
          command: state.path,
          installations: hostDep?.installations ?? [],
          usedId: hostDep?.usedId ?? '',
          installOptions: [],
        };
      });
  },

  getAgentInstallationStatus: async (id: string, connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    const state = mgr.get(id as DependencyId);
    if (!state) return null;
    const hostDep = mgr.getHostDependency(id as DependencyId);
    return {
      id,
      connectionId,
      status: state.status,
      version: state.version,
      latestVersion: state.latestVersion ?? null,
      updateAvailable: state.updateAvailable ?? false,
      command: state.path,
      installations: hostDep?.installations ?? [],
      usedId: hostDep?.usedId ?? '',
      installOptions: [],
    };
  },

  // ── Install / update ─────────────────────────────────────────────────────────

  install: async (id: AgentProviderId, connectionId?: string, method?: InstallMethod) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.install(id, method);
  },

  update: async (id: AgentProviderId, connectionId?: string, method?: InstallMethod) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.update(id, method);
  },

  // ── Settings ─────────────────────────────────────────────────────────────────

  getDefaultSettings: async (id: string): Promise<ProviderCustomConfig | null> => {
    const meta = await providerOverrideSettings.getItemWithMeta(id);
    return meta?.defaults ?? null;
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
    selection?: HostDependencySelection
  ): Promise<void> => {
    if (!selection) return;
    const mgr = await getDependencyManager(connectionId);
    await mgr.setSelection(id, selection);
  },

  refreshLatestVersion: async (id: DependencyId, connectionId?: string): Promise<void> => {
    const mgr = await getDependencyManager(connectionId);
    await mgr.fetchLatestVersion(id);
  },

  probe: async (id: DependencyId, connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.probe(id);
  },

  probeAll: async (connectionId?: string, options?: DependencyProbeOptions) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.probeAll(options);
  },

  listMetadata: async () => {
    return buildAgentMetadataList();
  },
});
