import type {
  AutoApproveDescriptor,
  EffortDescriptor,
  HookEvent,
  InstallMethod,
  McpTransport,
  ModelsDescriptor,
  Platform,
  PromptDeliveryDescriptor,
} from './capabilities';

// ── Installation ────────────────────────────────────────────────────────────

export type InstallationMetadata = {
  binaryNames: string[];
  /** When true, skip the --version probe for dependency detection. */
  skipVersionProbe?: boolean;
  installCommands: Partial<Record<Platform, { command: string; method: InstallMethod }>>;
};

// ── Hooks (declarative only — no I/O functions) ─────────────────────────────

export type HooksMetadata =
  | { kind: 'config'; scope: 'global' | 'workspace'; supportedEvents: HookEvent[] }
  | { kind: 'plugin'; scope: 'workspace'; supportedEvents: HookEvent[] }
  | { kind: 'none' };

// ── MCP (declarative only) ──────────────────────────────────────────────────

export type McpMetadata =
  | { kind: 'supported'; scope: 'global'; supportedTransports: McpTransport[] }
  | { kind: 'none' };

// ── Plugin install (declarative only) ───────────────────────────────────────

export type PluginInstallMetadata =
  | { kind: 'file-drop'; scope: 'workspace' }
  | { kind: 'cli' }
  | { kind: 'none' };

// ── Main metadata interface ──────────────────────────────────────────────────

export interface CLIAgentPluginMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly websiteUrl: string;
  readonly compatibleVersions?: string;
  readonly capabilities: {
    install: InstallationMetadata;
    models: ModelsDescriptor;
    effort: EffortDescriptor;
    promptDelivery: PromptDeliveryDescriptor;
    sessions: { kind: 'resumable' } | { kind: 'stateless' };
    autoApprove: AutoApproveDescriptor;
    hooks: HooksMetadata;
    mcp: McpMetadata;
    plugin: PluginInstallMetadata;
  };
}

/** Identity helper that provides full type-checking for metadata definitions. */
export const defineMetadata = (m: CLIAgentPluginMetadata): CLIAgentPluginMetadata => m;
