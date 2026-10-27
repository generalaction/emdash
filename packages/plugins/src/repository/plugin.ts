import { createPluginFramework } from '@agent/shared/plugins';
import z from 'zod';
import { repositoryCapability } from './capabilities/repository';

/**
 * A repository plugin carries hosted-repository operations (owners, create,
 * delete, host detection) for one integration. Like issues plugins it has no
 * display identity of its own: name, icon and credentials come from the
 * integration plugin resolved via `integrationId`. At most one repository
 * plugin exists per integration, and its presence is what makes a remote
 * routable to that integration.
 */
export const REPOSITORY_PLUGIN_CAPABILITIES = {
  repository: repositoryCapability,
} as const;

export type RepositoryCapabilities = typeof REPOSITORY_PLUGIN_CAPABILITIES;

const metadataSchema = z.object({
  /** Id of the integration plugin whose identity and credentials this plugin uses. */
  integrationId: z.string(),
});

export type RepositoryPluginMetadata = z.infer<typeof metadataSchema>;

export const {
  definePlugin: defineRepositoryPlugin,
  registerPluginBehavior: registerRepositoryPluginBehavior,
} = createPluginFramework(REPOSITORY_PLUGIN_CAPABILITIES, metadataSchema, {});

export type RepositoryPluginDefinition = ReturnType<typeof defineRepositoryPlugin>;
export type RepositoryPluginProvider = ReturnType<typeof registerRepositoryPluginBehavior>;
