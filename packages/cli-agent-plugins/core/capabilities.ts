import { CLIAgentPluginFs } from './plugin';

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

export type HooksDescriptor =
  | {
      kind: 'config';
      supportedEvents: HookEvent[];
      readHooks: (rootPath: string) => Promise<HookRegistration[]>; // hierarchical config merge should be handled by the plugin implementation
      writeHooks: (rootPath: string, hooks: HookRegistration[]) => Promise<void>; // hierarchical config merge should be handled by the plugin implementation
      deleteHooks: (rootPath: string) => Promise<void>;
      getHooksInstalled: (rootPath: string) => Promise<boolean>;
    }
  | { kind: 'plugin'; supportedEvents: HookEvent[] }
  | {
      kind: 'none';
    };

export type HookRegistration = {
  event: HookEvent;
  command: string;
  isEmdashHook: boolean;
};

// Plugins

export type PluginScope = { kind: 'global' } | { kind: 'workspace'; path: string };

export type PluginDescriptor =
  | {
      kind: 'file-drop';
      scopes: PluginScope[];
      installPlugin: (fs: CLIAgentPluginFs, scope: PluginScope) => Promise<void>;
      uninstallPlugin: (fs: CLIAgentPluginFs, scope: PluginScope) => Promise<void>;
      isPluginInstalled: (fs: CLIAgentPluginFs, scope: PluginScope) => Promise<boolean>;
      getPluginVersion: (fs: CLIAgentPluginFs, scope: PluginScope) => Promise<string>;
      getPluginPath: (fs: CLIAgentPluginFs, scope: PluginScope) => Promise<string>;
    }
  | {
      kind: 'cli';
      buildInstallCommand: (binaryPath: string) => string;
      buildUninstallCommand: (binaryPath: string) => string;
      buildCheckCommand: (binaryPath: string) => string;
      parseCheckOutput: (output: string) => boolean;
    }
  | {
      kind: 'none';
    };

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
      readServers(rootPath: string): Promise<McpServerRegistration[]>;
      writeServers(rootPath: string, servers: McpServerRegistration[]): Promise<void>;
      removeServer(rootPath: string, name: string): Promise<void>;
    }
  | {
      kind: 'none';
    };
