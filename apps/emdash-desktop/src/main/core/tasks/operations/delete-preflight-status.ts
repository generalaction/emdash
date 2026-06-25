import type { GitStatusModel } from '@emdash/core/git';

export function hasUncommittedStatusChanges(status: GitStatusModel): boolean {
  if (status.kind === 'too-many-files') return true;
  if (status.kind !== 'ok') return false;

  return status.staged.length > 0 || status.unstaged.length > 0;
}
