export { FileTreeRuntime, type FileTreeRuntimeOptions } from './file-tree-runtime';
export { classifyFileTreeFsError, type FileTreeError, type FileTreeOnError } from './errors';
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
