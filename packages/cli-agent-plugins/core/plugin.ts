import { ComponentType } from 'react';
import { PluginCapabilities } from './capabilities';
import { AgentCommand, CommandContext } from './command';

export interface CLIAgentPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly websiteUrl: string;
  readonly compatibleVersions?: string; // semver range with which version this plugin is compatible with

  readonly Icon: ComponentType<{ size?: number; mode?: 'light' | 'dark' }>;

  readonly capabilities: PluginCapabilities;

  buildCommand(ctx: CommandContext): AgentCommand;
  buildVersionProbeCommand?(binaryPath: string): { command: string; args: string[] };
}

export interface CLIAgentPluginFs {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
}

export type CLIAgentPluginConstructor = () => CLIAgentPlugin;
