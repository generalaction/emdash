import type { CLIAgentPluginProvider } from '@emdash/shared/agents/plugins';
import type { Platform } from '@emdash/shared/deps';
import { resolveInstallOptions, toPlatform } from '@emdash/shared/deps/runtime';
import type { HostDependencyManager } from '@emdash/shared/deps/runtime/node';
import type { AgentMetadata, AgentPayload } from '@shared/core/agents/agent-payload';
import { AGENT_PROVIDERS, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { getDependencyDescriptor } from '../dependencies/registry';
import { providerOverrideSettings } from '../settings/provider-settings-service';
import { getPlugin, listPlugins } from './plugin-registry';

function buildMetadata(provider: CLIAgentPluginProvider): AgentMetadata {
  const { metadata, capabilities, assets } = provider;
  return {
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    websiteUrl: metadata.websiteUrl,
    icon: assets.icon,
    capabilities: {
      hostDependency: capabilities.hostDependency,
      models: capabilities.models,
      effort: capabilities.effort,
      prompt: capabilities.prompt,
      sessions: capabilities.sessions,
      autoApprove: capabilities.autoApprove,
      hooks: capabilities.hooks,
      mcp: capabilities.mcp,
      plugins: capabilities.plugins,
    },
    installDocs: capabilities.hostDependency.installDocs ?? null,
  };
}

async function buildOne(
  id: AgentProviderId,
  platform: Platform,
  dependencyManager?: HostDependencyManager
): Promise<AgentPayload | null> {
  const provider = getPlugin(id);
  if (!provider) return null;

  const state = dependencyManager?.get(id);
  const settingsMeta = await providerOverrideSettings.getItemWithMeta(id);
  const descriptor = getDependencyDescriptor(id);

  const defaultConfig = settingsMeta?.defaults ?? {};

  const hostDep = dependencyManager?.getHostDependency(id);

  return {
    ...buildMetadata(provider),
    status: state?.status ?? 'missing',
    version: state?.version ?? null,
    latestVersion: state?.latestVersion ?? null,
    updateAvailable: state?.updateAvailable ?? false,
    command: state?.path ?? null,
    settings: settingsMeta ?? {
      value: defaultConfig,
      defaults: defaultConfig,
      overrides: {},
    },
    installOptions: descriptor ? resolveInstallOptions(descriptor, platform) : [],
    installations: hostDep?.installations ?? [],
    usedId: hostDep?.usedId ?? '',
  };
}

export async function buildAgentPayload(
  id: string,
  platform: Platform = toPlatform(process.platform),
  dependencyManager?: HostDependencyManager
): Promise<AgentPayload | null> {
  return buildOne(id as AgentProviderId, platform, dependencyManager);
}

export async function buildAgentPayloads(
  platform: Platform = toPlatform(process.platform),
  dependencyManager?: HostDependencyManager
): Promise<AgentPayload[]> {
  const results = await Promise.all(
    AGENT_PROVIDERS.map((p) => buildOne(p.id, platform, dependencyManager))
  );
  return results.filter((r): r is AgentPayload => r !== null);
}

export function buildAgentMetadataList(): AgentMetadata[] {
  return listPlugins().map(buildMetadata);
}
