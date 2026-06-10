import type {
  AutoApproveDescriptor,
  EffortDescriptor,
  HooksMetadata,
  InstallationMetadata,
  McpMetadata,
  ModelsDescriptor,
  PluginInstallMetadata,
  PromptDeliveryDescriptor,
} from 'cli-agent-plugins';

import type { ProviderCustomConfig } from '@shared/core/app-settings';
import type { DependencyStatus } from '@shared/core/dependencies';

export type AgentCapabilities = {
  install: InstallationMetadata;
  models: ModelsDescriptor;
  effort: EffortDescriptor;
  promptDelivery: PromptDeliveryDescriptor;
  sessions: { kind: 'resumable' } | { kind: 'stateless' };
  autoApprove: AutoApproveDescriptor;
  hooks: HooksMetadata;
  mcp: McpMetadata;
  plugin: PluginInstallMetadata;
};

export type AgentSettings = {
  value: ProviderCustomConfig;
  defaults: ProviderCustomConfig;
  overrides: Partial<ProviderCustomConfig>;
};

export type AgentPayload = {
  id: string;
  name: string;
  description: string;
  websiteUrl: string | null;
  iconName: string | null;
  iconDarkName: string | null;
  invertInDark: boolean;
  alt: string | null;
  status: DependencyStatus | 'missing';
  version: string | null;
  command: string | null;
  capabilities: AgentCapabilities;
  settings: AgentSettings;
};
