import z from 'zod';
import { hostDependencyCapability } from '../../host-dependencies/capability';
import { createPluginFramework } from '../../lib/plugins/framework';
import { iconAsset } from './assets/icon';
import { acpCapability } from './capabilities/acp';
import { autoApproveCapability } from './capabilities/auto-approve';
import { effortCapability } from './capabilities/effort';
import { hooksCapability } from './capabilities/hooks';
import { mcpCapability } from './capabilities/mcp';
import { modelsCapability } from './capabilities/models';
import { pluginsCapability } from './capabilities/plugins';
import { promptCapability } from './capabilities/prompt';
import { sessionsCapability } from './capabilities/sessions';

export const PLUGIN_CAPABILITIES = {
  acp: acpCapability,
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

export type { AgentIconAsset, AgentIconVariant } from './assets/icon';

// Convenience re-exports for impl packages
export type { AgentCommand, CommandContext } from './capabilities/prompt';
export type {
  CanonicalHookEvent,
  HookEvent,
  HookRegistration,
  NotificationType,
} from './capabilities/hooks-types';
export type { PluginFs } from '../runtime/fs';
// Capability behavior interfaces — needed for dts portability
export type { IAcpBehavior, AcpSpawnContext, AcpSpawnResult } from './capabilities/acp';
export type { IHostDependencyBehavior } from '../../host-dependencies/capability';
export type { IHooksBehavior } from './capabilities/hooks';
export type { IMcpBehavior, McpServerRegistration } from './capabilities/mcp';
export type { IPlugins } from './capabilities/plugins';
export type { ISessionsBehavior } from './capabilities/sessions';

// Typed registry factory
export { createPluginRegistry } from '../../lib/plugins/registry';
