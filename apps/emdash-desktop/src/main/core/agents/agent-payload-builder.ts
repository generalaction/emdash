import { metadataRegistry } from 'cli-agent-plugins/metadata';

import {
  AGENT_PROVIDERS,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import type { DependencyStatusMap } from '@shared/core/dependencies';

import { providerOverrideSettings } from '../settings/provider-settings-service';

const PROVIDER_MAP = new Map(AGENT_PROVIDERS.map((p) => [p.id, p]));

async function buildOne(
  id: AgentProviderId,
  statuses: DependencyStatusMap
): Promise<AgentPayload | null> {
  const meta = metadataRegistry.get(id);
  if (!meta) return null;

  const provider = PROVIDER_MAP.get(id);
  const state = statuses[id];
  const settingsMeta = await providerOverrideSettings.getItemWithMeta(id);

  const defaultConfig = settingsMeta?.defaults ?? { cli: meta.capabilities.install.binaryNames[0] ?? id };

  return {
    id,
    name: meta.name,
    description: meta.description,
    websiteUrl: meta.websiteUrl ?? null,
    iconName: provider?.icon ?? null,
    iconDarkName: provider?.iconDark ?? null,
    invertInDark: provider?.invertInDark ?? false,
    alt: provider?.alt ?? null,
    status: state?.status ?? 'missing',
    version: state?.version ?? null,
    command: state?.path ?? null,
    capabilities: meta.capabilities,
    settings: settingsMeta ?? {
      value: defaultConfig,
      defaults: defaultConfig,
      overrides: {},
    },
  };
}

export async function buildAgentPayload(
  id: string,
  statuses: DependencyStatusMap
): Promise<AgentPayload | null> {
  return buildOne(id as AgentProviderId, statuses);
}

export async function buildAgentPayloads(
  statuses: DependencyStatusMap
): Promise<AgentPayload[]> {
  const results = await Promise.all(
    AGENT_PROVIDERS.map((p) => buildOne(p.id, statuses))
  );
  return results.filter((r): r is AgentPayload => r !== null);
}
