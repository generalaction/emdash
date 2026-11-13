import {
  DEFAULT_WATCHER_EXCLUDE,
  normalizeExclusionPatterns,
} from '#primitives/exclusion-policy/api';
import type { WatchOptions } from './models';

// Watch profiles. The ignore list and backend are part of the native subscription key, so every
// consumer of a profile on the same root must build its options here to share one native
// subscription.

/** Structural exclusions of the workspace-content profile; host configuration cannot remove them. */
const WORKSPACE_CONTENT_STRUCTURAL_IGNORE = ['.git/**'] as const;

/**
 * Exclusions relative to a Git common directory; host configuration does not apply here. They
 * cover the object stores: loose and packed objects, Git LFS objects, the repositories of
 * submodules (including those of linked worktrees), and the git-subtree cache.
 */
const GIT_METADATA_IGNORE = [
  'lfs/**',
  'modules/**',
  'objects/**',
  'subtree-cache/**',
  'worktrees/*/modules/**',
] as const;

export type GitMetadataWatchProfile = Required<Pick<WatchOptions, 'ignore' | 'backend'>>;

/**
 * Ignore globs for a recursive working-tree watch (Git checkout, workspace registry).
 *
 * `.git/**` is structural: Git metadata is observed through {@link gitMetadataWatchProfile}. The
 * host `watcherExclude` list supplies dependency and generated trees and replaces, rather than
 * merges with, the built-in default when set. An empty list therefore keeps only the structural
 * rule.
 */
export function workspaceContentWatchIgnore(hostExclude?: readonly string[]): string[] {
  return normalizeExclusionPatterns([
    ...WORKSPACE_CONTENT_STRUCTURAL_IGNORE,
    ...(hostExclude ?? DEFAULT_WATCHER_EXCLUDE),
  ]);
}

/**
 * Watch options for a Git common directory. The object stores are high-volume and never change
 * what refs, HEAD, the index, or worktree administration report.
 *
 * The profile pins the operating system's watcher because a Watchman daemon would crawl and watch
 * the object stores despite the ignore list, and no Watchman configuration can be scoped to a
 * separately watched `.git` root without writing into it. Working-tree watches keep the default
 * backend.
 */
export function gitMetadataWatchProfile(): GitMetadataWatchProfile {
  return { ignore: [...GIT_METADATA_IGNORE], backend: 'os' };
}
