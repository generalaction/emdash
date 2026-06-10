import type { HookRegistration, McpServerRegistration, PluginScope } from './capabilities';
import type { AgentCommand, CommandContext } from './command';
import type { CLIAgentPluginMetadata } from './metadata';
import type { CLIAgentPluginFs } from './plugin';

// ── Behavior bundles (function objects) ─────────────────────────────────────

export type HooksBehavior = {
  readHooks(fs: CLIAgentPluginFs): Promise<HookRegistration[]>;
  writeHooks(fs: CLIAgentPluginFs, hooks: HookRegistration[]): Promise<void>;
  deleteHooks(fs: CLIAgentPluginFs): Promise<void>;
  getHooksInstalled(fs: CLIAgentPluginFs): Promise<boolean>;
};

export type McpBehavior = {
  readServers(fs: CLIAgentPluginFs): Promise<McpServerRegistration[]>;
  writeServers(fs: CLIAgentPluginFs, servers: McpServerRegistration[]): Promise<void>;
  removeServer(fs: CLIAgentPluginFs, name: string): Promise<void>;
};

export type PluginBehavior = {
  installPlugin(fs: CLIAgentPluginFs, scope: PluginScope): Promise<void>;
  uninstallPlugin(fs: CLIAgentPluginFs, scope: PluginScope): Promise<void>;
  isPluginInstalled(fs: CLIAgentPluginFs, scope: PluginScope): Promise<boolean>;
  getPluginVersion(fs: CLIAgentPluginFs, scope: PluginScope): Promise<string>;
  getPluginPath(fs: CLIAgentPluginFs, scope: PluginScope): Promise<string>;
};

export type UpdatesBehavior = {
  /** Override the generic release-source resolution for unusual version feeds. */
  resolveLatestVersion?(): Promise<string | null>;
  /**
   * Override the static UpdateStrategy.cli args with a computed command.
   * Receives the resolved binary path; return { command, args } to run.
   */
  buildUpdateCommand?(binaryPath: string): { command: string; args: string[] };
};

// ── Provider interface ───────────────────────────────────────────────────────

export interface CLIAgentPluginProvider {
  readonly metadata: CLIAgentPluginMetadata;

  buildCommand(ctx: CommandContext): AgentCommand;
  buildVersionProbeCommand?(binaryPath: string): { command: string; args: string[] };
  /** Validate a provider-specific session ID before using it for resume. */
  validateSessionId?(id: string): boolean;

  /** Present only when metadata.capabilities.hooks.kind === 'config'. */
  hooks?: HooksBehavior;
  /** Present only when metadata.capabilities.mcp.kind === 'supported'. */
  mcp?: McpBehavior;
  /** Present only when metadata.capabilities.plugin.kind !== 'none'. */
  plugin?: PluginBehavior;
  /** Optional overrides for update detection or command construction. */
  updates?: UpdatesBehavior;
}

export type ProviderBehavior = Omit<CLIAgentPluginProvider, 'metadata'>;

/** Attach a behavior object to a metadata record to produce a full provider. */
export const defineProvider = (
  metadata: CLIAgentPluginMetadata,
  behavior: ProviderBehavior
): CLIAgentPluginProvider => ({ metadata, ...behavior });
