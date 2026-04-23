import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
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
    taskId: string,
    taskBranch: string | undefined,
    repositoryStore: RepositoryStore
  ): WorkspaceStore {
    const key = makeKey(projectId, workspaceId);
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount += 1;
      return existing.store;
    }

    const store = new WorkspaceStore(projectId, workspaceId, taskId, taskBranch, repositoryStore);
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

  release(projectId: string, workspaceId: string): void {
    const key = makeKey(projectId, workspaceId);
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    entry.refCount -= 1;

    if (entry.refCount <= 0) {
      entry.store.dispose();
      this.entries.delete(key);
    }
  }
}

export const workspaceRegistry = new WorkspaceRegistryStore();
