import type { TabPersistenceAdapter } from '@renderer/features/tabs/persistence';
import { rpc } from '@renderer/lib/ipc';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import type { TabGroupsSnapshot, TaskViewSnapshot } from '@shared/view-state';

/**
 * Persistence adapter for a single task's tab layout.
 *
 * Writes to a dedicated key `task:${viewId}:tabs` so the tab state is
 * independent of the aggregate `task:${viewId}` blob. On first load it falls
 * back to the legacy aggregate and eager-writes the dedicated key so that
 * existing users keep their tabs after upgrading.
 */
export class TaskTabViewPersistor implements TabPersistenceAdapter {
  private readonly _key: string;
  private readonly _legacyKey: string;

  constructor(viewId: string) {
    this._key = `task:${viewId}:tabs`;
    this._legacyKey = `task:${viewId}`;
  }

  load(fallback?: unknown): TabGroupsSnapshot | null {
    // Prefer the dedicated key when already populated.
    const dedicated = viewStateCache.peek(this._key);
    if (dedicated) return dedicated as TabGroupsSnapshot;

    // Fall back to the legacy aggregate for users migrating from an older build.
    const aggregate = (fallback ?? viewStateCache.peek(this._legacyKey)) as
      | TaskViewSnapshot
      | undefined;

    const migrated = migrateLegacyTabs(aggregate);
    if (!migrated) return null;

    // Eager-write so the dedicated key is populated before the next aggregate
    // save (which no longer includes tabGroups).
    viewStateCache.set(this._key, migrated);
    void rpc.viewState.save(this._key, migrated);

    return migrated;
  }

  start(getSnapshot: () => TabGroupsSnapshot): () => void {
    return snapshotRegistry.register(this._key, getSnapshot);
  }
}

/**
 * Extract a `TabGroupsSnapshot` from a legacy aggregate snapshot, supporting
 * all three historical formats.
 */
function migrateLegacyTabs(aggregate: TaskViewSnapshot | undefined): TabGroupsSnapshot | null {
  if (!aggregate) return null;

  if (aggregate.tabGroups) {
    return aggregate.tabGroups;
  }

  if (aggregate.tabManager) {
    return {
      groups: [{ groupId: crypto.randomUUID(), tabManager: aggregate.tabManager }],
      activeGroupId: '',
      paneSizes: [100],
    };
  }

  if (aggregate.conversations?.tabOrder?.length) {
    return {
      groups: [
        {
          groupId: crypto.randomUUID(),
          tabManager: {
            tabs: aggregate.conversations.tabOrder.map((id) => ({
              kind: 'conversation' as const,
              tabId: crypto.randomUUID(),
              conversationId: id,
              isPreview: false,
            })),
            activeTabId: undefined,
          },
        },
      ],
      activeGroupId: '',
      paneSizes: [100],
    };
  }

  return null;
}
