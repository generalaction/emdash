import z from 'zod';
import { hostDependencyCapability } from '../../deps/capability';
import { createPluginFramework } from '../../lib/plugins/framework';
import { iconAsset } from './assets/icon';
import { autoApproveCapability } from './capabilities/auto-approve';
import { effortCapability } from './capabilities/effort';
import { hooksCapability } from './capabilities/hooks';
import { mcpCapability } from './capabilities/mcp';
import { modelsCapability } from './capabilities/models';
import { pluginsCapability } from './capabilities/plugins';
import { promptCapability } from './capabilities/prompt';
import { sessionsCapability } from './capabilities/sessions';

export const PLUGIN_CAPABILITIES = {
  autoApprove: autoApproveCapability,
  effort: effortCapability,
  hooks: hooksCapability,
  hostDependency: hostDependencyCapability,
  mcp: mcpCapability,
  models: modelsCapability,
  plugins: pluginsCapability,
  prompt: promptCapability,
  sessions: sessionsCapability,
} as const;

export type Capabilities = typeof PLUGIN_CAPABILITIES;

export const PLUGIN_ASSETS = {
  icon: iconAsset,
} as const;

export type Assets = typeof PLUGIN_ASSETS;

const metadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  websiteUrl: z.string(),
  compatibleVersions: z.string().optional(),
});

export type CLIAgentPluginMetadata = z.infer<typeof metadataSchema>;

export const { definePlugin, registerPluginBehavior } = createPluginFramework(
  PLUGIN_CAPABILITIES,
  metadataSchema,
  PLUGIN_ASSETS
);

export type CLIAgentPluginDefinition = ReturnType<typeof definePlugin>;
export type CLIAgentPluginProvider = ReturnType<typeof registerPluginBehavior>;

export { pickIconVariant } from './assets/icon';
export type { AgentIconAsset, AgentIconVariant } from './assets/icon';
