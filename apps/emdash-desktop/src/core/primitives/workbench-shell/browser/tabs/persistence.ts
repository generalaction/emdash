export type PersistedTabDescriptor = {
  kind: string;
  tabId: string;
  isPreview: boolean;
  [key: string]: unknown;
};

export type TabManagerSnapshot = {
  tabs: PersistedTabDescriptor[];
  activeTabId?: string;
};

export type TabGroupsSnapshot = {
  groups: Array<{
    groupId: string;
    tabManager: TabManagerSnapshot;
  }>;
  activeGroupId: string;
  paneSizes: number[];
};

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
   * @returns The snapshot to restore, or `null` when nothing is saved.
   */
  load(): TabGroupsSnapshot | null;

  /**
   * Start watching `getSnapshot()` and persisting changes.
   *
   * Call this after `load()` so the baseline does not trigger a spurious save.
   * @returns A disposer — call it to stop persistence.
   */
  start(getSnapshot: () => TabGroupsSnapshot): () => void;
}
