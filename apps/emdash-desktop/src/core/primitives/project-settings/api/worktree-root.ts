/**
 * Portable worktree-root path helpers (spec: github-git-settings §6).
 *
 * The worktree-root chain resolves per-project override → per-host default →
 * built-in root. Every consumer — node placement, the renderer settings page,
 * and the create-task destination preview — must normalize configured roots
 * through these helpers so preview and execution cannot diverge. Pure and
 * browser-safe: no node imports.
 */

import {
  createPathProfile,
  formatAbsolute,
  joinAbsolute,
  parseAbsolute,
  parseNativeAbsolute,
  type PathProfile,
} from '@emdash/core/primitives/path/api';

/**
 * The worktree-root layers below the per-project override, plus the host
 * home directory needed to expand `~` the same way execution does. Produced
 * node-side (host settings + host home) and shipped to the renderer over the
 * Wire so both sides feed identical inputs to the resolver.
 */
export type WorktreeRootContext = {
  /** Per-host default worktree root from the host-settings runtime, if configured. */
  hostWorktreeRoot: string | null;
  /** Built-in worktree root for the host (`<home>/emdash/worktrees`). */
  builtInWorktreeRoot: string;
  /** The host's home directory, for `~` expansion of configured roots. */
  homeDirectory: string;
  /** Owning filesystem semantics. Optional only for older serialized snapshots. */
  pathProfile?: PathProfile;
  /**
   * The project's repository path, so a relative root such as `.worktrees`
   * resolves per project. Without it relative roots are unusable.
   */
  projectPath?: string | null;
};

/** The built-in (last) worktree-root layer: `<home>/emdash/worktrees`. */
export function builtInWorktreeRootFor(homeDirectory: string, pathProfile?: PathProfile): string {
  const profile = pathProfile ?? pathProfileFor(homeDirectory);
  const home = parseAbsolute(homeDirectory, { profile });
  if (!home.success) return homeDirectory;
  const builtIn = joinAbsolute(home.data, 'emdash', 'worktrees');
  if (!builtIn.success) return homeDirectory;
  return formatForProfile(builtIn.data, profile);
}

/**
 * Normalizes a configured worktree root the way placement consumes it: trim,
 * expand `~` against the host home, resolve a relative root against the
 * project path, resolve `.`/`..` segments. Returns null when the value is
 * unusable (relative with no project path, `~` with no home, empty) —
 * read-path validation matches execution, which never checks existence (git
 * creates missing directories).
 */
export function normalizeWorktreeRootPath(
  configuredRoot: string,
  homeDirectory: string,
  pathProfile?: PathProfile,
  projectPath?: string | null
): string | null {
  const trimmed = configuredRoot.trim();
  if (!trimmed) return null;

  const profile = pathProfile ?? pathProfileFor(homeDirectory);
  const home = parseAbsolute(homeDirectory.trim(), { profile });
  if (!home.success) return null;

  const parsed =
    trimmed === '~'
      ? home
      : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
        ? joinAbsolute(home.data, trimmed.slice(2))
        : parseAbsolute(trimmed, { profile });
  if (parsed.success) return formatForProfile(parsed.data, profile);
  if (!projectPath || !isRelativeRoot(trimmed)) return null;

  // Join as text and re-parse so `..` can step out of the project directory
  // (e.g. `../app-worktrees` for a sibling folder).
  const project = parseAbsolute(projectPath.trim(), { profile });
  if (!project.success) return null;
  const separator = profile.style === 'win32' ? '\\' : '/';
  const joined = parseAbsolute(`${formatForProfile(project.data, profile)}${separator}${trimmed}`, {
    profile,
  });
  return joined.success ? formatForProfile(joined.data, profile) : null;
}

/** True for `pool`, `./pool`, `../pool`; false for anything rooted in either dialect or `~`. */
function isRelativeRoot(value: string): boolean {
  return !/^([\\/~]|[A-Za-z]:)/.test(value);
}

function pathProfileFor(absolutePath: string): PathProfile {
  const parsed = parseNativeAbsolute(absolutePath);
  const style = parsed.success && parsed.data.root.kind !== 'posix' ? 'win32' : 'posix';
  return createPathProfile({ style });
}

function formatForProfile(
  path: Parameters<typeof formatAbsolute>[0],
  profile: PathProfile
): string {
  return formatAbsolute(path, { separator: profile.style === 'win32' ? '\\' : '/' });
}
