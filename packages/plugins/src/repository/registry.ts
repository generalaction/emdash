import { provider as github } from './impl/github';
import { provider as gitlab } from './impl/gitlab';
import type { RepositoryPluginProvider } from './plugin';

/** Keyed by `integrationId` — at most one repository plugin per integration. */
const plugins = new Map<string, RepositoryPluginProvider>();

export const repositoryPluginRegistry = {
  register(plugin: RepositoryPluginProvider): void {
    plugins.set(plugin.metadata.integrationId, plugin);
  },
  get: (integrationId: string) => plugins.get(integrationId),
  getAll: () => [...plugins.values()],
  ids: () => [...plugins.keys()],
};

for (const provider of [github, gitlab]) {
  repositoryPluginRegistry.register(provider);
}
