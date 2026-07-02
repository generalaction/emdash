import type { IssuesPluginProvider } from './plugin';

/**
 * Keyed by `integrationId` — at most one issues plugin per integration, and
 * lookups always start from the integration whose issues are requested.
 */
const plugins = new Map<string, IssuesPluginProvider>();

export const issuesPluginRegistry = {
  register(plugin: IssuesPluginProvider): void {
    plugins.set(plugin.metadata.integrationId, plugin);
  },
  get: (integrationId: string) => plugins.get(integrationId),
  getAll: () => [...plugins.values()],
  ids: () => [...plugins.keys()],
};
