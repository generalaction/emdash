import type { CLIAgentPluginMetadata, CLIAgentPluginProvider } from 'cli-agent-plugins';
import { metadataRegistry } from 'cli-agent-plugins/metadata';
import { providerRegistry } from 'cli-agent-plugins/providers';
import { AGENT_PROVIDER_IDS } from '@shared/core/agents/agent-provider-registry';

// Assert plugin ids match the canonical AGENT_PROVIDER_IDS list at startup.
const pluginIds = new Set(providerRegistry.ids());
for (const id of AGENT_PROVIDER_IDS) {
  if (!pluginIds.has(id)) {
    throw new Error(`Plugin registry parity violation: missing plugin for provider '${id}'`);
  }
}

export function getPlugin(id: string): CLIAgentPluginProvider {
  const plugin = providerRegistry.get(id);
  if (!plugin) throw new Error(`No plugin found for provider: ${id}`);
  return plugin;
}

export function getPluginMetadata(id: string): CLIAgentPluginMetadata {
  const meta = metadataRegistry.get(id);
  if (!meta) throw new Error(`No plugin metadata found for provider: ${id}`);
  return meta;
}

export function listPlugins(): CLIAgentPluginProvider[] {
  return providerRegistry.getAll();
}

/**
 * Workspace-relative paths that should be added to .gitignore when
 * writeAgentConfigToGitIgnore is enabled.
 * Only workspace-scoped (scope: 'workspace') hook and plugin files need to be gitignored.
 * Global-scoped providers (codex, grok, kimi) write to homedir and are not gitignored.
 */
export const WORKSPACE_GITIGNORE_PATHS: Partial<Record<string, string[]>> = {
  claude: ['.claude/settings.local.json'],
  amp: ['.amp/plugins/emdash-hook.ts'],
  pi: ['.pi/extensions/emdash-hook.ts'],
  opencode: ['.opencode/plugins/emdash-notifications.js'],
  kiro: ['.kiro/agents/emdash.json'],
  copilot: ['.github/hooks/emdash.json'],
  droid: ['.factory/settings.json'],
  devin: ['.devin/hooks.v1.json'],
  qwen: ['.qwen/settings.json'],
};
