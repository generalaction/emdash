import type { Branch } from './git';

export const DEFAULT_REMOTE_NAME = 'origin';

export function selectPreferredRemote(
  configuredRemote: string | undefined,
  remotes: ReadonlyArray<{ name: string }>
): string {
  const preferred = configuredRemote?.trim();
  if (!preferred) {
    return DEFAULT_REMOTE_NAME;
  }

  if (preferred === DEFAULT_REMOTE_NAME) {
    return DEFAULT_REMOTE_NAME;
  }

  if (remotes.some((remote) => remote.name === preferred)) {
    return preferred;
  }

  return DEFAULT_REMOTE_NAME;
}

/**
 * Strips the remote prefix from a fully-qualified remote tracking ref.
 * e.g. "origin/main" → "main", "main" → "main"
 */
export function bareRefName(ref: string): string {
  const slash = ref.indexOf('/');
  return slash !== -1 ? ref.slice(slash + 1) : ref;
}

/**
 * Resolves the canonical default branch name from user settings, the branch
 * list, and the git-heuristic fallback. Shared between main and renderer.
 *
 * @param configured - Already-resolved user preference (settings.defaultBranch ?? bareRefName(baseRef))
 * @param branches   - Full branch list (local + remote)
 * @param remote     - The configured remote name
 * @param gitDefaultBranch - Git-heuristic default (symbolic-ref / remote show / well-known names)
 */
export function computeDefaultBranch(
  configured: string,
  branches: Branch[],
  remote: string,
  gitDefaultBranch: string
): string {
  const existsLocally = branches.some((b) => b.type === 'local' && b.branch === configured);
  const isOnRemote = branches.some(
    (b) => b.type === 'remote' && b.branch === configured && b.remote === remote
  );
  if (existsLocally || isOnRemote) return configured;
  return gitDefaultBranch;
}
