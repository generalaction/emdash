import { provider as asana } from './impl/asana';
import { provider as featurebase } from './impl/featurebase';
import { provider as forgejo } from './impl/forgejo';
import { provider as github } from './impl/github';
import { provider as gitlab } from './impl/gitlab';
import { provider as jira } from './impl/jira';
import { provider as linear } from './impl/linear';
import { provider as monday } from './impl/monday';
import { provider as notion } from './impl/notion';
import { provider as plain } from './impl/plain';
import { provider as plane } from './impl/plane';
import { provider as trello } from './impl/trello';
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

for (const provider of [
  github,
  linear,
  jira,
  gitlab,
  plane,
  forgejo,
  trello,
  asana,
  monday,
  notion,
  featurebase,
  plain,
]) {
  issuesPluginRegistry.register(provider);
}
