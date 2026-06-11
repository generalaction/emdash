import type {
  AutoApproveDescriptor,
  EffortDescriptor,
  HooksMetadata,
  InstallationMetadata,
  InstallOption,
  McpMetadata,
  ModelsDescriptor,
  PluginInstallMetadata,
  PromptDeliveryDescriptor,
  UpdatesDescriptor,
} from '@emdash/cli-agent-plugins';
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
  updates: UpdatesDescriptor;
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
  status: DependencyStatus;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  command: string | null;
  capabilities: AgentCapabilities;
  settings: AgentSettings;
  /** Install options for the current platform, each carrying its own effective updateCommand. */
  installOptions: InstallOption[];
  /** Link to installation documentation, null if not set by the plugin. */
  installDocs: string | null;
};
