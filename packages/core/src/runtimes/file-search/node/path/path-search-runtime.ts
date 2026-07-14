import { err, ok, type Result } from '@emdash/shared';
import type { HostAbsolutePath } from '@primitives/path/api';
import type { PathSearchError, PathSearchInput, PathSearchResult } from '@runtimes/file-search/api';
import { indexNotReady, rootNotRegistered } from '../api/errors';
import type { FileSearchRootLookup } from '../root/root-registry';
import type { RegisteredFileSearchRoot } from '../root/root-resource';

/** Resolves a registered root and delegates indexed path queries to its resource. */
export class PathSearchRuntime {
  constructor(private readonly roots: FileSearchRootLookup) {}

  async searchPaths(input: PathSearchInput): Promise<Result<PathSearchResult, PathSearchError>> {
    const resource = this.resource(input.root);
    return resource.success ? resource.data.searchPaths(input) : resource;
  }

  private resource(root: HostAbsolutePath): Result<RegisteredFileSearchRoot, PathSearchError> {
    const state = this.roots.state(root);
    switch (state.kind) {
      case 'ready':
      case 'stop-failed':
        return ok(state.resource);
      case 'starting':
        return err(indexNotReady(root));
      case 'start-failed':
        return err(state.error);
      case 'not-registered':
      case 'stopping':
        return err(rootNotRegistered(root));
    }
  }
}
