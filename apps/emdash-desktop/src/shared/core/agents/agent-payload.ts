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

/**
 * Installation provenance — mirrors Provenance in @emdash/shared/deps/runtime types.ts.
 */
export type Provenance = {
  kind: InstallMethod | 'manual' | 'version-manager' | 'unknown';
  confidence: 'confirmed' | 'inferred';
  managerRef?: string;
};

/**
 * Persisted discriminated union for a user-chosen install override.
 * null = auto. Never store { kind: 'auto' }.
 * pinned: a specific binary selected by absolute realpath.
 */
export type InstallOverride =
  | { kind: 'pinned'; realpath: string }
  | { kind: 'method'; method: InstallMethod }
  | { kind: 'path'; path: string }
  | { kind: 'cli'; command: string };

/**
 * Runtime / UI union that adds 'auto' to the persisted override kinds.
 */
export type SelectedSource = { kind: 'auto' } | InstallOverride;

/**
 * Returns a stable string key for a SelectedSource.
 * 'auto' | '<realpath>' (pinned) | 'method:<m>' | 'path' | 'cli'
 */
export function sourceKey(s: SelectedSource): string {
  if (s.kind === 'pinned') return s.realpath;
  if (s.kind === 'method') return `method:${s.method}`;
  return s.kind;
}

export type Installation = {
  /**
   * Stable lookup key.
   * Enumerated installs: absolute realpath. Path override: 'path'. CLI override: 'cli'.
   */
  id: string;
  /** Absolute canonical realpath of the binary. */
  realpath: string;
  /** PATH-visible path entry (symlink/shim). Null for off-PATH installs. */
  pathEntry: string | null;
  /** True when this is the current PATH winner (first `which` result). */
  isActive: boolean;
  /** Whether emdash can manage (update/uninstall) this installation. */
  manageable: boolean;
  /** How this binary was installed and how confidently we know it. */
  provenance: Provenance;
  status: DependencyStatus;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
};

/**
 * Resolves the active Installation from a list given a SelectedSource.
 * Mirrors resolveActiveInstallation from @emdash/shared/deps/runtime.
 */
export function resolveActiveInstallation(
  installations: Installation[],
  used: SelectedSource
): Installation | undefined {
  if (used.kind === 'auto') return installations.find((i) => i.isActive);
  if (used.kind === 'pinned') return installations.find((i) => i.realpath === used.realpath);
  if (used.kind === 'method') {
    return installations.find((i) => i.provenance.kind === used.method && i.manageable);
  }
  if (used.kind === 'path') return installations.find((i) => i.id === 'path');
  if (used.kind === 'cli') return installations.find((i) => i.id === 'cli');
  return undefined;
}

/** Persisted user preference for which installation to use on a specific host. */
export type HostDependencySelection = InstallOverride | null;

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
  /** The authoritative source (persisted override or auto). */
  used: SelectedSource;
  /** @deprecated Use `used` instead. Kept for backward compat during migration. */
  usedId: string;
  /** Platform-resolved install options for this agent on the host. */
  installOptions: InstallOption[];
};

/** Combined payload — used for gradual renderer migration. */
export type AgentPayload = AgentMetadata &
  Omit<AgentInstallationStatus, 'id'> & {
    settings: AgentSettings;
  };
