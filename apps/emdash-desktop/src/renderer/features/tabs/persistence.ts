import type { TabGroupsSnapshot } from '@shared/view-state';

/**
 * Implemented by a domain-level class that knows how to load and persist the
 * tab layout snapshot for a single view.
 *
 * `features/tabs` depends only on this interface; the concrete implementation
 * (`TaskTabViewPersistor`) lives in `features/tasks`.
 */
export interface TabPersistenceAdapter {
  /**
   * Synchronously load a saved snapshot.
   *
   * @param fallback - An optional blob already held by the caller (e.g. the
   *   aggregate task view-state).  The adapter interprets this as needed for
   *   backwards-compatible migration; `features/tabs` treats it as opaque.
   * @returns The snapshot to restore, or `null` when nothing is saved.
   */
  load(fallback?: unknown): TabGroupsSnapshot | null;

  /**
   * Start watching `getSnapshot()` and persisting changes.
   *
   * Call this after `load()` so the baseline does not trigger a spurious save.
   * @returns A disposer — call it to stop persistence.
   */
  start(getSnapshot: () => TabGroupsSnapshot): () => void;
}
