import { makeAutoObservable, observable, runInAction } from 'mobx';
import { Issue, Task, TaskLifecycleStatus } from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { workspaceKey } from '@shared/workspace-key';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { DevServerStore } from '@renderer/features/tasks/stores/dev-server-store';
import { TaskViewStore } from '@renderer/features/tasks/stores/task-view';
import type { WorkspaceStore } from '@renderer/features/tasks/stores/workspace';
import { workspaceRegistry } from '@renderer/features/tasks/stores/workspace-registry';
import { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';
import { rpc } from '@renderer/lib/ipc';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { log } from '@renderer/utils/logger';

export type UnregisteredTaskPhase = 'creating' | 'create-error';

export type UnprovisionedTaskPhase =
  | 'provision'
  | 'provision-error'
  | 'teardown'
  | 'teardown-error'
  | 'idle';

export type UnregisteredTaskData = {
  id: string;
  name: string;
  status: TaskLifecycleStatus;
  lastInteractedAt: string;
  createdAt: string;
  statusChangedAt: string;
  isPinned: boolean;
};

export class ProvisionedTask {
  readonly workspace: WorkspaceStore;
  readonly devServers: DevServerStore;
  readonly conversations: ConversationManagerStore;
  readonly terminals: TerminalManagerStore;
  readonly taskView: TaskViewStore;

  readonly _taskData: Task;
  readonly path: string;
  readonly workspaceId: string;

  private _snapshotDisposer: (() => void) | null = null;

  get snapshot(): TaskViewSnapshot {
    return this.taskView.snapshot;
  }

  get taskBranch(): string | undefined {
    return this._taskData.taskBranch;
  }

  constructor(
    taskData: Task,
    path: string,
    repositoryStore: RepositoryStore,
    savedSnapshot?: TaskViewSnapshot
  ) {
    this._taskData = taskData;
    this.path = path;
    this.workspaceId = workspaceKey(taskData.taskBranch);

    this.workspace = workspaceRegistry.acquire(
      taskData.projectId,
      this.workspaceId,
      repositoryStore,
      () => (this._taskData as Task).prs ?? []
    );
    this.devServers = new DevServerStore(taskData.id, this.workspaceId);
    this.conversations = new ConversationManagerStore(taskData.projectId, taskData.id);
    this.terminals = new TerminalManagerStore(taskData.projectId, taskData.id);
    this.taskView = new TaskViewStore(
      {
        conversations: this.conversations,
        terminals: this.terminals,
        git: this.workspace.git,
        pr: this.workspace.pr,
        projectId: taskData.projectId,
        workspaceId: this.workspaceId,
      },
      savedSnapshot
    );

    makeAutoObservable(this, {
      workspace: false,
      devServers: false,
      conversations: false,
      terminals: false,
      taskView: false,
      /** Owned by TaskStore.data — do not attach a second observable tree here */
      _taskData: false,
    });

    this._snapshotDisposer = snapshotRegistry.register(`task:${taskData.id}`, () => this.snapshot);
  }

  activate(): void {
    workspaceRegistry.activate(this._taskData.projectId, this.workspaceId);
  }

  dispose(): void {
    this._snapshotDisposer?.();
    this._snapshotDisposer = null;
    workspaceRegistry.release(this._taskData.projectId, this.workspaceId);
    this.devServers.dispose();
    this.taskView.dispose();
    this.conversations.dispose();
    for (const term of this.terminals.terminals.values()) {
      term.dispose();
    }
  }
}

export class TaskStore {
  state: 'unregistered' | 'unprovisioned' | 'provisioned';
  data: UnregisteredTaskData | Task;
  phase: UnregisteredTaskPhase | UnprovisionedTaskPhase | null;
  errorMessage: string | undefined = undefined;
  provisionedTask: ProvisionedTask | null = null;

  get displayName(): string {
    return this.data.name;
  }

  get isBootstrapping(): boolean {
    return (
      this.state === 'unregistered' ||
      (this.state === 'unprovisioned' &&
        (this.phase === 'provision' || this.phase === 'provision-error'))
    );
  }

  constructor(
    data: UnregisteredTaskData | Task,
    state: TaskStore['state'],
    phase: UnregisteredTaskPhase | UnprovisionedTaskPhase | null = null
  ) {
    this.state = state;
    this.data = data;
    this.phase = phase;
    makeAutoObservable(this, {
      provisionedTask: observable.ref,
      /** Deep observable so nested fields (e.g. `status`) notify observers (e.g. sidebar). */
      data: observable,
    });
  }

  transitionToProvisioned(
    data: Task,
    path: string,
    repositoryStore: RepositoryStore,
    savedSnapshot?: TaskViewSnapshot
  ): void {
    this.data = data;
    this.provisionedTask = new ProvisionedTask(
      this.data as Task,
      path,
      repositoryStore,
      savedSnapshot
    );
    this.state = 'provisioned';
    this.phase = null;
    this.errorMessage = undefined;
  }

  transitionToUnprovisioned(data: Task, phase: UnprovisionedTaskPhase = 'idle'): void {
    this.provisionedTask?.dispose();
    this.provisionedTask = null;
    this.data = data;
    this.state = 'unprovisioned';
    this.phase = phase;
    this.errorMessage = undefined;
  }

  transitionToUnregistered(data: UnregisteredTaskData): void {
    this.provisionedTask?.dispose();
    this.provisionedTask = null;
    this.data = data;
    this.state = 'unregistered';
    this.phase = 'creating';
    this.errorMessage = undefined;
  }

  activate(): void {
    this.provisionedTask?.activate();
  }

  dispose(): void {
    this.provisionedTask?.dispose();
    this.provisionedTask = null;
  }

  get conversationStats(): Record<string, number> {
    if (this.state === 'unregistered') {
      return {};
    }
    if (this.state === 'provisioned' && this.provisionedTask) {
      const counts: Record<string, number> = {};
      for (const conv of this.provisionedTask.conversations.conversations.values()) {
        const id = conv.data.providerId;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    }
    return (this.data as Task).conversations;
  }

  async rename(name: string): Promise<void> {
    if (this.state !== 'provisioned') return;
    const task = registeredTaskData(this);
    if (!task) return;
    try {
      await rpc.tasks.renameTask(task.projectId, task.id, name);
      runInAction(() => {
        this.data.name = name;
      });
    } catch (e) {
      runInAction(() => {
        this.data.name = task.name;
      });
      log.error(e);
      throw e;
    }
  }

  async updateStatus(status: TaskLifecycleStatus): Promise<void> {
    const previousStatus = this.data.status;
    const previousStatusChangedAt = this.data.statusChangedAt;
    const nextChangedAt = new Date().toISOString();
    runInAction(() => {
      this.data.status = status;
      this.data.statusChangedAt = nextChangedAt;
    });
    try {
      await rpc.tasks.updateTaskStatus(this.data.id, status);
    } catch (e) {
      runInAction(() => {
        this.data.status = previousStatus;
        this.data.statusChangedAt = previousStatusChangedAt;
      });
      log.error(e);
      throw e;
    }
  }

  async setPinned(isPinned: boolean): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    const previous = task.isPinned;
    runInAction(() => {
      task.isPinned = isPinned;
    });
    try {
      await rpc.tasks.setTaskPinned(task.id, isPinned);
    } catch (e) {
      runInAction(() => {
        task.isPinned = previous;
      });
      log.error(e);
      throw e;
    }
  }

  async updateLinkedIssue(issue?: Issue): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    const previousIssue = task.linkedIssue;
    try {
      await rpc.tasks.updateLinkedIssue(task.id, issue);
      runInAction(() => {
        task.linkedIssue = issue;
      });
    } catch (e) {
      runInAction(() => {
        task.linkedIssue = previousIssue;
      });
      console.error(e);
      throw e;
    }
  }
}

export type UnregisteredTask = TaskStore & {
  state: 'unregistered';
  data: UnregisteredTaskData;
  phase: UnregisteredTaskPhase;
  errorMessage: string | undefined;
};

export type UnprovisionedTask = TaskStore & {
  state: 'unprovisioned';
  data: Task;
  phase: UnprovisionedTaskPhase;
  errorMessage: string | undefined;
};

export function isUnregistered(t: TaskStore): t is UnregisteredTask {
  return t.state === 'unregistered';
}

export function isRegistered(
  t: TaskStore
): t is TaskStore & { state: 'unprovisioned' | 'provisioned'; data: Task } {
  return t.state !== 'unregistered';
}

export function isUnprovisioned(t: TaskStore): t is UnprovisionedTask {
  return t.state === 'unprovisioned';
}

export function isProvisioned(
  t: TaskStore
): t is TaskStore & { state: 'provisioned'; data: Task; provisionedTask: ProvisionedTask } {
  return t.state === 'provisioned';
}

/** Full `Task` payload when registered (unprovisioned or provisioned); `undefined` when unregistered. */
export function registeredTaskData(store: TaskStore): Task | undefined {
  return isRegistered(store) ? store.data : undefined;
}

export function unregisteredTaskData(store: TaskStore): UnregisteredTaskData | undefined {
  return isUnregistered(store) ? store.data : undefined;
}

export function createUnregisteredTask(data: UnregisteredTaskData): TaskStore {
  return new TaskStore(data, 'unregistered', 'creating');
}

export function createUnprovisionedTask(data: Task): TaskStore {
  return new TaskStore(data, 'unprovisioned', 'idle');
}
