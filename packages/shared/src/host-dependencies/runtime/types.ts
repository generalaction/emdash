import z from 'zod';
import type { Result } from '../../lib/result';
import type {
  InstallMethod,
  InstallOption,
  Platform,
  UninstallStrategy,
  UpdateStrategy,
  UpdatesDescriptor,
} from '../capability';

export type DependencyCategory = 'core' | 'agent';

export type DependencyId = string;

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

export type DependencyUninstallError =
  | { type: 'unknown-dependency'; id: string }
  | { type: 'no-uninstall-strategy'; id: string }
  | { type: 'no-uninstall-command'; id: string }
  | InstallCommandError;
// Note: no 'not-detected-after-uninstall' — missing status after uninstall is the success condition.

export type DependencyUninstallResult = Result<DependencyState, DependencyUninstallError>;

/**
 * Describes the origin of a specific installation of an agent binary.
 * - 'method': detected from the binary's realpath using location hints.
 * - 'path': user-supplied absolute path override.
 * - 'cli': user-supplied command name (resolved on PATH).
 * - 'unknown': binary was found but its install method could not be inferred
 *   (e.g. installed via a version manager shim like Volta or asdf).
 */
export type InstallationSource =
  | { kind: 'method'; method: InstallMethod }
  | { kind: 'path'; path: string }
  | { kind: 'cli'; command: string }
  | { kind: 'unknown' };

/**
 * Returns true when an installation can be updated via emdash's update action.
 *
 * - auto / none: never updatable through emdash.
 * - cli strategy: always updatable — the binary self-updates regardless of how it was installed.
 * - package-manager strategy: requires a known method so the correct package-manager command
 *   can be selected; unknown-source installs show "Automatic updates not available" instead.
 */
export function installationCanUpdate(
  source: InstallationSource,
  strategyKind: UpdateStrategy['kind']
): boolean {
  if (strategyKind === 'auto' || strategyKind === 'none') return false;
  if (source.kind === 'unknown') return strategyKind === 'cli';
  return true;
}

/**
 * A single resolved installation of an agent binary on a specific host.
 * id is stable and can be persisted: 'method:<InstallMethod>', 'path', or 'cli'.
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

export type DependencyStatusUpdatedEvent = {
  id: string;
  state: DependencyState;
  connectionId?: string;
  /** Present for agent-category deps after the host dependency has been computed. */
  hostDependency?: HostDependency;
};

export interface ProbeResult {
  command: string;
  path: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface DependencyDescriptor {
  id: DependencyId;
  name: string;
  category: DependencyCategory;
  /** Binary names to try in order; first success wins. */
  commands: string[];
  /** Args passed when probing for a version string. Defaults to ['--version']. */
  versionArgs?: string[];
  /**
   * Skip executing the CLI after resolving its path.
   * Use for CLIs whose version command has project-local side effects.
   */
  skipVersionProbe?: boolean;
  docUrl?: string;
  /** Human-readable installation hint shown in UI. */
  installHint?: string;
  /** Machine-executable install command, e.g. "npm install -g @openai/codex". */
  installCommand?: string;
  /**
   * Per-platform install options from plugin metadata.
   * Takes precedence over `installCommand` when present.
   * Core dependencies leave this undefined and rely on `installCommand`.
   */
  installCommands?: Partial<Record<Platform, InstallOption[]>>;
  /**
   * Optional imperative hooks from the provider implementation.
   * Absent for core dependencies.
   */
  updateHooks?: {
    resolveLatestVersion?(): Promise<string | null>;
    buildUpdateCommand?(binaryPath: string): { command: string; args: string[] };
    buildUninstallCommand?(binaryPath: string): { command: string; args: string[] };
  };
  /**
   * Override the default status resolution logic.
   * Useful for CLIs that exit non-zero on `--version` but are still available.
   */
  resolveStatus?: (result: ProbeResult) => DependencyStatus;
  /** Updates capability from plugin metadata. Absent for core dependencies. */
  updates?: UpdatesDescriptor;
  /** Uninstall strategy from plugin metadata. Absent for core dependencies. */
  uninstall?: UninstallStrategy;
}

export type DependencyProbeOptions = {
  refreshShellEnv?: boolean;
};
