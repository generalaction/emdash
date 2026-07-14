import type { PortableRelativePath } from '@primitives/path/api';

export type FileSearchPathKind = 'file' | 'directory';

/** One policy shared by scanner traversal and native watcher subscription. */
export interface FileSearchExclusionPolicy {
  readonly watchIgnoreGlobs: readonly string[];
  excludes(path: PortableRelativePath, kind: FileSearchPathKind): boolean;
}
