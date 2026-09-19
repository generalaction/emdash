export type PullRequestOperationErrorType =
  | 'sync_failed'
  | 'refresh_failed'
  | 'checks_failed'
  | 'comments_failed'
  | 'create_failed'
  | 'merge_failed'
  | 'mark_ready_failed'
  | 'files_failed';

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function isNetworkError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  return ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT'].includes(code);
}
