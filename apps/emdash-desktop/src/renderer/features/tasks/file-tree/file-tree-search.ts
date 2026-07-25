import type { WorkspaceFileHit } from '@shared/core/search';

export interface FileTreeSearchMatch {
  path: string;
}

/**
 * Maps workspace file-index hits to file-tree matches, sorted by path.
 *
 * hit.path is already absolute and must be passed through unchanged — it has
 * to match the same absolute format FilesStore uses for node.path (see
 * FilesStore.resolveWorkspacePath), or isCurrentMatch comparisons against
 * row.node.path silently stop matching and the highlight/reveal breaks even
 * though the search itself still reports the right count.
 */
export function toFileTreeMatches(hits: readonly WorkspaceFileHit[]): FileTreeSearchMatch[] {
  return hits.map((hit) => ({ path: hit.path })).sort((a, b) => a.path.localeCompare(b.path));
}

export function getNextFileTreeMatchIndex(
  matches: FileTreeSearchMatch[],
  currentIndex: number,
  direction: 'next' | 'prev'
): number {
  if (matches.length === 0) return -1;

  if (currentIndex < 0 || currentIndex >= matches.length) {
    return direction === 'prev' ? matches.length - 1 : 0;
  }

  if (direction === 'prev') {
    return currentIndex === 0 ? matches.length - 1 : currentIndex - 1;
  }

  return currentIndex === matches.length - 1 ? 0 : currentIndex + 1;
}
