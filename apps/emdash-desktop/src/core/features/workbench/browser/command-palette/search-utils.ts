import { relativeToWorkspace } from '@core/features/tasks/browser/stores/workspace-path';
import type { SearchItem } from '@core/primitives/search/api';

/**
 * Re-ranks FTS5 results by boosting items belonging to the active project.
 * Applied to DB results only — actions are already ordered by context relevance.
 */
export function applyContextAffinity(
  items: SearchItem[],
  context: { projectId?: string }
): SearchItem[] {
  return [...items].sort((a, b) => {
    const boost = (x: SearchItem) =>
      x.projectId === context.projectId && context.projectId != null ? 1 : 0;
    const diff = boost(b) - boost(a);
    // BM25: lower (more negative) is better
    return diff !== 0 ? diff : a.score - b.score;
  });
}

export function getPaletteFileDisplayPath({
  workspacePath,
  filePath,
  fallback,
}: {
  workspacePath?: string;
  filePath: string;
  fallback?: string;
}): string {
  if (!workspacePath) return fallback ?? filePath.replace(/\\/g, '/');
  return relativeToWorkspace(workspacePath, filePath);
}
