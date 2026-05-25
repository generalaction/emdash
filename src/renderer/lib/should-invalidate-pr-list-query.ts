import type { PrSyncProgress } from '@shared/pull-requests';

export function shouldInvalidatePrListQuery(
  queryKey: readonly unknown[],
  progress: PrSyncProgress
): boolean {
  if (progress.status !== 'running' && progress.status !== 'done') return false;

  const root = queryKey[0];
  if (root === 'pull-requests-inline') {
    return progress.status === 'done';
  }
  if (root === 'pull-requests') {
    return queryKey[2] === progress.remoteUrl;
  }
  return false;
}
