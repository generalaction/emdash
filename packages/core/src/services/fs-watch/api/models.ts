import type { Result } from '@emdash/shared';
import type { WatchBackendPreference } from './contract';

export type WatchEventKind = 'create' | 'update' | 'delete';

export type WatchEvent = {
  kind: WatchEventKind;
  path: string;
};

export type WatchOptions = {
  /**
   * Native-level ignore globs, a property of the shared root subscription: consumers watching
   * the same root should agree on the ignore set to share one native watcher (different sets
   * create separate subscriptions). Relevance filtering beyond ignores belongs in consumers.
   */
  ignore?: string[];
  /**
   * Native watcher selection, part of the subscription key next to `ignore`. `'auto'` (default)
   * lets the native layer choose, which prefers a reachable Watchman daemon on Linux and Windows.
   * Watchman crawls and watches the whole root before ignore globs apply. `'os'` pins the
   * operating system's own watcher, whose startup cost the ignore list bounds: inotify skips
   * ignored subtrees, while ReadDirectoryChangesW and FSEvents do not crawl.
   *
   * The native layer shares one watcher per root and ignore set across backends, so a profile
   * that pins a backend must also use an ignore set no `'auto'` consumer shares.
   */
  backend?: WatchBackendPreference;
  debounceMs?: number;
  /**
   * Called when the native watcher cannot be attached. This is a best-effort notification;
   * callers that require a live subscription should check the handle's ready result.
   */
  onError?: (error: unknown) => void;
  /**
   * Called when the native watcher reports an event gap, after a native resubscribe, or after a
   * subprocess-backed watcher reconnects. Events may have been lost; consumers should treat all
   * derived state as stale and resync.
   */
  onResync?: () => void;
};

export type WatchHandle = {
  ready(): Promise<Result<void, unknown>>;
  release(): Promise<void>;
};

export async function requireWatchReady(handle: WatchHandle): Promise<void> {
  const attached = await handle.ready();
  if (!attached.success) throw attached.error;
}

export type IWatchService = {
  watch(
    root: string,
    onEvents: (events: WatchEvent[]) => void,
    options?: WatchOptions
  ): WatchHandle;
  dispose(): Promise<void>;
};
