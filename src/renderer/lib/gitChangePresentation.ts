type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export function getChangeStatusDotClass(status: ChangeStatus): string {
  if (status === 'added') return 'bg-green-500';
  if (status === 'deleted') return 'bg-red-500';
  if (status === 'renamed') return 'bg-amber-500';
  return 'bg-blue-500';
}

export function formatDiffCount(value: number | null | undefined): string {
  return typeof value === 'number' ? String(value) : '?';
}

export function getTotalDiffLines(
  additions: number | null | undefined,
  deletions: number | null | undefined
): number | null {
  if (typeof additions !== 'number' || typeof deletions !== 'number') return null;
  return additions + deletions;
}
