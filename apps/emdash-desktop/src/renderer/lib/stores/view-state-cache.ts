import { rpc } from '@renderer/lib/ipc';

/**
 * Renderer-side write-through cache for view state.
 *
 * After the bulk `getAll()` load at bootstrap, every subsequent `get` call is
 * a synchronous Map lookup (returned as a resolved Promise). Writes update the
 * cache immediately and then fire the async IPC save. Eviction happens when a
 * SnapshotRegistry disposer is called (task or project teardown/deletion).
 */
class ViewStateCache {
  private readonly map = new Map<string, unknown>();

  /**
   * Populate the cache from a bulk load result. Called once at bootstrap with
   * the result of `rpc.viewState.getAll()`.
   */
  populate(entries: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(entries)) {
      this.map.set(key, value);
    }
  }

  /**
   * Get a value, returning from cache if present or falling back to IPC.
   * On an IPC miss the result is stored for subsequent calls.
   */
  async get(key: string): Promise<unknown> {
    if (this.map.has(key)) return this.map.get(key);
    const value = await rpc.viewState.get(key);
    if (value != null) this.map.set(key, value);
    return value;
  }

  /** Write a value to the cache (called by SnapshotRegistry on every save). */
  set(key: string, value: unknown): void {
    this.map.set(key, value);
  }

  /** Evict a key from the cache (called by SnapshotRegistry disposers). */
  delete(key: string): void {
    this.map.delete(key);
  }
}

export const viewStateCache = new ViewStateCache();
