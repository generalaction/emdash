import type { Result } from '@emdash/shared';
import type {
  FileChangeSubscription,
  FileChangeUpdate,
  FileChangeWatchOptions,
} from './changes/types';
import type { FileError } from './errors';
import type { IFileSystem } from './fs/types';
import type { FileTreeError } from './tree/errors';
import type { FileTreeLease } from './tree/types';

export interface IFilesRuntime {
  openTree(rootPath: string): Promise<Result<FileTreeLease, FileTreeError>>;
  watchChanges(
    rootPath: string,
    cb: (update: FileChangeUpdate) => void,
    options?: FileChangeWatchOptions
  ): Result<FileChangeSubscription, FileError>;
  fileSystem(): Result<IFileSystem, FileError>;
  dispose(): Promise<void>;
}

export type {
  FileChange,
  FileChangeKind,
  FileChangeSubscription,
  FileChangeUpdate,
  FileChangeWatchOptions,
  FileEntryType,
  IFileChanges,
} from './changes/types';
export type {
  FileEnumeration,
  FileEnumerationOptions,
  FileGlob,
  FileGlobOptions,
  FileStat,
  FileUsage,
  FileUsageError,
  IFileSystem,
  ReadBytesResult,
  ReadFileOptions,
  ReadTextResult,
  WriteFileResult,
} from './fs/types';
export type { FileSymlinkInfo, FileSymlinkTargetType } from './symlinks';
export type {
  DirectoryPreview,
  DirectoryPreviewSegment,
  FileNode,
  FileNodeType,
  FileTreeScope,
  NodeId,
} from './tree/models/tree';
export type {
  FileTreeLease,
  FileTreeSequences,
  FileTreeSnapshot,
  FileTreeUpdate,
  IFileTree,
  SubscribedSnapshot,
} from './tree/types';
