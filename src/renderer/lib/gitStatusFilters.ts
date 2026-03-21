import type { GitStatusChange } from '@/lib/gitStatusCache';

function isVisibleChangePath(path: string): boolean {
  return !path.startsWith('.emdash/') && path !== 'PLANNING.md';
}

export function filterVisibleGitStatusChanges<T extends Pick<GitStatusChange, 'path'>>(
  changes: T[]
): T[] {
  return changes.filter((change) => isVisibleChangePath(change.path));
}
