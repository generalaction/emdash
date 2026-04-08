import { makeAutoObservable, observable, runInAction } from 'mobx';
import { Issue, Task, TaskLifecycleStatus } from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { rpc } from '../ipc';
import { ConversationManagerStore } from './conversation-manager';
import { snapshotRegistry } from './snapshot-registry';
import { TaskViewStore } from './task-view';
import { TerminalManagerStore } from './terminal-manager';
import { WorkspaceStore } from './workspace';

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
  readonly conversations: ConversationManagerStore;
  readonly terminals: TerminalManagerStore;
  readonly taskView: TaskViewStore;

  readonly _taskData: Task;
  readonly path: string;

  private _snapshotDisposer: (() => void) | null = null;

  get snapshot(): TaskViewSnapshot {
    return this.taskView.snapshot;
  }

  constructor(taskData: Task, path: string, savedSnapshot?: TaskViewSnapshot) {
    this._taskData = taskData;
    this.path = path;

    this.workspace = new WorkspaceStore(taskData.projectId, taskData.id);
    this.conversations = new ConversationManagerStore(taskData.projectId, taskData.id);
    this.terminals = new TerminalManagerStore(taskData.projectId, taskData.id);
    this.taskView = new TaskViewStore(
      {
        conversations: this.conversations,
        terminals: this.terminals,
        git: this.workspace.git,
        pr: this.workspace.pr,
        projectId: taskData.projectId,
        taskId: taskData.id,
      },
      savedSnapshot
    );

    makeAutoObservable(this, {
      workspace: false,
      conversations: false,
      terminals: false,
      taskView: false,
      /** Owned by TaskStore.data — do not attach a second observable tree here */
      _taskData: false,
    });

    this._snapshotDisposer = snapshotRegistry.register(`task:${taskData.id}`, () => this.snapshot);
  }

  activate(): void {
    this.workspace.git.startWatching();
    this.workspace.files.startWatching();
    this.workspace.pr.start();
    this.taskView.editorView.initialize();
  }

  dispose(): void {
    this._snapshotDisposer?.();
    this._snapshotDisposer = null;
    this.workspace.dispose();
    this.taskView.dispose();
    this.conversations.dispose();
    for (const term of this.terminals.terminals.values()) {
      term.dispose();
    }
  }

  async updateLinkedIssue(issue?: Issue): Promise<void> {
    const previousIssue = this._taskData.linkedIssue;
    try {
      await rpc.tasks.updateLinkedIssue(this._taskData.id, issue);
      runInAction(() => {
        this._taskData.linkedIssue = issue;
      });
    } catch (e) {
      runInAction(() => {
        this._taskData.linkedIssue = previousIssue;
      });
      console.error(e);
      throw e;
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

  transitionToProvisioned(data: Task, path: string, savedSnapshot?: TaskViewSnapshot): void {
    this.data = data;
    this.provisionedTask = new ProvisionedTask(data, path, savedSnapshot);
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
      console.error(e);
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
      console.error(e);
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
