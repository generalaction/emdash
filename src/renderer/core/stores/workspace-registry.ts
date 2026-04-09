import { WorkspaceStore } from './workspace';

type WorkspaceRegistryEntry = {
  store: WorkspaceStore;
  refCount: number;
  activated: boolean;
  taskIds: Set<string>;
  routingTaskId: string;
};

function makeKey(projectId: string, workspaceId: string): string {
  return `${projectId}::${workspaceId}`;
}

export class WorkspaceRegistryStore {
  private readonly entries = new Map<string, WorkspaceRegistryEntry>();

  acquire(projectId: string, workspaceId: string, taskId: string): WorkspaceStore {
    const key = makeKey(projectId, workspaceId);
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount += 1;
      existing.taskIds.add(taskId);
      return existing.store;
    }

    const getTaskId = (): string => {
      const entry = this.entries.get(key);
      if (!entry) {
        throw new Error(`Workspace registry entry missing for ${key}`);
      }
      return entry.routingTaskId;
    };

    const store = new WorkspaceStore(projectId, workspaceId, getTaskId);
    this.entries.set(key, {
      store,
      refCount: 1,
      activated: false,
      taskIds: new Set([taskId]),
      routingTaskId: taskId,
    });

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

  release(projectId: string, workspaceId: string, taskId: string): void {
    const key = makeKey(projectId, workspaceId);
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    entry.refCount -= 1;

    if (entry.refCount <= 0) {
      entry.store.dispose();
      this.entries.delete(key);
      return;
    }

    entry.taskIds.delete(taskId);
    if (entry.routingTaskId === taskId) {
      const next = entry.taskIds.values().next().value;
      if (next) {
        entry.routingTaskId = next;
      }
    }
  }
}

export const workspaceRegistry = new WorkspaceRegistryStore();
