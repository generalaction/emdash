import { pluginRegistry } from '@emdash/cli-agent-plugins/registry';
import type { CLIAgentPluginMetadata, CLIAgentPluginProvider } from '@emdash/shared/agents/plugins';
import { AGENT_PROVIDER_IDS } from '@shared/core/agents/agent-provider-registry';

// Assert plugin ids match the canonical AGENT_PROVIDER_IDS list at startup.
const pluginIds = new Set(pluginRegistry.ids());
for (const id of AGENT_PROVIDER_IDS) {
  if (!pluginIds.has(id)) {
    throw new Error(`Plugin registry parity violation: missing plugin for provider '${id}'`);
  }
}

export function getPlugin(id: string): CLIAgentPluginProvider {
  const plugin = pluginRegistry.get(id);
  if (!plugin) throw new Error(`No plugin found for provider: ${id}`);
  return plugin;
}

export function getPluginMetadata(id: string): CLIAgentPluginMetadata {
  const plugin = pluginRegistry.get(id);
  if (!plugin) throw new Error(`No plugin metadata found for provider: ${id}`);
  return plugin.metadata;
}

export function listPlugins(): CLIAgentPluginProvider[] {
  return pluginRegistry.getAll();
}
