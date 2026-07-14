import type { PortableRelativePath } from '@primitives/path/api';
import type { PathIndexEntry } from '@runtimes/file-search/node/path-index-store';
import type { FileSearchExclusionPolicy } from './exclusions';

export type PathScanOptions = Readonly<{
  signal: AbortSignal;
  exclusions: FileSearchExclusionPolicy;
}>;

/** Traversal port for full-root and subtree scans. */
export interface PathScanner {
  scan(
    rootPath: string,
    relativeRoot: PortableRelativePath,
    options: PathScanOptions
  ): AsyncIterable<PathIndexEntry>;
}
