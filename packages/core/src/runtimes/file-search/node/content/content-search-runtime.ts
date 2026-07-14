import { err, ok, type Result } from '@emdash/shared';
import type { HostAbsolutePath } from '@primitives/path/api';
import type {
  ContentSearchError,
  ContentSearchInput,
  ContentSearchResult,
} from '@runtimes/file-search/api';
import { rootNotRegistered } from '../api/errors';
import type { FileSearchRootLookup } from '../root/root-registry';
import type { RegisteredFileSearchRoot } from '../root/root-resource';
import type { ContentSearchContext } from './content-searcher';

/** Resolves a registered root and delegates content queries to its resource. */
export class ContentSearchRuntime {
  constructor(private readonly roots: FileSearchRootLookup) {}

  searchContent(
    input: ContentSearchInput,
    context: ContentSearchContext
  ): Promise<Result<ContentSearchResult, ContentSearchError>> {
    const resource = this.resource(input.root);
    return resource.success
      ? resource.data.searchContent(input, context)
      : Promise.resolve(resource);
  }

  private resource(root: HostAbsolutePath): Result<RegisteredFileSearchRoot, ContentSearchError> {
    const state = this.roots.state(root);
    switch (state.kind) {
      case 'ready':
      case 'stop-failed':
        return ok(state.resource);
      case 'start-failed':
        return err(state.error);
      case 'not-registered':
      case 'starting':
      case 'stopping':
        return err(rootNotRegistered(root));
    }
  }
}
