import type { InstallMethod } from '@emdash/cli-agent-plugins';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/core/app-settings';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { getDependencyManager } from '../dependencies/dependency-manager';
import { providerOverrideSettings } from '../settings/provider-settings-service';
import { buildAgentPayload, buildAgentPayloads } from './agent-payload-builder';

export const agentsController = createRPCController({
  list: async (connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return buildAgentPayloads(Object.fromEntries(mgr.getAll()));
  },

  get: async (id: string, connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return buildAgentPayload(id, Object.fromEntries(mgr.getAll()));
  },

  install: async (id: AgentProviderId, connectionId?: string, method?: InstallMethod) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.install(id, method);
  },

  update: async (id: AgentProviderId, connectionId?: string, method?: InstallMethod) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.update(id, method);
  },

  getDefaultSettings: async (id: string): Promise<ProviderCustomConfig | null> => {
    const meta = await providerOverrideSettings.getItemWithMeta(id);
    return meta?.defaults ?? null;
  },

  updateSettings: (id: string, config: Partial<ProviderCustomConfig>): Promise<void> =>
    providerOverrideSettings.updateItem(id, config),
});
