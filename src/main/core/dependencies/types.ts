import type { AgentProviderId } from '@shared/agent-provider-registry';

export type DependencyCategory = 'core' | 'agent';

export type CoreDependencyId = 'git' | 'gh' | 'tmux' | 'ssh' | 'node';

export type DependencyId = CoreDependencyId | AgentProviderId;

export interface ProbeResult {
  command: string;
  path: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export type DependencyStatus = 'available' | 'missing' | 'error';

export interface DependencyDescriptor {
  id: DependencyId;
  name: string;
  category: DependencyCategory;
  /** Binary names to try in order; first success wins. */
  commands: string[];
  /** Args passed when probing for a version string. Defaults to ['--version']. */
  versionArgs?: string[];
  docUrl?: string;
  /** Human-readable installation hint shown in UI. */
  installHint?: string;
  /** Machine-executable install command, e.g. "npm install -g @openai/codex". */
  installCommand?: string;
  /**
   * Override the default status resolution logic.
   * Useful for CLIs that exit non-zero on `--version` but are still available.
   */
  resolveStatus?: (result: ProbeResult) => DependencyStatus;
}

export interface DependencyState {
  id: DependencyId;
  category: DependencyCategory;
  status: DependencyStatus;
  version: string | null;
  path: string | null;
  checkedAt: number;
  error?: string;
}
