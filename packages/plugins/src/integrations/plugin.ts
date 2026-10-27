import { createPluginFramework, iconAsset } from '@emdash/shared/plugins';
import z from 'zod';
import { integrationAuthCapability } from './capabilities/auth';

/**
 * The integration plugin owns the identity of an external service (metadata,
 * icon) and its authentication. Feature plugins (issues, later pull requests
 * or repositories) reference it by `integrationId` and never duplicate
 * identity or auth.
 */
export const INTEGRATION_PLUGIN_CAPABILITIES = {
  auth: integrationAuthCapability,
} as const;

export type IntegrationCapabilities = typeof INTEGRATION_PLUGIN_CAPABILITIES;

export const INTEGRATION_PLUGIN_ASSETS = {
  icon: iconAsset,
} as const;

export type IntegrationAssets = typeof INTEGRATION_PLUGIN_ASSETS;

const metadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  websiteUrl: z.string(),
});

export type IntegrationPluginMetadata = z.infer<typeof metadataSchema>;

export const {
  definePlugin: defineIntegrationPlugin,
  registerPluginBehavior: registerIntegrationPluginBehavior,
} = createPluginFramework(
  INTEGRATION_PLUGIN_CAPABILITIES,
  metadataSchema,
  INTEGRATION_PLUGIN_ASSETS
);

export type IntegrationPluginDefinition = ReturnType<typeof defineIntegrationPlugin>;
export type IntegrationPluginProvider = ReturnType<typeof registerIntegrationPluginBehavior>;
