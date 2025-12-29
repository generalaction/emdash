import type { Project } from '../types/app';

/**
 * Normalizes file paths for cross-platform comparison.
 * On Windows, paths are case-insensitive. On Unix, they are case-sensitive.
 */
export function normalizePathForComparison(
  input: string | null | undefined,
  platform?: string
): string {
  if (!input) return '';

  let normalized = input.replace(/\\/g, '/');
  normalized = normalized.replace(/\/+/g, '/');

  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/, '');
  }

  const platformKey =
    platform && platform.length > 0
      ? platform
      : typeof process !== 'undefined'
        ? process.platform
        : '';
  return platformKey.toLowerCase().startsWith('win') ? normalized.toLowerCase() : normalized;
}

/**
 * Computes the base ref for a git repository.
 * Priority: baseRef > branch > default to origin/main (or just 'main' if no remote)
 *
 * When a value doesn't contain a '/', it's assumed to be a branch name and will be
 * prefixed with the remote name (unless remote is empty, indicating local-only repo)
 */
export function computeBaseRef(
  baseRef?: string | null,
  remote?: string | null,
  branch?: string | null
): string {
  const remoteName = (() => {
    const trimmed = (remote ?? '').trim();
    if (!trimmed) return ''; // Empty string indicates no remote
    if (/^[A-Za-z0-9._-]+$/.test(trimmed) && !trimmed.includes('://')) return trimmed;
    return 'origin';
  })();

  const normalize = (value?: string | null): string | undefined => {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('://')) return undefined;

    // If already contains '/', use as-is (e.g., "origin/main" or "main/feature")
    if (trimmed.includes('/')) {
      const [head, ...rest] = trimmed.split('/');
      const branchPart = rest.join('/').replace(/^\/+/, '');
      if (head && branchPart) return `${head}/${branchPart}`;
      if (!head && branchPart) {
        // Leading slash - prepend remote if available
        return remoteName ? `${remoteName}/${branchPart}` : branchPart;
      }
      return undefined;
    }

    // Plain branch name - prepend remote only if one exists
    const suffix = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    return remoteName ? `${remoteName}/${suffix}` : suffix;
  };

  // Default: use origin/main if remote exists, otherwise just 'main'
  const defaultBranch = remoteName ? `${remoteName}/main` : 'main';
  return normalize(baseRef) ?? normalize(branch) ?? defaultBranch;
}

/**
 * Gets the unique repository key for a project.
 * Uses the explicit repoKey if available, otherwise normalizes the path.
 */
export function getProjectRepoKey(
  project: Pick<Project, 'path' | 'repoKey'>,
  platform?: string
): string {
  return project.repoKey ?? normalizePathForComparison(project.path, platform);
}

/**
 * Returns a project with a computed repoKey if it doesn't already have one.
 * This ensures all projects have a consistent unique identifier.
 */
export function withRepoKey(project: Project, platform?: string): Project {
  const repoKey = getProjectRepoKey(project, platform);
  if (project.repoKey === repoKey) {
    return project;
  }
  return { ...project, repoKey };
}
