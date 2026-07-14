import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import {
  CONTENT_SEARCH_DEFAULT_LIMIT,
  PATH_SEARCH_DEFAULT_LIMIT,
  type ContentSearchError,
  type ContentSearchInput,
  type ContentSearchResult,
  type PathSearchError,
  type PathSearchInput,
  type PathSearchResult,
} from '@runtimes/file-search/api';
import type { IWatchService } from '@services/fs-watch/api';
import { indexNotReady, toExpectedPathIndexError } from '../api/errors';
import type { ConcurrencyLimiter } from '../concurrency-limiter';
import { resolveContentScope } from '../content/content-scope';
import type { ContentSearchContext, FileContentSearcher } from '../content/content-searcher';
import type { FileSearchExclusions } from '../exclusions';
import { RootIndex } from '../path-index/root-index';
import type { PathScanner } from '../path-index/scanner';
import type { PathIndexStore, StoredFileSearchRoot } from '../storage/path-index-store';

export type FileSearchRootResourceOptions = Readonly<{
  root: StoredFileSearchRoot;
  store: PathIndexStore;
  watcher: IWatchService;
  scanner: PathScanner;
  exclusions: FileSearchExclusions;
  scope: Scope;
  scanLimiter: ConcurrencyLimiter;
  contentLimiter: ConcurrencyLimiter;
  contentSearcher: FileContentSearcher;
  onError?: (context: string, error: unknown) => void;
}>;

export interface RegisteredFileSearchRoot {
  searchPaths(input: PathSearchInput): Result<PathSearchResult, PathSearchError>;
  searchContent(
    input: ContentSearchInput,
    context: ContentSearchContext
  ): Promise<Result<ContentSearchResult, ContentSearchError>>;
}

/** One durable root, including path-index maintenance and root-scoped search operations. */
export class FileSearchRootResource implements RegisteredFileSearchRoot {
  private readonly index: RootIndex;

  constructor(private readonly options: FileSearchRootResourceOptions) {
    this.index = new RootIndex({
      root: options.root,
      store: options.store,
      watcher: options.watcher,
      scanner: options.scanner,
      exclusions: options.exclusions,
      scope: options.scope,
      runScan: (signal, operation) => options.scanLimiter.run(signal, operation),
      onError: options.onError,
    });
    this.reconcileInBackground();
  }

  searchPaths(input: PathSearchInput): Result<PathSearchResult, PathSearchError> {
    const before = this.indexFailure(input);
    if (before) return err(before);
    if (!this.index.ready) return err(indexNotReady(input.root));

    let result;
    try {
      result = this.options.store.searchPaths(
        this.options.root.rootKey,
        input.query,
        input.kinds,
        input.limit ?? PATH_SEARCH_DEFAULT_LIMIT
      );
    } catch (error) {
      const expected = toExpectedPathIndexError(
        input.root,
        error,
        'Unable to query the file-search index'
      );
      if (expected) return err(expected);
      throw error;
    }

    const after = this.indexFailure(input);
    if (after) return err(after);
    if (!this.index.ready) return err(indexNotReady(input.root));
    return result.kind === 'ready' ? ok({ hits: result.hits }) : err(indexNotReady(input.root));
  }

  searchContent(
    input: ContentSearchInput,
    context: ContentSearchContext
  ): Promise<Result<ContentSearchResult, ContentSearchError>> {
    return this.options.scope
      .run('content-search', async (rootSignal) => {
        const signal = AbortSignal.any([context.signal, rootSignal]);
        const scope = await resolveContentScope(this.options.root.rootPath, input);
        if (!scope.success) return scope;

        return this.options.contentLimiter.run(signal, () =>
          this.options.contentSearcher.search(
            {
              ...input,
              limit: input.limit ?? CONTENT_SEARCH_DEFAULT_LIMIT,
              rootPath: scope.data.rootPath,
              searchPath: scope.data.searchPath,
            },
            { ...context, signal }
          )
        );
      })
      .value();
  }

  private indexFailure(input: PathSearchInput): PathSearchError | undefined {
    const failure = this.index.failure;
    if (failure === undefined) return undefined;
    const expected = toExpectedPathIndexError(
      input.root,
      failure,
      'The file-search index could not be built'
    );
    if (expected) return expected;
    throw failure;
  }

  private reconcileInBackground(): void {
    void this.index.reconcile().catch((error: unknown) => {
      if (!this.options.scope.signal.aborted) {
        this.options.onError?.('file-search reconciliation failed', error);
      }
    });
  }
}
