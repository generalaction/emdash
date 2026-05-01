import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import type { TaskStore } from './task';
import { WorkspaceStore } from './workspace';

type WorkspaceRegistryEntry = {
  store: WorkspaceStore;
  refCount: number;
  activated: boolean;
};

function makeKey(projectId: string, workspaceId: string): string {
  return `${projectId}::${workspaceId}`;
}

export class WorkspaceRegistryStore {
  private readonly entries = new Map<string, WorkspaceRegistryEntry>();

  acquire(
    projectId: string,
    workspaceId: string,
    taskStore: TaskStore,
    settingsStore: ProjectSettingsStore,
    baseRef: string,
    sshConnectionId?: string
  ): WorkspaceStore {
    const key = makeKey(projectId, workspaceId);
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount += 1;
      existing.store.addTask(taskStore);
      return existing.store;
    }

    const store = new WorkspaceStore(
      projectId,
      workspaceId,
      [taskStore],
      settingsStore,
      baseRef,
      sshConnectionId
    );
    this.entries.set(key, { store, refCount: 1, activated: false });
    return store;
  }

  activate(projectId: string, workspaceId: string): void {
    const entry = this.entries.get(makeKey(projectId, workspaceId));
    if (!entry || entry.activated) {
      return;
    }
    entry.activated = true;
    entry.store.activate();
  }

  release(projectId: string, workspaceId: string, taskStore: TaskStore): void {
    const key = makeKey(projectId, workspaceId);
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    entry.store.removeTask(taskStore);
    entry.refCount -= 1;

    if (entry.refCount <= 0) {
      entry.store.dispose();
      this.entries.delete(key);
    }
  }
}

export const workspaceRegistry = new WorkspaceRegistryStore();
