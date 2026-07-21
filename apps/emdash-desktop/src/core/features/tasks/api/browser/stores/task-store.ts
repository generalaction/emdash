import type { WorkspaceError } from '@emdash/core/runtimes/workspace/api';
import { err, type Result } from '@emdash/shared';
import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { TaskScopedStoreContext } from '@core/features/tasks/contributions/browser/task-stores';
import type { WorkspaceBootstrapProgress } from '@core/features/workspaces/api';
import { taskStoreContributions } from '@core/manifests/browser/task-scoped-stores';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import {
  ScopedStoreHost,
  type ScopedStoreLookup,
  type ScopedStoreToken,
  type ScopedStoreValue,
} from '@core/primitives/scoped-stores/browser';
import {
  registeredTaskData,
  type TaskState,
  type UnprovisionedTaskPhase,
  type UnregisteredTaskData,
  type UnregisteredTaskPhase,
} from '@core/primitives/task-state/browser/task-state';
import type {
  RenameTaskError,
  RenameTaskSuccess,
  Task,
  TaskLifecycleStatus,
} from '@core/primitives/tasks/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { log } from '@renderer/utils/logger';

export class TaskStore implements TaskState {
  state: 'unregistered' | 'unprovisioned' | 'provisioned';
  data: UnregisteredTaskData | Task;
  phase: UnregisteredTaskPhase | UnprovisionedTaskPhase | null;
  errorMessage: string | undefined = undefined;
  provisionProgressMessage: string | null = null;
  provisionProgress: WorkspaceBootstrapProgress | null = null;
  provisionError: WorkspaceError | null = null;

  /** The workspace ID for this task session — null when unprovisioned. */
  workspaceId: string | null = null;
  workspacePath: string | null = null;
  workspaceSshConnectionId: string | undefined;
  private stores: ScopedStoreHost<TaskScopedStoreContext>;

  get displayName(): string {
    return this.data.name;
  }

  /** True only while creation/provisioning is actively running — error phases are settled, not busy. */
  get isBootstrapping(): boolean {
    return (
      (this.state === 'unregistered' && this.phase === 'creating') ||
      (this.state === 'unprovisioned' && this.phase === 'provision')
    );
  }

  constructor(
    data: UnregisteredTaskData | Task,
    state: TaskStore['state'],
    phase: UnregisteredTaskPhase | UnprovisionedTaskPhase | null = null,
    projectId: string = 'projectId' in data ? data.projectId : '',
    projectStores: ScopedStoreLookup = unavailableProjectStores
  ) {
    this.state = state;
    this.data = data;
    this.phase = phase;
    makeAutoObservable<TaskStore, 'stores'>(this, {
      workspaceId: observable,
      workspacePath: observable,
      workspaceSshConnectionId: observable,
      stores: false,
      /** Deep observable so nested fields (e.g. `status`) notify observers (e.g. sidebar). */
      data: observable,
    });
    this.stores = new ScopedStoreHost(
      { projectId, taskId: data.id, task: this, projectStores },
      taskStoreContributions
    );
  }

  get<Token extends ScopedStoreToken<unknown>>(token: Token): ScopedStoreValue<Token> {
    return this.stores.get(token);
  }

  ready(): Promise<void> {
    return this.stores.ready();
  }

  transitionToProvisioned(
    data: Task,
    path: string,
    workspaceId: string,
    sshConnectionId?: string
  ): void {
    this.data = data;
    this.workspaceId = workspaceId;
    this.workspacePath = path;
    this.workspaceSshConnectionId = sshConnectionId;
    this.state = 'provisioned';
    this.phase = null;
    this.errorMessage = undefined;
    this.provisionProgressMessage = null;
    this.provisionProgress = null;
    this.provisionError = null;
  }

  transitionToUnprovisioned(data: Task, phase: UnprovisionedTaskPhase = 'idle'): void {
    this.workspaceId = null;
    this.workspacePath = null;
    this.workspaceSshConnectionId = undefined;
    this.data = data;
    this.state = 'unprovisioned';
    this.phase = phase;
    this.errorMessage = undefined;
    this.provisionProgressMessage = null;
    this.provisionProgress = null;
    this.provisionError = null;
  }

  transitionToDryUnprovisioned(data: Task, phase: UnprovisionedTaskPhase = 'idle'): void {
    this.dispose();
    this.data = data;
    this.state = 'unprovisioned';
    this.phase = phase;
    this.errorMessage = undefined;
    this.provisionProgressMessage = null;
    this.provisionProgress = null;
    this.provisionError = null;
  }

  transitionToUnregistered(data: UnregisteredTaskData): void {
    this.workspaceId = null;
    this.workspacePath = null;
    this.workspaceSshConnectionId = undefined;
    this.data = data;
    this.state = 'unregistered';
    this.phase = 'creating';
    this.errorMessage = undefined;
    this.provisionProgressMessage = null;
    this.provisionProgress = null;
    this.provisionError = null;
  }

  activate(): void {
    this.stores.activate();
  }

  dispose(): void {
    this.stores.dispose();
    this.workspaceId = null;
    this.workspacePath = null;
    this.workspaceSshConnectionId = undefined;
  }

  async rename(name: string): Promise<Result<RenameTaskSuccess, RenameTaskError>> {
    const task = registeredTaskData(this);
    if (!task) return err({ type: 'task-not-found', taskId: this.data.id });
    try {
      const result = await (
        await getDesktopWireClient()
      ).tasks.renameTask({
        projectId: task.projectId,
        taskId: task.id,
        newName: name,
      });
      if (!result.success) {
        return result;
      }
      runInAction(() => {
        const current = registeredTaskData(this);
        if (current) {
          current.name = name;
        }
      });
      return result;
    } catch (e) {
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
      await (
        await getDesktopWireClient()
      ).tasks.updateTaskStatus({
        taskId: this.data.id,
        status,
      });
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
      await (await getDesktopWireClient()).tasks.setTaskPinned({ taskId: task.id, isPinned });
    } catch (e) {
      runInAction(() => {
        task.isPinned = previous;
      });
      log.error(e);
      throw e;
    }
  }

  async updateLinkedIssue(issue?: LinkedIssue): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    const previousIssue = task.linkedIssue;
    try {
      await (
        await getDesktopWireClient()
      ).tasks.updateLinkedIssue({
        taskId: task.id,
        issue,
      });
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

  async convertAutomationTask(): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task || task.type !== 'automation-run') return;
    runInAction(() => {
      task.type = 'task';
    });
    try {
      await (await getDesktopWireClient()).tasks.convertAutomationTask({ taskId: task.id });
    } catch (e) {
      runInAction(() => {
        task.type = 'automation-run';
      });
      console.error(e);
      throw e;
    }
  }
}

export function createUnregisteredTask(
  data: UnregisteredTaskData,
  projectId: string,
  projectStores?: ScopedStoreLookup
): TaskStore {
  return new TaskStore(data, 'unregistered', 'creating', projectId, projectStores);
}

export function createUnprovisionedTask(data: Task, projectStores?: ScopedStoreLookup): TaskStore {
  return new TaskStore(data, 'unprovisioned', 'idle', data.projectId, projectStores);
}

const unavailableProjectStores: ScopedStoreLookup = {
  get(token): never {
    throw new Error(`Project scoped store '${token.id}' is unavailable`);
  },
  has: () => false,
};
