import type { ProviderCustomConfig } from '@shared/core/app-settings';

// ---------------------------------------------------------------------------
// Install methods — mirrors INSTALL_METHODS in @emdash/shared/deps/capability.ts
// ---------------------------------------------------------------------------

export type InstallMethod =
  | 'installer-macos'
  | 'installer-windows'
  | 'installer-linux'
  | 'homebrew'
  | 'winget'
  | 'powershell'
  | 'npm'
  | 'apt'
  | 'curl'
  | 'pip'
  | 'cargo'
  | 'other';

export type InstallOption = {
  method: InstallMethod;
  command: string;
  label?: string;
  recommended?: boolean;
  updateCommand?: string;
  uninstallCommand?: string;
};

// ---------------------------------------------------------------------------
// Installation state — mirrors @emdash/shared/deps/runtime types.ts
// ---------------------------------------------------------------------------

export type DependencyStatus = 'available' | 'missing' | 'error';

export type InstallationSource =
  | { kind: 'method'; method: InstallMethod }
  | { kind: 'path'; path: string }
  | { kind: 'cli'; command: string }
  | { kind: 'unknown' };

export type Installation = {
  id: string;
  source: InstallationSource;
  status: DependencyStatus;
  path: string | null;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
};

/** Persisted user preference for which installation to use on a specific host. */
export type HostDependencySelection = {
  usedId?: string;
  path?: string;
  cli?: string;
};

// ---------------------------------------------------------------------------
// Error DTOs — mirrors Dependency*Error types in @emdash/shared/deps/runtime
// ---------------------------------------------------------------------------

type InstallCommandError =
  | { type: 'permission-denied'; message: string; output: string; exitCode?: number }
  | { type: 'command-failed'; message: string; output: string; exitCode?: number }
  | { type: 'pty-open-failed'; message: string };

export type AgentInstallError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-install-command'; id: string }
  | InstallCommandError
  | { type: 'not-detected-after-install'; id: string };

export type AgentUpdateError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-update-strategy'; id: string }
  | InstallCommandError
  | { type: 'not-detected-after-update'; id: string };

export type AgentUninstallError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-uninstall-strategy'; id: string }
  | { type: 'no-uninstall-command'; id: string }
  | InstallCommandError;

// ---------------------------------------------------------------------------
// Narrowed capability types — only the subset the renderer reads
// ---------------------------------------------------------------------------

export type AgentUpdateStrategy =
  | { kind: 'package-manager' }
  | { kind: 'cli'; args: string[] }
  | { kind: 'auto' }
  | { kind: 'none' };

export type AgentUninstallStrategy =
  | { kind: 'package-manager' }
  | { kind: 'cli'; args: string[] }
  | { kind: 'none' };

export type AgentHostDependencyInfo = {
  updates: { kind: 'supported'; update: AgentUpdateStrategy } | { kind: 'none' };
  uninstall?: AgentUninstallStrategy;
};

export type AgentCapabilities = {
  hostDependency: AgentHostDependencyInfo;
  models: { kind: string };
  effort: { kind: string };
  prompt: { kind: string };
  sessions: { kind: string };
  autoApprove: { kind: string };
  hooks: { kind: string; scope?: string };
  mcp: { kind: string };
  plugins: { kind: string };
};

// ---------------------------------------------------------------------------
// Icon asset DTO — mirrors AgentIconAsset from @emdash/shared/agents/plugins
// ---------------------------------------------------------------------------

export type AgentIconVariant = {
  minSize: number;
  light: string;
  dark?: string;
};

export type AgentIconAsset = {
  kind: 'svg' | 'image';
  alt?: string;
  variants: AgentIconVariant[];
  invertInDark?: boolean;
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type AgentSettings = {
  value: ProviderCustomConfig;
  defaults: ProviderCustomConfig;
  overrides: Partial<ProviderCustomConfig>;
};

// ---------------------------------------------------------------------------
// Top-level DTOs sent over IPC
// ---------------------------------------------------------------------------

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
