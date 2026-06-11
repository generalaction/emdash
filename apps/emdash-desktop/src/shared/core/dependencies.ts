import type { InstallMethod } from '@emdash/cli-agent-plugins';
import z from 'zod';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { Result } from '@shared/lib/result';

export type DependencyCategory = 'core' | 'agent';

export type CoreDependencyId = 'git' | 'gh' | 'tmux' | 'ssh' | 'node';

export type DependencyId = CoreDependencyId | AgentProviderId;

export type DependencyStatus = 'available' | 'missing' | 'error';

export interface DependencyState {
  id: DependencyId;
  category: DependencyCategory;
  status: DependencyStatus;
  version: string | null;
  path: string | null;
  checkedAt: number;
  error?: string;
  latestVersion?: string | null;
  updateAvailable?: boolean;
}

export type DependencyStatusMap = Record<string, DependencyState>;

export type DependencyStatusUpdatedEvent = {
  id: string;
  state: DependencyState;
  connectionId?: string;
  /** Present for agent-category deps after the host dependency has been computed. */
  hostDependency?: HostDependency;
};

export type InstallCommandError =
  | { type: 'permission-denied'; message: string; output: string; exitCode?: number }
  | { type: 'command-failed'; message: string; output: string; exitCode?: number }
  | { type: 'pty-open-failed'; message: string };

export type DependencyInstallError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-install-command'; id: string }
  | InstallCommandError
  | { type: 'not-detected-after-install'; id: string };

export type DependencyInstallResult = Result<DependencyState, DependencyInstallError>;

export type DependencyUpdateError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-update-strategy'; id: string }
  | InstallCommandError
  | { type: 'not-detected-after-update'; id: string };

export type DependencyUpdateResult = Result<DependencyState, DependencyUpdateError>;

// ---------------------------------------------------------------------------
// Host-scoped installation model
// ---------------------------------------------------------------------------

/**
 * Describes the origin of a specific installation of an agent binary.
 * - 'method': detected from the binary's realpath using location hints.
 * - 'path': user-supplied absolute path override.
 * - 'cli': user-supplied command name (resolved on PATH).
 */
export type InstallationSource =
  | { kind: 'method'; method: InstallMethod }
  | { kind: 'path'; path: string }
  | { kind: 'cli'; command: string };

/**
 * A single resolved installation of an agent binary on a specific host.
 * - id is stable and can be persisted: 'method:<InstallMethod>', 'path', or 'cli'.
 */
export type Installation = {
  id: string;
  source: InstallationSource;
  status: DependencyStatus;
  path: string | null;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
};

/**
 * All installations of one agent on one host, plus which one is currently
 * selected for conversation spawns.
 */
export type HostDependency = {
  hostId: string;
  dependencyId: DependencyId;
  installations: Installation[];
  /** ID of the installation used when spawning conversations. */
  usedId: string;
};

/**
 * Persisted user preference for which installation to use on a specific host.
 * Stored in the local KV store (host='local') or SSH connection metadata (remote).
 */
export type HostDependencySelection = {
  /** ID of the chosen installation (e.g. 'method:homebrew', 'path', 'cli'). */
  usedId?: string;
  /** User-defined absolute binary path. Active when usedId === 'path'. */
  path?: string;
  /** User-defined CLI command name. Active when usedId === 'cli'. */
  cli?: string;
};

export const hostDependencySelectionSchema = z.object({
  usedId: z.string().optional(),
  path: z.string().optional(),
  cli: z.string().optional(),
});

/**
 * Derives the overall dependency status from the currently-used installation.
 * Returns 'missing' when no matching installation is found.
 */
export function deriveHostDependencyStatus(dep: HostDependency): DependencyStatus {
  return dep.installations.find((i) => i.id === dep.usedId)?.status ?? 'missing';
}
