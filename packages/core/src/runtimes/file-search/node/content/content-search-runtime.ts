import { err, ok, type Result } from '@emdash/shared';
import type { HostAbsolutePath } from '@primitives/path/api';
import type {
  ContentSearchError,
  ContentSearchInput,
  ContentSearchResult,
} from '@runtimes/file-search/api';
import { CONTENT_SEARCH_DEFAULT_LIMIT } from '@runtimes/file-search/api';
import type { ConcurrencyLimiter } from '../concurrency-limiter';
import { rootNotRegistered } from '../root/errors';
import type { FileSearchRootLookup, RegisteredFileSearchRoot } from '../root/root-registry';
import { resolveContentScope } from './content-scope';
import type { ContentSearchContext, FileContentSearcher } from './content-searcher';

type ContentSearchRuntimeOptions = Readonly<{
  roots: FileSearchRootLookup;
  searcher: FileContentSearcher;
  limiter: ConcurrencyLimiter;
}>;

/** Owns root authorization, cancellation, and global scheduling for content queries. */
export class ContentSearchRuntime {
  constructor(private readonly options: ContentSearchRuntimeOptions) {}

  searchContent(
    input: ContentSearchInput,
    context: ContentSearchContext
  ): Promise<Result<ContentSearchResult, ContentSearchError>> {
    const registration = this.registration(input.root);
    if (!registration.success) return Promise.resolve(registration);

    return registration.data.scope
      .run('content-search', async (rootSignal) => {
        const signal = AbortSignal.any([context.signal, rootSignal]);
        const scope = await resolveContentScope(registration.data.stored.rootPath, input);
        if (!scope.success) return scope;

        return this.options.limiter.run(signal, () =>
          this.options.searcher.search(
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

  private registration(
    root: HostAbsolutePath
  ): Result<RegisteredFileSearchRoot, ContentSearchError> {
    const state = this.options.roots.state(root);
    switch (state.kind) {
      case 'ready':
      case 'stop-failed':
        return ok(state.registration);
      case 'start-failed':
        return err(state.error);
      case 'not-registered':
      case 'starting':
      case 'stopping':
        return err(rootNotRegistered(root));
    }
  }
}
