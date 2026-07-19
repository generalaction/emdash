import type { TaskTabContext } from '@renderer/features/tabs/core/task-tab-context';
import type { TabPersistenceAdapter } from '@renderer/features/tabs/persistence';
import { rpc } from '@renderer/lib/ipc';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import { log } from '@renderer/utils/logger';
import type { TabDescriptor, TabGroupsSnapshot, TaskViewSnapshot } from '@shared/view-state';
import { resolveWorkspacePath } from './workspace-path';

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

  constructor(private readonly _ctx: TaskTabContext) {
    this._key = `task:${_ctx.viewId}:tabs`;
    this._legacyKey = `task:${_ctx.viewId}`;
  }

  load(fallback?: unknown): TabGroupsSnapshot | null {
    // Prefer the dedicated key when already populated.
    const dedicated = viewStateCache.peek(this._key);
    if (dedicated) {
      return normalizeTabGroupsSnapshot(dedicated as TabGroupsSnapshot, this._ctx.workspacePath);
    }

    // Fall back to the legacy aggregate for users migrating from an older build.
    const aggregate = (fallback ?? viewStateCache.peek(this._legacyKey)) as
      | TaskViewSnapshot
      | undefined;

    const migrated = migrateLegacyTabs(aggregate);
    if (!migrated) return null;

    // Eager-write so the dedicated key is populated before the next aggregate
    // save (which no longer includes tabGroups).
    viewStateCache.set(this._key, migrated);
    void Promise.resolve(rpc.viewState.save(this._key, migrated)).catch((error: unknown) => {
      log.error(`Failed to migrate tab view state "${this._key}":`, error);
    });

    return normalizeTabGroupsSnapshot(migrated, this._ctx.workspacePath);
  }

  start(getSnapshot: () => TabGroupsSnapshot): () => void {
    return snapshotRegistry.register(this._key, getSnapshot, 0);
  }
}

function normalizeTabGroupsSnapshot(
  snapshot: TabGroupsSnapshot,
  workspacePath: string | undefined
): TabGroupsSnapshot {
  return {
    ...snapshot,
    groups: snapshot.groups.map((group) => ({
      ...group,
      tabManager: {
        ...group.tabManager,
        tabs: group.tabManager.tabs.map((tab) => normalizeTabDescriptor(tab, workspacePath)),
      },
    })),
  };
}

function normalizeTabDescriptor(
  tab: TabDescriptor,
  workspacePath: string | undefined
): TabDescriptor {
  if (tab.kind === 'file' && !tab.isExternal) {
    return { ...tab, path: resolveWorkspacePath(workspacePath, tab.path) };
  }
  if (tab.kind === 'diff' && tab.diffGroup !== 'pr') {
    return { ...tab, path: resolveWorkspacePath(workspacePath, tab.path) };
  }
  return tab;
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
