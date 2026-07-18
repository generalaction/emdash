import { createPluginRegistry } from '@emdash/shared/plugins';
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
import type { IntegrationPluginProvider } from './plugin';

export const integrationPluginRegistry = createPluginRegistry<IntegrationPluginProvider>();

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
  integrationPluginRegistry.register(provider);
}
