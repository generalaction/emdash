import type { PortableRelativePath } from '@primitives/path/api';
import type { PathEntryKind } from '@runtimes/file-search/api';

/** Semantic exclusion policy shared by path indexing and content search implementations. */
export interface FileSearchExclusionPolicy {
  excludes(path: PortableRelativePath, kind: PathEntryKind): boolean;
}
