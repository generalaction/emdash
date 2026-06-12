import type { AgentIconAsset } from '@emdash/shared/agents/plugins';
import type { HostDependencyDescriptor, InstallMethod, InstallOption } from '@emdash/shared/deps';
import {
  installationCanUpdate,
  type DependencyInstallError,
  type DependencyStatus,
  type DependencyUninstallError,
  type DependencyUpdateError,
  type HostDependencySelection,
  type Installation,
  type InstallationSource,
} from '@emdash/shared/deps/runtime';
import type { ProviderCustomConfig } from '@shared/core/app-settings';

// ---------------------------------------------------------------------------
// Re-exports — renderer-facing vocabulary for host-dependency types.
// All renderer code imports these aliases instead of @emdash/shared/deps*.
// ---------------------------------------------------------------------------
export type { InstallMethod, InstallOption };
export type { DependencyStatus, HostDependencySelection, Installation, InstallationSource };
export type { DependencyInstallError as AgentInstallError };
export type { DependencyUninstallError as AgentUninstallError };
export type { DependencyUpdateError as AgentUpdateError };
export { installationCanUpdate };

export type AgentCapabilities = {
  hostDependency: HostDependencyDescriptor;
  models: { kind: string };
  effort: { kind: string };
  prompt: { kind: string };
  sessions: { kind: string };
  autoApprove: { kind: string };
  hooks: { kind: string; scope?: string };
  mcp: { kind: string };
  plugins: { kind: string };
};

export type AgentSettings = {
  value: ProviderCustomConfig;
  defaults: ProviderCustomConfig;
  overrides: Partial<ProviderCustomConfig>;
};

/** Static agent metadata; host-independent and returned by `agents.list()`/`agents.get()`. */
export type AgentMetadata = {
  id: string;
  name: string;
  description: string;
  websiteUrl: string;
  icon: AgentIconAsset;
  capabilities: AgentCapabilities;
  /** Link to installation documentation, null if not set by the plugin. */
  installDocs: string | null;
};

/** Host-scoped installation status; returned by `agents.listAgentInstallationStatus()`. */
export type AgentInstallationStatus = {
  id: string;
  connectionId?: string;
  status: DependencyStatus;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  command: string | null;
  installations: Installation[];
  usedId: string;
  /** Platform-resolved install options for this agent on the host. */
  installOptions: InstallOption[];
};

/** Combined payload — used for gradual renderer migration. */
export type AgentPayload = AgentMetadata &
  Omit<AgentInstallationStatus, 'id'> & {
    settings: AgentSettings;
  };
