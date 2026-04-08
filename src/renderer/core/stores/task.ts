import { makeAutoObservable, observable, runInAction } from 'mobx';
import { Issue, Task, TaskLifecycleStatus } from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { rpc } from '../ipc';
import { ConversationManagerStore } from './conversation-manager';
import { DevServerStore } from './dev-server-store';
import { DiffViewStore } from './diff-view-store';
import { EditorViewStore } from './editor-view-store';
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
};

export class ProvisionedTask {
  readonly workspace: WorkspaceStore;
  readonly diffView: DiffViewStore;
  readonly devServers: DevServerStore;
  readonly conversations: ConversationManagerStore;
  readonly terminals: TerminalManagerStore;
  readonly editorView: EditorViewStore;
  readonly taskView: TaskViewStore;

  data: Task;
  readonly path: string;

  private _snapshotDisposer: (() => void) | null = null;

  get snapshot(): TaskViewSnapshot {
    return {
      ...this.taskView.snapshot,
      conversations: this.conversations.snapshot,
      terminals: this.terminals.snapshot,
      editor: this.editorView.snapshot,
      diffView: this.diffView.snapshot,
    };
  }

  constructor(data: Task, path: string, savedSnapshot?: TaskViewSnapshot) {
    this.data = data;
    this.path = path;

    this.workspace = new WorkspaceStore(data.projectId, data.id);
    this.diffView = new DiffViewStore(this.workspace.git, this.workspace.pr);
    this.devServers = new DevServerStore(data.id);
    this.conversations = new ConversationManagerStore(data.projectId, data.id);
    this.terminals = new TerminalManagerStore(data.projectId, data.id);
    this.editorView = new EditorViewStore(data.projectId, data.id);
    this.taskView = new TaskViewStore(savedSnapshot);

    if (savedSnapshot) {
      this.conversations.restoreSnapshot(savedSnapshot.conversations ?? {});
      this.terminals.restoreSnapshot(savedSnapshot.terminals ?? {});
      this.editorView.restoreSnapshot(savedSnapshot.editor ?? {});
      this.diffView.restoreSnapshot(savedSnapshot.diffView ?? {});
    }

    makeAutoObservable(this, {
      workspace: false,
      diffView: false,
      devServers: false,
      conversations: false,
      terminals: false,
      editorView: false,
      taskView: false,
    });

    this._snapshotDisposer = snapshotRegistry.register(`task:${data.id}`, () => this.snapshot);
  }

  activate(): void {
    this.workspace.git.startWatching();
    this.workspace.files.startWatching();
    this.workspace.pr.start();
    this.editorView.initialize();
  }

  dispose(): void {
    this._snapshotDisposer?.();
    this._snapshotDisposer = null;
    this.editorView.dispose();
    this.workspace.git.dispose();
    this.workspace.files.dispose();
    this.diffView.dispose();
    this.devServers.dispose();
    this.workspace.pr.dispose();
    this.conversations.dispose();
    for (const term of this.terminals.terminals.values()) {
      term.dispose();
    }
  }

  async updateStatus(status: TaskLifecycleStatus): Promise<void> {
    const previousStatus = this.data.status;
    runInAction(() => {
      this.data.status = status;
    });
    try {
      await rpc.tasks.updateTaskStatus(this.data.id, status);
    } catch (e) {
      runInAction(() => {
        this.data.status = previousStatus;
      });
      console.error(e);
      throw e;
    }
  }

  async updateLinkedIssue(issue?: Issue): Promise<void> {
    const previousIssue = this.data.linkedIssue;
    try {
      await rpc.tasks.updateLinkedIssue(this.data.id, issue);
      runInAction(() => {
        this.data.linkedIssue = issue;
      });
    } catch (e) {
      runInAction(() => {
        this.data.linkedIssue = previousIssue;
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
    makeAutoObservable(this, { provisionedTask: observable.ref });
  }

  transitionToProvisioned(data: Task, path: string, savedSnapshot?: TaskViewSnapshot): void {
    this.provisionedTask = new ProvisionedTask(data, path, savedSnapshot);
    this.data = data;
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
    const task = this.data as Task;
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

export function createUnregisteredTask(data: UnregisteredTaskData): TaskStore {
  return new TaskStore(data, 'unregistered', 'creating');
}

export function createUnprovisionedTask(data: Task): TaskStore {
  return new TaskStore(data, 'unprovisioned', 'idle');
}
