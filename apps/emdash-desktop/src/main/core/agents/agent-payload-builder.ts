import { metadataRegistry } from '@emdash/cli-agent-plugins/metadata';
import type { InstallOption } from '@emdash/cli-agent-plugins';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import { AGENT_PROVIDERS, type AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { DependencyStatusMap } from '@shared/core/dependencies';
import { providerOverrideSettings } from '../settings/provider-settings-service';

const CURRENT_PLATFORM =
  process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';

function resolveInstallOptions(meta: { capabilities: { install: { installCommands: Partial<Record<string, InstallOption[]>> } } }): InstallOption[] {
  return meta.capabilities.install.installCommands[CURRENT_PLATFORM] ?? [];
}

async function buildOne(
  id: AgentProviderId,
  statuses: DependencyStatusMap
): Promise<AgentPayload | null> {
  const meta = metadataRegistry.get(id);
  if (!meta) return null;

  const state = statuses[id];
  const settingsMeta = await providerOverrideSettings.getItemWithMeta(id);

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
    installOptions: resolveInstallOptions(meta),
  };
}

export async function buildAgentPayload(
  id: string,
  statuses: DependencyStatusMap
): Promise<AgentPayload | null> {
  return buildOne(id as AgentProviderId, statuses);
}

export async function buildAgentPayloads(statuses: DependencyStatusMap): Promise<AgentPayload[]> {
  const results = await Promise.all(AGENT_PROVIDERS.map((p) => buildOne(p.id, statuses)));
  return results.filter((r): r is AgentPayload => r !== null);
}
