import type { TabDescriptor, TabGroupsSnapshot } from '@core/features/tasks/contributions/mementos';
import { resolveWorkspacePath } from '@core/features/workspaces/api/browser/workspace-path';
import type { TabPersistenceAdapter } from '@core/primitives/workbench-shell/browser/tabs/persistence';
import type { TaskTabContext } from './task-tab-context';

export class TaskTabViewPersistor implements TabPersistenceAdapter {
  constructor(private readonly context: TaskTabContext) {}

  load(): TabGroupsSnapshot | null {
    const handle = this.context.paneLayoutMemento;
    if (!handle.hasStoredValue) return null;
    const { version: _, ...snapshot } = handle.read();
    if (snapshot.groups.length === 0) return null;
    return normalizeTabGroupsSnapshot(snapshot, this.context.workspacePath);
  }

  start(getSnapshot: () => TabGroupsSnapshot): () => void {
    return this.context.paneLayoutMemento.autoPersist(() => ({
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
