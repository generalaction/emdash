export { FileTreeRuntime, type FileTreeRuntimeOptions } from './file-tree-runtime';
export { classifyFileTreeFsError, type FileTreeError, type FileTreeOnError } from './errors';
export { IGNORED_PATH_SEGMENTS, isIgnored, watchIgnoreGlobs } from './ignores';
export { normalizeRelPath, resolveInsideRoot, type RelPath, type ResolvedPath } from './paths';
export type { FileNode, FileNodeType, FileTreeScope, NodeId } from './models/tree';
export type {
  FileTreeLease,
  FileTreeSequences,
  FileTreeSnapshot,
  FileTreeUpdate,
  IFileTree,
  IFileTreeRuntime,
  SubscribedSnapshot,
} from './types';
