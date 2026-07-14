import type { ContractImpl } from '@emdash/wire';
import type { FileSearchContract } from '@runtimes/file-search/api';
import type { ContentSearchRuntime } from '@runtimes/file-search/node/content/content-search-runtime';
import type { PathSearchRuntime } from '@runtimes/file-search/node/path/path-search-runtime';
import type { FileSearchRootRegistry } from '@runtimes/file-search/node/root/root-registry';

export type FileSearchProcedures = ContractImpl<FileSearchContract>;

export type FileSearchRuntimeApi = Readonly<{
  roots: Pick<FileSearchRootRegistry, 'registerRoot' | 'unregisterRoot'>;
  paths: Pick<PathSearchRuntime, 'searchPaths'>;
  content: Pick<ContentSearchRuntime, 'searchContent'>;
}>;

export function createFileSearchProcedures(runtime: FileSearchRuntimeApi): FileSearchProcedures {
  return {
    registerRoot: (input) => runtime.roots.registerRoot(input),
    unregisterRoot: (input) => runtime.roots.unregisterRoot(input),
    searchPaths: (input) => runtime.paths.searchPaths(input),
    searchContent: {
      run: (input, context) =>
        runtime.content.searchContent(input, {
          signal: context.signal,
          onProgress: context.progress,
        }),
    },
  };
}
