import {
  DEFAULT_WATCHER_EXCLUDE,
  normalizeExclusionPatterns,
} from '#primitives/exclusion-policy/api';

// Watch profiles. The ignore list is part of the native subscription key, so every consumer of a
// profile on the same root must build its list here to share one native subscription.

/** Structural exclusions of the workspace-content profile; host configuration cannot remove them. */
const WORKSPACE_CONTENT_STRUCTURAL_IGNORE = ['.git/**'] as const;

/** Exclusions relative to a Git common directory; host configuration does not apply here. */
const GIT_METADATA_IGNORE = ['objects/**', 'subtree-cache/**'] as const;

/**
 * Ignore globs for a recursive working-tree watch (Git checkout, workspace registry).
 *
 * `.git/**` is structural: Git metadata is observed through {@link gitMetadataWatchIgnore}. The host
 * `watcherExclude` list supplies dependency and generated trees and replaces, rather than merges
 * with, the built-in default when set. An empty list therefore keeps only the structural rule.
 */
export function workspaceContentWatchIgnore(hostExclude?: readonly string[]): string[] {
  return normalizeExclusionPatterns([
    ...WORKSPACE_CONTENT_STRUCTURAL_IGNORE,
    ...(hostExclude ?? DEFAULT_WATCHER_EXCLUDE),
  ]);
}

/**
 * Ignore globs for a Git common-directory watch. The object store is high-volume and never
 * changes what refs, HEAD, the index, or worktree administration report.
 */
export function gitMetadataWatchIgnore(): string[] {
  return [...GIT_METADATA_IGNORE];
}
