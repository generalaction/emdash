import { provider as github } from './impl/github';
import type { PullRequestsPluginProvider } from './plugin';

/**
 * Keyed by `integrationId` — at most one pull-requests plugin per integration,
 * and lookups always start from the integration that owns the repository.
 */
const plugins = new Map<string, PullRequestsPluginProvider>();

export const pullRequestsPluginRegistry = {
  register(plugin: PullRequestsPluginProvider): void {
    plugins.set(plugin.metadata.integrationId, plugin);
  },
  get: (integrationId: string) => plugins.get(integrationId),
  getAll: () => [...plugins.values()],
  ids: () => [...plugins.keys()],
};

for (const provider of [github]) {
  pullRequestsPluginRegistry.register(provider);
}
