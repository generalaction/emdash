import { err, ok, type Result } from '@emdash/shared';
import {
  PATH_SEARCH_DEFAULT_LIMIT,
  type PathSearchError,
  type PathSearchInput,
  type PathSearchResult,
} from '@runtimes/file-search/api';
import { indexNotReady, toExpectedPathIndexError } from '../error-mapping';
import type { RegisteredRoot } from '../root/registered-root';
import type { PathIndexStore } from '../storage/types';

/** Executes one synchronous path-index query against a registered root. */
export function searchRootPaths(
  root: RegisteredRoot,
  input: PathSearchInput,
  store: PathIndexStore
): Result<PathSearchResult, PathSearchError> {
  const failure = indexFailure(root, input);
  if (failure) return err(failure);
  if (!root.index.ready) return err(indexNotReady(input.root));

  try {
    const result = store.searchPaths(
      root.record.rootKey,
      input.query,
      input.kinds,
      input.limit ?? PATH_SEARCH_DEFAULT_LIMIT
    );
    return result.kind === 'ready' ? ok({ hits: result.hits }) : err(indexNotReady(input.root));
  } catch (error) {
    const expected = toExpectedPathIndexError(
      input.root,
      error,
      'Unable to query the file-search index'
    );
    if (expected) return err(expected);
    throw error;
  }
}

function indexFailure(root: RegisteredRoot, input: PathSearchInput): PathSearchError | undefined {
  const failure = root.index.failure;
  if (failure === undefined) return undefined;
  const expected = toExpectedPathIndexError(
    input.root,
    failure,
    'The file-search index could not be built'
  );
  if (expected) return expected;
  throw failure;
}
