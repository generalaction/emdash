import type { PortableRelativePath } from '@primitives/path/api';
import type { FileSearchIndexEntry } from '@runtimes/file-search/node/store';

/** Traversal port for full-root and subtree scans. */
export interface FileScanner {
  scan(
    rootPath: string,
    relativeRoot: PortableRelativePath,
    signal: AbortSignal
  ): AsyncIterable<FileSearchIndexEntry>;
}
