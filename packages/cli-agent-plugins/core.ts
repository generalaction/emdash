import { ComponentType } from "react";

// hooks, resume, effort, search, autoApprove, models

type Platform = 'macos' | 'windows' | 'linux';

type InstallMethod = 'installer-macos' | 'installer-windows' | 'installer-linux' | 'homebrew' | 'winget' | 'npm' | 'apt' | 'curl' | 'pip' | 'cargo'

export interface CLIAgentPlugin {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly websiteUrl: string;
    readonly compatibleVersion?: string // semver range with which version this plugin is compatible with

    readonly Icon: ComponentType<{ size?: number; mode?: 'light' | 'dark' }>;

    readonly capabilities: PluginCapabilities;

    buildCommand(ctx: any): any;
}

type PluginCapabilities = {
    install: InstallationDescriptor;
    promptDelivery: PromptDeliveryDescriptor;
    sessions: SessionDescriptor;
    autoApprove: AutoApproveDescriptor;
    config: ConfigDescriptor;
}

type InstallationDescriptor = {
    binaryNames: string[];
    buildVersionProbeCommand?: (binaryPath: string) => { command: string; args: string[] };
    installCommands: Partial<Record<Platform, { command: string; method: InstallMethod }>>;
}

type PromptDeliveryDescriptor =
  | { kind: 'argv'; flag: string }     // most providers
  | { kind: 'keystroke';               // grok, hermes, kimi, jules, letta
      submitSequence?: string;          // default '\r'
      submitDelayMs?: number;           // for TUIs that need paste settling
    }
  | { kind: 'stdin-pipe' }             // amp
  | { kind: 'none' };                  // agents with no prompt input


  type SessionDescriptor =
  | { kind: 'resumable'; validateSessionId?(id: string): boolean }
  | { kind: 'stateless' };

  type AutoApproveDescriptor =
  | { kind: 'supported' }
  | { kind: 'none' };


  type ConfigDescriptor = {
    sources: ConfigSource[];
  }

  type ConfigSource = {}

  type AgentConfigState = {
    hooks: HookRegistration[];
    mcp: McpRegistration[];
    skills: SkillRegistration[];
    plugins: PluginRegistration[];
  }

  type HookRegistration = {}
  type McpRegistration = {}
  type SkillRegistration = {}
  type PluginRegistration = {}




  type FileConfigDescriptor = {
    kind: 'file';
    scope: 'global' | 'local';
    /** Path relative to scope root */
    path: string;
    format: 'json' | 'toml' | 'yaml'

  }