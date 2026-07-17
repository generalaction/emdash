import type { TabDescriptor, TabGroupsSnapshot } from '@core/features/tasks/contributions/mementos';
import type { TaskTabContext } from '@core/features/workbench/browser/tabs/core/task-tab-context';
import type { TabPersistenceAdapter } from '@core/features/workbench/browser/tabs/persistence';
import { resolveWorkspacePath } from './workspace-path';

/**
 * Persistence adapter for a single task's tab layout.
 *
 * Persists a task's pane layout through its task-scoped memento handle.
 */
export class TaskTabViewPersistor implements TabPersistenceAdapter {
  constructor(private readonly _ctx: TaskTabContext) {}

  load(): TabGroupsSnapshot | null {
    const handle = this._ctx.paneLayoutMemento;
    if (!handle.hasStoredValue) return null;
    const { version: _, ...snapshot } = handle.read();
    if (snapshot.groups.length === 0) return null;
    return normalizeTabGroupsSnapshot(snapshot, this._ctx.workspacePath);
  }

  start(getSnapshot: () => TabGroupsSnapshot): () => void {
    return this._ctx.paneLayoutMemento.autoPersist(() => ({
      version: '1',
      ...getSnapshot(),
    }));
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
