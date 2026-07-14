import type { Result } from '@emdash/shared';
import type { HostAbsolutePath } from '@primitives/path/api';
import type { FileSearchRegisterRootError } from '@runtimes/file-search/api';

export type ResolvedFileSearchRoot = Readonly<{
  rootKey: string;
  rootPath: string;
}>;

/** Separates lexical root identity from filesystem-backed canonical resolution. */
export interface FileSearchRootResolver {
  comparisonKey(root: HostAbsolutePath): string;
  resolve(
    root: HostAbsolutePath
  ): Promise<Result<ResolvedFileSearchRoot, FileSearchRegisterRootError>>;
}
