import type { Result, Unsubscribe } from '@emdash/shared';
import type { FileError } from '../errors';

export type FileEntryType = 'file' | 'directory' | 'unknown';
export type FileChangeKind = 'create' | 'update' | 'delete';

export type FileChange = {
  kind: FileChangeKind;
  path: string;
  entryType: FileEntryType;
};

export type FileChangeUpdate = { kind: 'changes'; changes: FileChange[] } | { kind: 'resync' };

export type FileChangeWatchOptions = {
  /**
   * Paths relative to the watched root. An empty path includes the whole root.
   * Implementations may apply this at the underlying watch layer or as a
   * consumer-side filter; the emitted paths are always root-relative.
   */
  paths?: string[];
  debounceMs?: number;
};

export type FileChangeSubscription = {
  ready(): Promise<Result<void, FileError>>;
  unsubscribe: Unsubscribe;
};

export interface IFileChanges {
  readonly rootPath: string;
  watch(
    cb: (update: FileChangeUpdate) => void,
    options?: FileChangeWatchOptions
  ): Result<FileChangeSubscription, FileError>;
  dispose(): void;
}
