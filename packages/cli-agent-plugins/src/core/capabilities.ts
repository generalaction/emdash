// Shared enum/variant/primitive types used by both metadata and provider.
// This file intentionally has no Node.js deps and no function types.

// ── Installation ─────────────────────────────────────────────────────────────

export type Platform = 'macos' | 'windows' | 'linux';

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
  /** Human-readable display name shown in the UI. Defaults to a humanized method label. */
  label?: string;
  /** When true this option is preselected and sorted first. */
  recommended?: boolean;
  /** Update command for installs made via this method. When absent, falls back to re-running
   *  `command` for package-manager updates or the agent's own CLI update command. */
  updateCommand?: string;
};

// ── Models ───────────────────────────────────────────────────────────────────

export type ModelOption = {
  name: string;
  description: string;
  modelFeatures: {
    contextWindowSize: number;
    speed: number; // 1-5
    intelligence: number; // 1-5
  };
};

export type ModelsDescriptor =
  | { kind: 'selectable'; modelOptions: Record<string, ModelOption> }
  | { kind: 'none' };

// ── Effort ───────────────────────────────────────────────────────────────────

export type EffortDescriptor = { kind: 'selectable' } | { kind: 'none' };

// ── Prompt Delivery ──────────────────────────────────────────────────────────

export type PromptDeliveryDescriptor =
  | { kind: 'argv'; flag: string }
  | { kind: 'keystroke'; submitSequence?: string; submitDelayMs?: number }
  | { kind: 'stdin-pipe' }
  | { kind: 'none' };

// ── Auto-Approve ─────────────────────────────────────────────────────────────

export type AutoApproveDescriptor = { kind: 'supported' } | { kind: 'none' };

// ── Hooks ────────────────────────────────────────────────────────────────────

export type HookEvent =
  | 'notification'
  | 'stop'
  | 'session'
  | 'start'
  | 'tool-use'
  | 'tool-use-failure';

export type HookRegistration = {
  /** The emdash event name (or 'emdash' as a sentinel when hooks are installed). */
  event: string;
  command: string;
  isEmdashHook?: boolean;
};

// ── MCP ──────────────────────────────────────────────────────────────────────

export type McpTransport = 'stdio' | 'http';

export type McpServerRegistration = {
  name: string;
  transport?: McpTransport;
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  [key: string]: unknown;
};

// ── Plugin scope ─────────────────────────────────────────────────────────────

export type PluginScope = { kind: 'global' } | { kind: 'workspace'; path: string };

// ── Updates ──────────────────────────────────────────────────────────────────

/** Where to look up the latest published version. */
export type ReleaseSource =
  | { kind: 'npm'; package: string }
  | { kind: 'github'; repo: `${string}/${string}` }
  | { kind: 'none' };

/** How emdash should apply an update when one is available. */
export type UpdateStrategy =
  /** Re-run the install command for the method that was used, or the first/recommended option. */
  | { kind: 'package-manager' }
  /** Run the agent's own update subcommand, e.g. `claude update`. */
  | { kind: 'cli'; args: string[] }
  /** Agent manages its own updates; emdash reports the version diff but takes no action. */
  | { kind: 'auto' }
  | { kind: 'none' };

export type UpdatesDescriptor =
  | { kind: 'supported'; releaseSource: ReleaseSource; update: UpdateStrategy }
  | { kind: 'none' };
