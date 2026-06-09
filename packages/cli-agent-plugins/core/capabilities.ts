import type { CLIAgentPluginFs } from './plugin';
import type { SettingsDescriptor } from './settings';

export type PluginCapabilities = {
  install: InstallationDescriptor;
  models: ModelsDescriptor;
  effort: EffortDescriptor;
  promptDelivery: PromptDeliveryDescriptor;
  sessions: SessionDescriptor;
  autoApprove: AutoApproveDescriptor;
  hooks: HooksDescriptor;
  mcp: McpDescriptor;
  plugin: PluginDescriptor;
  settings: SettingsDescriptor;
};

// Installation

export type InstallationDescriptor = {
  binaryNames: string[];
  buildVersionProbeCommand?: (binaryPath: string) => { command: string; args: string[] };
  installCommands: Partial<Record<Platform, { command: string; method: InstallMethod }>>;
};

export type Platform = 'macos' | 'windows' | 'linux';

export type InstallMethod =
  | 'installer-macos'
  | 'installer-windows'
  | 'installer-linux'
  | 'homebrew'
  | 'winget'
  | 'npm'
  | 'apt'
  | 'curl'
  | 'pip'
  | 'cargo';

// Models

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
  | {
      kind: 'selectable';
      modelOptions: Record<string, ModelOption>;
    }
  | {
      kind: 'none';
    };

// Effort

export type EffortDescriptor =
  | {
      kind: 'selectable';
    }
  | {
      kind: 'none';
    };

// Prompt Delivery

export type PromptDeliveryDescriptor =
  | { kind: 'argv'; flag: string } // most providers
  | {
      kind: 'keystroke'; // grok, hermes, kimi, jules, letta
      submitSequence?: string; // default '\r'
      submitDelayMs?: number; // for TUIs that need paste settling
    }
  | { kind: 'stdin-pipe' } // amp
  | { kind: 'none' }; // agents with no prompt input

// Sessions

export type SessionDescriptor =
  | { kind: 'resumable'; validateSessionId?(id: string): boolean }
  | { kind: 'stateless' };

// Auto-Approve

export type AutoApproveDescriptor = { kind: 'supported' } | { kind: 'none' };

// Hooks

export type HookEvent = 'notification' | 'stop' | 'session' | 'start' | 'tool-use' | 'tool-use-failure';

export type HookRegistration = {
  event: HookEvent;
  command: string;
  isEmdashHook: boolean;
};

export type HooksDescriptor =
  | {
      kind: 'config';
      supportedEvents: HookEvent[];
      // The app creates a CLIAgentPluginFs scoped to the appropriate root (global or workspace)
      // and passes it here; the plugin handles all path logic internally.
      readHooks(fs: CLIAgentPluginFs): Promise<HookRegistration[]>;
      writeHooks(fs: CLIAgentPluginFs, hooks: HookRegistration[]): Promise<void>;
      deleteHooks(fs: CLIAgentPluginFs): Promise<void>;
      getHooksInstalled(fs: CLIAgentPluginFs): Promise<boolean>;
    }
  | { kind: 'plugin'; supportedEvents: HookEvent[] }
  | { kind: 'none' };

// Plugins (emdash's own agent-side plugin management)

export type PluginScope = { kind: 'global' } | { kind: 'workspace'; path: string };

export type PluginDescriptor =
  | {
      kind: 'file-drop';
      scopes: PluginScope[];
      installPlugin(fs: CLIAgentPluginFs, scope: PluginScope): Promise<void>;
      uninstallPlugin(fs: CLIAgentPluginFs, scope: PluginScope): Promise<void>;
      isPluginInstalled(fs: CLIAgentPluginFs, scope: PluginScope): Promise<boolean>;
      getPluginVersion(fs: CLIAgentPluginFs, scope: PluginScope): Promise<string>;
      getPluginPath(fs: CLIAgentPluginFs, scope: PluginScope): Promise<string>;
    }
  | {
      kind: 'cli';
      buildInstallCommand(binaryPath: string): string;
      buildUninstallCommand(binaryPath: string): string;
      buildCheckCommand(binaryPath: string): string;
      parseCheckOutput(output: string): boolean;
    }
  | { kind: 'none' };

// MCPs

export type McpTransport = 'stdio' | 'http';

export type McpServerRegistration = {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
};

export type McpDescriptor =
  | {
      kind: 'supported';
      supportedTransports: McpTransport[];
      // The app creates a CLIAgentPluginFs scoped to the appropriate root and passes it here.
      readServers(fs: CLIAgentPluginFs): Promise<McpServerRegistration[]>;
      writeServers(fs: CLIAgentPluginFs, servers: McpServerRegistration[]): Promise<void>;
      removeServer(fs: CLIAgentPluginFs, name: string): Promise<void>;
    }
  | { kind: 'none' };
