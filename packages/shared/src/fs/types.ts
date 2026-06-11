export type FileChangeKind = 'create' | 'update' | 'delete';

export type RawFileEvent = {
  kind: FileChangeKind;
  path: string;
};

export type FileWatchOptions = {
  /**
   * Native-level ignore globs, a property of the shared root subscription: consumers watching
   * the same root should agree on the ignore set to share one native watcher (different sets
   * create separate subscriptions). Relevance filtering beyond ignores belongs in consumers.
   */
  ignore?: string[];
  debounceMs?: number;
  /**
   * Called after the native watcher recovered from an error (resubscribe). Events may have
   * been lost in the gap; consumers should treat all derived state as stale and resync.
   */
  onResync?: () => void;
};

export type WatchHandle = {
  ready(): Promise<void>;
  release(): void;
};

export type IFileWatchService = {
  watch(
    root: string,
    onEvents: (events: RawFileEvent[]) => void,
    options?: FileWatchOptions
  ): WatchHandle;
  dispose(): Promise<void>;
};

export type FileReadResult = {
  content: string;
  truncated: boolean;
  totalSize: number;
};

export type FileStat = {
  type: 'file' | 'dir';
  size: number;
  mtimeMs: number;
};

/**
 * Stateless filesystem operations on absolute paths. No events, no lifecycle, no caching;
 * watching is a separate service (`IFileWatchService`).
 *
 * Intended extension set (additive, as consumers need them):
 * `list`, `write`, `glob`, `mkdir`, `copyFile`, `realPath`, `search`, `readImage`.
 * Workspace-scoping (root-relative paths + escape validation) is a wrapper layered on top,
 * not part of this interface.
 */
export type IFsService = {
  read(absPath: string, options?: { maxBytes?: number }): Promise<FileReadResult>;
  stat(absPath: string): Promise<FileStat | null>;
  remove(absPath: string, options?: { recursive?: boolean }): Promise<void>;
  exists(absPath: string): Promise<boolean>;
};
