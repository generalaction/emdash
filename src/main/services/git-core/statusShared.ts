import type { GitChange } from '../../../shared/git/types';
import { combineNumstatValues } from '../../utils/gitStatusParser';
import type { ParsedGitStatusEntry, ParsedNumstat } from '../../utils/gitStatusParser';

export const MAX_UNTRACKED_LINECOUNT_BYTES = 512 * 1024;

type NumstatMap = Map<string, ParsedNumstat>;

export function buildStatusChanges(
  entries: ParsedGitStatusEntry[],
  stagedStats: NumstatMap,
  unstagedStats: NumstatMap
): { changes: GitChange[]; untrackedPathsNeedingCounts: string[] } {
  const changes: GitChange[] = [];
  const untrackedPathsNeedingCounts: string[] = [];

  for (const entry of entries) {
    const staged = stagedStats.get(entry.path);
    const unstaged = unstagedStats.get(entry.path);
    const additions = combineNumstatValues(staged?.additions, unstaged?.additions);
    const deletions = combineNumstatValues(staged?.deletions, unstaged?.deletions);

    if (entry.statusCode.includes('?') && additions === 0 && deletions === 0) {
      untrackedPathsNeedingCounts.push(entry.path);
    }

    changes.push({
      path: entry.path,
      status: entry.status,
      additions,
      deletions,
      isStaged: entry.isStaged,
    });
  }

  return { changes, untrackedPathsNeedingCounts };
}

export function applyUntrackedLineCounts(
  changes: GitChange[],
  countsByPath: Map<string, number | null>
): GitChange[] {
  if (countsByPath.size === 0 || changes.length === 0) {
    return changes;
  }

  const changeIndexByPath = new Map<string, number>();
  for (let i = 0; i < changes.length; i++) {
    changeIndexByPath.set(changes[i].path, i);
  }

  for (const [filePath, count] of countsByPath) {
    const index = changeIndexByPath.get(filePath);
    if (index === undefined) continue;
    if (count === null) {
      changes[index].additions = null;
      changes[index].deletions = null;
      continue;
    }
    changes[index].additions = count;
    changes[index].deletions = 0;
  }

  return changes;
}
