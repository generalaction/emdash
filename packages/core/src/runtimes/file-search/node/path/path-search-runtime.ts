import { err, ok, type Result } from '@emdash/shared';
import type { HostAbsolutePath } from '@primitives/path/api';
import type { PathSearchError, PathSearchInput, PathSearchResult } from '@runtimes/file-search/api';
import { PATH_SEARCH_DEFAULT_LIMIT } from '@runtimes/file-search/api';
import type { PathIndexStore } from '../path-index-store';
import { rootNotRegistered } from '../root/errors';
import type { FileSearchRootLookup, RegisteredFileSearchRoot } from '../root/root-registry';
import { expectedPathIndexError, indexNotReady } from './errors';

type PathSearchRuntimeOptions = Readonly<{
  roots: FileSearchRootLookup;
  store: PathIndexStore;
}>;

/** Owns indexed path queries and their readiness/error semantics. */
export class PathSearchRuntime {
  constructor(private readonly options: PathSearchRuntimeOptions) {}

  async searchPaths(input: PathSearchInput): Promise<Result<PathSearchResult, PathSearchError>> {
    const registration = this.registration(input.root);
    if (!registration.success) return registration;

    const before = this.indexFailure(input.root, registration.data);
    if (before) return err(before);
    if (!registration.data.index.ready) return err(indexNotReady(input.root));

    let result;
    try {
      result = this.options.store.searchPaths(
        registration.data.stored.rootKey,
        input.query,
        input.kinds,
        input.limit ?? PATH_SEARCH_DEFAULT_LIMIT
      );
    } catch (error) {
      const expected = expectedPathIndexError(
        input.root,
        error,
        'Unable to query the file-search index'
      );
      if (expected) return err(expected);
      throw error;
    }

    const after = this.indexFailure(input.root, registration.data);
    if (after) return err(after);
    if (!registration.data.index.ready) return err(indexNotReady(input.root));
    return result.kind === 'ready' ? ok({ hits: result.hits }) : err(indexNotReady(input.root));
  }

  private registration(root: HostAbsolutePath): Result<RegisteredFileSearchRoot, PathSearchError> {
    const state = this.options.roots.state(root);
    switch (state.kind) {
      case 'ready':
      case 'stop-failed':
        return ok(state.registration);
      case 'starting':
        return err(indexNotReady(root));
      case 'start-failed':
        return err(state.error);
      case 'not-registered':
      case 'stopping':
        return err(rootNotRegistered(root));
    }
  }

  private indexFailure(
    root: HostAbsolutePath,
    registration: RegisteredFileSearchRoot
  ): PathSearchError | undefined {
    const failure = registration.index.failure;
    if (failure === undefined) return undefined;
    const expected = expectedPathIndexError(
      root,
      failure,
      'The file-search index could not be built'
    );
    if (expected) return expected;
    throw failure;
  }
}
