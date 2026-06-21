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
