import { createPluginFramework } from '@agent/shared/plugins';
import z from 'zod';
import { pullRequestsCapability } from './capabilities/pull-requests';

/**
 * A pull-requests plugin carries PR/MR capability for one integration. Like
 * issues plugins it has no display identity of its own: name, icon and
 * credentials come from the integration plugin resolved via `integrationId`.
 * At most one pull-requests plugin exists per integration.
 */
export const PULL_REQUESTS_PLUGIN_CAPABILITIES = {
  pullRequests: pullRequestsCapability,
} as const;

export type PullRequestsCapabilities = typeof PULL_REQUESTS_PLUGIN_CAPABILITIES;

const metadataSchema = z.object({
  /** Id of the integration plugin whose identity and credentials this plugin uses. */
  integrationId: z.string(),
});

export type PullRequestsPluginMetadata = z.infer<typeof metadataSchema>;

export const {
  definePlugin: definePullRequestsPlugin,
  registerPluginBehavior: registerPullRequestsPluginBehavior,
} = createPluginFramework(PULL_REQUESTS_PLUGIN_CAPABILITIES, metadataSchema, {});

export type PullRequestsPluginDefinition = ReturnType<typeof definePullRequestsPlugin>;
export type PullRequestsPluginProvider = ReturnType<typeof registerPullRequestsPluginBehavior>;
