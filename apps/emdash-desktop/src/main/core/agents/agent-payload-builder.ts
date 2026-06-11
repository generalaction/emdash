import type { Platform } from '@emdash/cli-agent-plugins';
import { metadataRegistry } from '@emdash/cli-agent-plugins/metadata';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import { AGENT_PROVIDERS, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { DependencyStatusMap } from '@shared/core/dependencies';
import { resolveInstallOptions, toPlatform } from '../dependencies/install-options';
import { getDependencyDescriptor } from '../dependencies/registry';
import { providerOverrideSettings } from '../settings/provider-settings-service';

async function buildOne(
  id: AgentProviderId,
  statuses: DependencyStatusMap,
  platform: Platform
): Promise<AgentPayload | null> {
  const meta = metadataRegistry.get(id);
  if (!meta) return null;

  const state = statuses[id];
  const settingsMeta = await providerOverrideSettings.getItemWithMeta(id);
  const descriptor = getDependencyDescriptor(id);

  const defaultConfig = settingsMeta?.defaults ?? {
    cli: meta.capabilities.install.binaryNames[0] ?? id,
  };

  return {
    id,
    name: meta.name,
    description: meta.description,
    websiteUrl: meta.websiteUrl ?? null,
    status: state?.status ?? 'missing',
    version: state?.version ?? null,
    latestVersion: state?.latestVersion ?? null,
    updateAvailable: state?.updateAvailable ?? false,
    command: state?.path ?? null,
    capabilities: meta.capabilities,
    settings: settingsMeta ?? {
      value: defaultConfig,
      defaults: defaultConfig,
      overrides: {},
    },
    installOptions: descriptor ? resolveInstallOptions(descriptor, platform) : [],
    installDocs: meta.capabilities.install.installDocs ?? null,
  };
}

export async function buildAgentPayload(
  id: string,
  statuses: DependencyStatusMap,
  platform: Platform = toPlatform(process.platform)
): Promise<AgentPayload | null> {
  return buildOne(id as AgentProviderId, statuses, platform);
}

export async function buildAgentPayloads(
  statuses: DependencyStatusMap,
  platform: Platform = toPlatform(process.platform)
): Promise<AgentPayload[]> {
  const results = await Promise.all(AGENT_PROVIDERS.map((p) => buildOne(p.id, statuses, platform)));
  return results.filter((r): r is AgentPayload => r !== null);
}
