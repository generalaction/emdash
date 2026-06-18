import type { CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import type { Platform } from '@emdash/core/deps';
import {
  deriveHostDependencyStatus,
  resolveActiveInstallation,
  resolveInstallOptions,
  sourceKey,
  toPlatform,
} from '@emdash/core/deps/runtime';
import type {
  DependencyId,
  DependencyState,
  HostDependency,
  HostDependencyManager,
} from '@emdash/core/deps/runtime';
import type {
  AgentInstallationStatus,
  AgentMetadata,
  AgentPayload,
  InstallOption,
} from '@shared/core/agents/agent-payload';
import { AGENT_PROVIDERS, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { getDependencyDescriptor } from '../dependencies/registry';
import { providerOverrideSettings } from '../settings/provider-settings-service';
import { getPlugin, listPlugins } from './plugin-registry';

/**
 * Optional callback injected by the controller so the builder can enrich the
 * manager's HostDependency snapshot with latestVersion/updateAvailable from the
 * AgentUpdateService before building the payload.
 */
type EnrichHostDep = (id: DependencyId, hostDep: HostDependency) => HostDependency;

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
  dependencyManager?: HostDependencyManager,
  enrichHostDep?: EnrichHostDep
): Promise<AgentPayload | null> {
  const provider = getPlugin(id);
  if (!provider) return null;

  const state = dependencyManager?.get(id);
  const settingsMeta = await providerOverrideSettings.getItemWithMeta(id);
  const descriptor = getDependencyDescriptor(id);

  const defaultConfig = settingsMeta?.defaults ?? {};

  const rawHostDep = dependencyManager?.getHostDependency(id);
  const hostDep =
    rawHostDep && enrichHostDep ? enrichHostDep(id as DependencyId, rawHostDep) : rawHostDep;

  // Derive top-level fields from resolveActiveInstallation so the row badge always
  // matches the detail card (both read the used per-installation value).
  const used = hostDep?.used ?? { kind: 'auto' as const };
  const usedInst = hostDep ? resolveActiveInstallation(hostDep.installations, used) : undefined;
  const latestVersion = usedInst?.latestVersion ?? null;
  const updateAvailable = usedInst?.updateAvailable ?? false;

  return {
    ...buildMetadata(provider),
    status: hostDep ? deriveHostDependencyStatus(hostDep) : (state?.status ?? 'missing'),
    version: usedInst?.version ?? state?.version ?? null,
    latestVersion,
    updateAvailable,
    command: usedInst?.pathEntry ?? state?.path ?? null,
    settings: settingsMeta ?? {
      value: defaultConfig,
      defaults: defaultConfig,
      overrides: {},
    },
    installOptions: descriptor ? resolveInstallOptions(descriptor, platform) : [],
    installations: hostDep?.installations ?? [],
    used,
    usedId: sourceKey(used),
  };
}

export async function buildAgentPayload(
  id: string,
  platform: Platform = toPlatform(process.platform),
  dependencyManager?: HostDependencyManager,
  enrichHostDep?: EnrichHostDep
): Promise<AgentPayload | null> {
  return buildOne(id as AgentProviderId, platform, dependencyManager, enrichHostDep);
}

export async function buildAgentPayloads(
  platform: Platform = toPlatform(process.platform),
  dependencyManager?: HostDependencyManager,
  enrichHostDep?: EnrichHostDep
): Promise<AgentPayload[]> {
  const results = await Promise.all(
    AGENT_PROVIDERS.map((p) => buildOne(p.id, platform, dependencyManager, enrichHostDep))
  );
  return results.filter((r): r is AgentPayload => r !== null);
}

export function buildAgentMetadataList(): AgentMetadata[] {
  return listPlugins().map(buildMetadata);
}

/**
 * Maps manager state for a single agent to the renderer-facing AgentInstallationStatus DTO.
 * Top-level latestVersion/updateAvailable are derived from the used installation when
 * host-dependency data is available, so the row badge always matches the update card.
 */
export function toAgentInstallationStatus(
  id: string,
  connectionId: string | undefined,
  state: DependencyState,
  hostDep: HostDependency | undefined,
  installOptions: InstallOption[] = []
): AgentInstallationStatus {
  const used = hostDep?.used ?? { kind: 'auto' as const };
  const usedInst = hostDep ? resolveActiveInstallation(hostDep.installations, used) : undefined;
  return {
    id,
    connectionId,
    status: hostDep ? deriveHostDependencyStatus(hostDep) : state.status,
    version: state.version,
    latestVersion: usedInst?.latestVersion ?? state.latestVersion ?? null,
    updateAvailable: usedInst?.updateAvailable ?? state.updateAvailable ?? false,
    command: usedInst?.pathEntry ?? state.path,
    installations: hostDep?.installations ?? [],
    used,
    usedId: sourceKey(used),
    installOptions,
  };
}
