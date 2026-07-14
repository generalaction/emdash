import type { HostAbsolutePath } from '@primitives/path/api';
import type { PathSearchError } from '@runtimes/file-search/api';
import { errorMessage, expectedNodeIoError } from '../node-errors';
import { RootWatchReadyError } from '../path-index/errors';
import { expectedRootAccessError } from '../root/errors';
import { expectedSqliteIoError } from '../storage/errors';

export function indexNotReady(
  root: HostAbsolutePath
): Extract<PathSearchError, { type: 'index-not-ready' }> {
  return {
    type: 'index-not-ready',
    root,
    message: 'The file-search index is still being built',
  };
}

export function expectedPathIndexError(
  root: HostAbsolutePath,
  error: unknown,
  fallback: string
): PathSearchError | undefined {
  if (error instanceof RootWatchReadyError) {
    return (
      expectedRootAccessError(root, error.cause) ??
      expectedNodeIoError(root, error.cause, fallback) ?? {
        type: 'io',
        root,
        message: errorMessage(error.cause, error.message),
      }
    );
  }
  return (
    expectedRootAccessError(root, error) ??
    expectedSqliteIoError(root, error, fallback) ??
    expectedNodeIoError(root, error, fallback)
  );
}
