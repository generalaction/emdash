import {
  createPluginFramework,
  iconAsset,
  type AssetDescriptors,
  type CapabilityBehaviors,
  type CapabilityDescriptors,
  type ResolvedCapabilityDescriptors,
} from '@emdash/shared/plugins';
import z from 'zod';
import { hostDependencyCapability } from '../../host-dependencies/capability';
import { acpCapability } from './capabilities/acp';
import { authCapability } from './capabilities/auth';
import { autoApproveCapability } from './capabilities/auto-approve';
import { effortCapability } from './capabilities/effort';
import { hooksCapability } from './capabilities/hooks';
import { mcpCapability } from './capabilities/mcp';
import { modelsCapability } from './capabilities/models';
import { pluginsCapability } from './capabilities/plugins';
import { promptCapability } from './capabilities/prompt';
import { sessionsCapability } from './capabilities/sessions';
import { trustCapability } from './capabilities/trust';

export const PLUGIN_CAPABILITIES = {
  acp: acpCapability,
  auth: authCapability,
  autoApprove: autoApproveCapability,
  effort: effortCapability,
  hooks: hooksCapability,
  hostDependency: hostDependencyCapability,
  mcp: mcpCapability,
  models: modelsCapability,
  plugins: pluginsCapability,
  prompt: promptCapability,
  sessions: sessionsCapability,
  trust: trustCapability,
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

export type CLIAgentPluginDefinition = {
  metadata: CLIAgentPluginMetadata;
  capabilities: ResolvedCapabilityDescriptors<Capabilities>;
  assets: AssetDescriptors<Assets>;
  validate(): z.ZodError[];
};

export type CLIAgentPluginProvider = CLIAgentPluginDefinition & {
  behavior: CapabilityBehaviors<Capabilities>;
};

const pluginFramework = createPluginFramework(PLUGIN_CAPABILITIES, metadataSchema, PLUGIN_ASSETS);

export const definePlugin: (
  metadata: CLIAgentPluginMetadata,
  capabilities: CapabilityDescriptors<Capabilities>,
  assets: AssetDescriptors<Assets>
) => CLIAgentPluginDefinition = pluginFramework.definePlugin;

export const registerPluginBehavior: (
  plugin: CLIAgentPluginDefinition,
  behavior: CapabilityBehaviors<Capabilities>
) => CLIAgentPluginProvider = pluginFramework.registerPluginBehavior;

export type {
  PluginIconAsset as AgentIconAsset,
  PluginIconVariant as AgentIconVariant,
} from '@emdash/shared/plugins';

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
export type {
  IAcpBehavior,
  AcpSpawnContext,
  AcpSpawnResult,
  AcpProcessIo,
  AcpAgentApi,
  AcpClientFactory,
} from './capabilities/acp';
export type {
  AgentAuthContext,
  AgentAuthDescriptor,
  AgentAuthMethod,
  AgentAuthStatus,
  IAgentAuthBehavior,
} from './capabilities/auth';
export type { IHostDependencyBehavior } from '../../host-dependencies/capability';
export type { IHooksBehavior } from './capabilities/hooks';
export type { IMcpBehavior, McpServerRegistration } from './capabilities/mcp';
export type { IPlugins } from './capabilities/plugins';
export type { ISessionsBehavior } from './capabilities/sessions';
export type { ITrustBehavior, TrustContext } from './capabilities/trust';
export { AgentPluginHost } from './plugin-host';
export type {
  AgentHostAcpSpawn,
  AgentHostDeps,
  AgentHostError,
  AgentHostLoginCommand,
  ResolvedAcpProvider,
  ResolvedAuthProvider,
  ResolvedTuiProvider,
} from './plugin-host';

// Typed registry factory
export { createPluginRegistry, type PluginRegistry } from '@emdash/shared/plugins';
