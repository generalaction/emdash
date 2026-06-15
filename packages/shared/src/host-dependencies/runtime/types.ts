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
 * Provenance of an installed binary: how it was installed and how confident we are.
 *
 * kind: the installation method or a non-PM origin category:
 *   - InstallMethod values (homebrew, npm, curl, …): a known package-manager or installer
 *   - 'manual': installed by directly placing the binary, no PM involved
 *   - 'version-manager': managed by a shim-based tool (mise, asdf, nvm, …)
 *   - 'unknown': could not determine origin
 *
 * confidence:
 *   - 'confirmed': queried the package manager and it confirmed ownership
 *   - 'inferred': path-substring heuristic only; may be incorrect
 *
 * managerRef: for package-manager installs, the formula/package name for targeted
 * upgrade/uninstall commands (e.g. 'claude-code' for `brew upgrade claude-code`).
 */
export type Provenance = {
  kind: InstallMethod | 'manual' | 'version-manager' | 'unknown';
  confidence: 'confirmed' | 'inferred';
  managerRef?: string;
};

/**
 * Persisted discriminated union for a user-chosen install override.
 * Only concrete override kinds are stored — 'auto' is never persisted;
 * its absence implies auto. Replaces the legacy { usedId, path?, cli? } shape.
 *
 * pinned: user selected a specific binary by its absolute realpath.
 */
export type InstallOverride =
  | { kind: 'pinned'; realpath: string }
  | { kind: 'method'; method: InstallMethod }
  | { kind: 'path'; path: string }
  | { kind: 'cli'; command: string };

/**
 * Runtime / UI union that adds 'auto' to the persisted override kinds.
 * Derived as: stored override ?? { kind: 'auto' }.
 */
export type SelectedSource = { kind: 'auto' } | InstallOverride;

/**
 * Returns a stable string key for a SelectedSource.
 * 'auto' | '<realpath>' (pinned) | 'method:<m>' | 'path' | 'cli'
 */
export function sourceKey(s: SelectedSource): string {
  if (s.kind === 'pinned') return s.realpath;
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
 * Uses the installation's `manageable` flag (computed from provenance + descriptor
 * strategy) plus the strategy kind:
 *   - CLI strategy: always true when manageable (binary self-updates regardless of source)
 *   - package-manager strategy: true when manageable (confirmed provenance)
 *   - auto / none: never updatable through emdash
 */
export function installationCanUpdate(
  inst: Installation,
  strategyKind: UpdateStrategy['kind']
): boolean {
  if (!inst.manageable) return false;
  return strategyKind !== 'auto' && strategyKind !== 'none';
}

/**
 * Migrates a raw/legacy persisted value to the canonical InstallOverride | null shape.
 *
 * New format (discriminated union): round-trips as-is (including 'pinned').
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
    if (kind === 'pinned' && typeof obj['realpath'] === 'string') {
      return { kind: 'pinned', realpath: obj['realpath'] };
    }
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
 * Identity: `realpath` (the absolute canonical path after following symlinks).
 * `id` equals `realpath` for enumerated installations; for path/cli overrides
 * it is the literal string 'path' or 'cli' (preserved for backward-compat lookups).
 *
 * Provenance captures how the binary was installed and the confidence level.
 * `manageable` indicates whether emdash can update/uninstall this installation.
 */
export type Installation = {
  /**
   * Stable lookup key.
   * Enumerated installs: absolute realpath (same as `realpath`).
   * Path override: 'path'. CLI override: 'cli'.
   */
  id: string;
  /** Absolute canonical realpath of the binary (follows symlinks). */
  realpath: string;
  /** PATH-visible path entry (symlink/shim) used to discover this binary. Null for off-PATH. */
  pathEntry: string | null;
  /** True when this is the current PATH winner (first `which` result). */
  isActive: boolean;
  /** Whether emdash can manage (update/uninstall) this installation via its UI. */
  manageable: boolean;
  /** How this binary was installed and how confidently we know it. */
  provenance: Provenance;
  status: DependencyStatus;
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
    z.object({ kind: z.literal('pinned'), realpath: z.string() }),
    z.object({ kind: z.literal('method'), method: z.string() }),
    z.object({ kind: z.literal('path'), path: z.string() }),
    z.object({ kind: z.literal('cli'), command: z.string() }),
  ])
) as z.ZodType<HostDependencySelection>;

/**
 * Resolves the active Installation from a HostDependency based on the used source.
 *
 * Resolution rules:
 *   - auto:    the installation with isActive === true (PATH winner)
 *   - pinned:  the installation whose realpath matches selection.realpath
 *   - method:  first manageable installation whose provenance.kind matches
 *   - path:    the path-override installation (id === 'path')
 *   - cli:     the cli-override installation (id === 'cli')
 *
 * Returns undefined when no matching installation is found (dep is missing or
 * the selected installation no longer exists on disk).
 */
export function resolveActiveInstallation(
  installations: Installation[],
  used: SelectedSource
): Installation | undefined {
  if (used.kind === 'auto') return installations.find((i) => i.isActive);
  if (used.kind === 'pinned') return installations.find((i) => i.realpath === used.realpath);
  if (used.kind === 'method') {
    return installations.find((i) => i.provenance.kind === used.method && i.manageable);
  }
  if (used.kind === 'path') return installations.find((i) => i.id === 'path');
  if (used.kind === 'cli') return installations.find((i) => i.id === 'cli');
  return undefined;
}

/**
 * Derives the overall dependency status from the currently-used installation.
 * Returns 'missing' when no matching installation is found.
 */
export function deriveHostDependencyStatus(dep: HostDependency): DependencyStatus {
  return resolveActiveInstallation(dep.installations, dep.used)?.status ?? 'missing';
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
  /** Per-platform install options from plugin metadata. */
  installCommands?: Partial<Record<Platform, InstallOption[]>>;
  /**
   * Optional imperative hooks from the provider implementation.
   * Absent for core dependencies.
   */
  commandHooks?: {
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
