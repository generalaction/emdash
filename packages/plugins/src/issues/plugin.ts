import { createPluginFramework } from '@emdash/shared/plugins';
import z from 'zod';
import { issuesCapability } from './capabilities/issues';

/**
 * The issues plugin carries the issue capability for one integration. It
 * has no display identity of its own: name and icon come from the
 * integration plugin resolved via `integrationId`, and the host resolves
 * credentials through that integration's account scope. At most one issues
 * plugin exists per integration.
 */
export const ISSUES_PLUGIN_CAPABILITIES = {
  issues: issuesCapability,
} as const;

export type IssuesCapabilities = typeof ISSUES_PLUGIN_CAPABILITIES;

const metadataSchema = z.object({
  /** Id of the integration plugin whose identity and credentials this plugin uses. */
  integrationId: z.string(),
});

export type IssuesPluginMetadata = z.infer<typeof metadataSchema>;

export const {
  definePlugin: defineIssuesPlugin,
  registerPluginBehavior: registerIssuesPluginBehavior,
} = createPluginFramework(ISSUES_PLUGIN_CAPABILITIES, metadataSchema, {});

export type IssuesPluginDefinition = ReturnType<typeof defineIssuesPlugin>;
export type IssuesPluginProvider = ReturnType<typeof registerIssuesPluginBehavior>;
