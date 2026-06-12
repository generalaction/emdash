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
  | { type: 'still-present'; id: string }
  | InstallCommandError;

export type DependencyUninstallResult = Result<DependencyState, DependencyUninstallError>;

/**
 * Persisted discriminated union for a user-chosen install override.
 * Only the three concrete override kinds are stored — 'auto' is never persisted;
 * its absence implies auto. Replaces the legacy { usedId, path?, cli? } shape.
 */
export type InstallOverride =
  | { kind: 'method'; method: InstallMethod }
  | { kind: 'path'; path: string }
  | { kind: 'cli'; command: string };

/**
 * Runtime / UI union that adds 'auto' to the persisted override kinds.
 * Derived as: stored override ?? { kind: 'auto' }.
 */
export type SelectedSource = { kind: 'auto' } | InstallOverride;

/**
 * Returns a stable string key for a SelectedSource — the former Installation.id values.
 * 'auto' | 'method:<m>' | 'path' | 'cli'
 */
export function sourceKey(s: SelectedSource): string {
  if (s.kind === 'method') return `method:${s.method}`;
  return s.kind;
}

/**
 * Resolves a nullable persisted override to a SelectedSource.
 * null → { kind: 'auto' }
 */
export function resolveSelectedSource(override: InstallOverride | null): SelectedSource {
  return override ?? { kind: 'auto' };
}

/**
 * Returns true when an installation can be updated via emdash's update action.
 *
 * - auto/none strategy: never updatable through emdash.
 * - cli strategy: always updatable regardless of selection — the binary self-updates.
 * - package-manager strategy:
 *   - method selection: always (we know which PM to call).
 *   - auto selection: yes when inferredMethod is known (preserves auto-update for
 *     pre-existing installs without a persisted override).
 *   - path/cli overrides: no PM command applies.
 */
export function installationCanUpdate(
  selection: SelectedSource,
  inferredMethod: InstallMethod | null,
  strategyKind: UpdateStrategy['kind']
): boolean {
  if (strategyKind === 'auto' || strategyKind === 'none') return false;
  if (strategyKind === 'cli') return true;
  // package-manager strategy
  if (selection.kind === 'method') return true;
  if (selection.kind === 'auto') return inferredMethod !== null;
  return false;
}

/**
 * Migrates a raw/legacy persisted value to the canonical InstallOverride | null shape.
 *
 * New format (discriminated union): round-trips as-is.
 * Legacy format ({ usedId?, path?, cli? }):
 *   - usedId === 'path' and path present → { kind:'path', path }
 *   - usedId === 'cli' and cli present    → { kind:'cli', command: cli }
 *   - usedId starts with 'method:'        → { kind:'method', method }
 *   - 'auto' / 'unknown' / absent         → null
 */
export function normalizeSelection(raw: unknown): InstallOverride | null {
  if (raw === null || raw === undefined) return null;

  // Try new discriminated-union format first
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const kind = obj['kind'];
    if (kind === 'method' && typeof obj['method'] === 'string') {
      return { kind: 'method', method: obj['method'] as InstallMethod };
    }
    if (kind === 'path' && typeof obj['path'] === 'string') {
      return { kind: 'path', path: obj['path'] };
    }
    if (kind === 'cli' && typeof obj['command'] === 'string') {
      return { kind: 'cli', command: obj['command'] };
    }

    // Legacy format: { usedId?, path?, cli? }
    const usedId = typeof obj['usedId'] === 'string' ? obj['usedId'] : undefined;
    const legacyPath = typeof obj['path'] === 'string' ? obj['path'] : undefined;
    const legacyCli = typeof obj['cli'] === 'string' ? obj['cli'] : undefined;

    if (usedId === 'path' && legacyPath) return { kind: 'path', path: legacyPath };
    if (usedId === 'cli' && legacyCli) return { kind: 'cli', command: legacyCli };
    if (usedId?.startsWith('method:')) {
      const method = usedId.slice('method:'.length) as InstallMethod;
      return { kind: 'method', method };
    }
  }

  return null;
}

/**
 * A single resolved installation of an agent binary on a specific host.
 *
 * id is stable and backward-compatible: sourceKey(source).
 * source reflects the authoritative SelectedSource (user override or auto).
 * inferredMethod is the result of path-heuristic inference — used only as a
 * routing hint for auto updates, never as identity.
 */
export type Installation = {
  /** Stable string key: sourceKey(source). Kept for backward compat with existing find() calls. */
  id: string;
  source: SelectedSource;
  /** Inferred install method from binary realpath (location-hints). Null when unresolvable. */
  inferredMethod: InstallMethod | null;
  status: DependencyStatus;
  path: string | null;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
};

/**
 * All installations of one agent on one host, plus which SelectedSource is
 * currently authoritative for conversation spawns.
 */
export type HostDependency = {
  hostId: string;
  dependencyId: DependencyId;
  installations: Installation[];
  /** The authoritative source — the persisted override or auto. */
  used: SelectedSource;
};

/**
 * Persisted user preference for which installation to use on a specific host.
 * null = auto (no override). Never store { kind: 'auto' } — use null instead.
 * Stored in the local KV store (host='local') or SSH connection metadata (remote).
 */
export type HostDependencySelection = InstallOverride | null;

export const hostDependencySelectionSchema: z.ZodType<HostDependencySelection> = z.nullable(
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('method'), method: z.string() }),
    z.object({ kind: z.literal('path'), path: z.string() }),
    z.object({ kind: z.literal('cli'), command: z.string() }),
  ])
) as z.ZodType<HostDependencySelection>;

/**
 * Derives the overall dependency status from the currently-used installation.
 * Returns 'missing' when no matching installation is found.
 */
export function deriveHostDependencyStatus(dep: HostDependency): DependencyStatus {
  const key = sourceKey(dep.used);
  return dep.installations.find((i) => i.id === key)?.status ?? 'missing';
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
