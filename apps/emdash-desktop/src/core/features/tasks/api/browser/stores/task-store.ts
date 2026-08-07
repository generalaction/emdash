import { err, type Result } from '@emdash/shared';
import { makeAutoObservable, observable } from 'mobx';
import type { TaskScopedStoreContext } from '@core/features/tasks/contributions/browser/task-stores';
import { taskStoreContributions } from '@core/manifests/browser/task-scoped-stores';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { log } from '@core/primitives/logging/browser/logger';
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
  WorkspaceBackgroundInfo,
} from '@core/primitives/tasks/api';

export type TaskStoreMutations = {
  rename(task: Task, name: string): Promise<Result<RenameTaskSuccess, RenameTaskError>>;
  updateStatus(task: Task, status: TaskLifecycleStatus): Promise<void>;
  setPinned(task: Task, isPinned: boolean): Promise<void>;
  updateLinkedIssue(task: Task, issue?: LinkedIssue): Promise<void>;
  convertAutomationTask(task: Task): Promise<void>;
};

export class TaskStore implements TaskState {
  state: 'unregistered' | 'unprovisioned' | 'provisioned';
  data: UnregisteredTaskData | Task;
  phase: UnregisteredTaskPhase | UnprovisionedTaskPhase | null;
  errorMessage: string | undefined = undefined;

  /** The workspace ID for this task session — null when unprovisioned. */
  workspaceId: string | null = null;
  workspacePath: string | null = null;
  workspaceSshConnectionId: string | undefined;
  workspaceObservedStatus: 'present' | 'missing' | null = null;
  /** In-flight createWorktree stage streamed from the host records overlay. */
  workspaceCreation: { stage: string; startedAt: number } | null = null;
  /** Durable outcome of the last createWorktree run for this task's workspace. */
  workspaceCreateOutcome: {
    status: 'started' | 'succeeded' | 'failed';
    stage?: string;
    message?: string;
  } | null = null;
  /** Background creation-step statuses (artifact clone, branch push, ref fetch). */
  workspaceBackground: WorkspaceBackgroundInfo | null = null;
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
    projectStores: ScopedStoreLookup = unavailableProjectStores,
    private readonly mutations: TaskStoreMutations = unavailableMutations
  ) {
    this.state = state;
    this.data = data;
    this.phase = phase;
    makeAutoObservable<TaskStore, 'stores'>(this, {
      workspaceId: observable,
      workspacePath: observable,
      workspaceSshConnectionId: observable,
      workspaceObservedStatus: observable,
      workspaceCreation: observable,
      workspaceCreateOutcome: observable,
      workspaceBackground: observable,
      stores: false,
      /** Deep observable so nested fields (e.g. `status`) notify observers (e.g. sidebar). */
      data: observable,
    });
    this.stores = new ScopedStoreHost(
      { projectId, taskId: data.id, task: this, projectStores },
      taskStoreContributions
    );
  }

  setWorkspaceProjection(projection?: {
    path: string | null;
    observedStatus: 'present' | 'missing' | null;
    creation?: { stage: string; startedAt: number } | null;
    lastCreateOutcome?: {
      status: 'started' | 'succeeded' | 'failed';
      stage?: string;
      message?: string;
    } | null;
    background?: WorkspaceBackgroundInfo | null;
  }): void {
    this.workspacePath = projection?.path ?? this.workspacePath;
    this.workspaceObservedStatus = projection?.observedStatus ?? null;
    this.workspaceCreation = projection?.creation ?? null;
    this.workspaceCreateOutcome = projection?.lastCreateOutcome ?? null;
    this.workspaceBackground = projection?.background ?? null;
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
    this.data = { ...data, workspaceId };
    this.workspaceId = workspaceId;
    this.workspacePath = path;
    this.workspaceSshConnectionId = sshConnectionId;
    this.state = 'provisioned';
    this.phase = null;
    this.errorMessage = undefined;
  }

  transitionToUnprovisioned(data: Task, phase: UnprovisionedTaskPhase = 'idle'): void {
    this.workspaceId = null;
    this.workspacePath = null;
    this.workspaceSshConnectionId = undefined;
    this.data = data;
    this.state = 'unprovisioned';
    this.phase = phase;
    this.errorMessage = undefined;
  }

  transitionToDryUnprovisioned(data: Task, phase: UnprovisionedTaskPhase = 'idle'): void {
    this.dispose();
    this.data = data;
    this.state = 'unprovisioned';
    this.phase = phase;
    this.errorMessage = undefined;
  }

  transitionToUnregistered(data: UnregisteredTaskData): void {
    this.workspaceId = null;
    this.workspacePath = null;
    this.workspaceSshConnectionId = undefined;
    this.data = data;
    this.state = 'unregistered';
    this.phase = 'creating';
    this.errorMessage = undefined;
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
      return await this.mutations.rename(task, name);
    } catch (e) {
      log.error(e);
      throw e;
    }
  }

  async updateStatus(status: TaskLifecycleStatus): Promise<void> {
    const task = registeredTaskData(this);
    if (!task) return;
    try {
      await this.mutations.updateStatus(task, status);
    } catch (e) {
      log.error(e);
      throw e;
    }
  }

  async setPinned(isPinned: boolean): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    try {
      await this.mutations.setPinned(task, isPinned);
    } catch (e) {
      log.error(e);
      throw e;
    }
  }

  async updateLinkedIssue(issue?: LinkedIssue): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task) return;
    try {
      await this.mutations.updateLinkedIssue(task, issue);
    } catch (e) {
      log.error(e);
      throw e;
    }
  }

  async convertAutomationTask(): Promise<void> {
    if (this.state === 'unregistered') return;
    const task = registeredTaskData(this);
    if (!task || task.type !== 'automation-run') return;
    try {
      await this.mutations.convertAutomationTask(task);
    } catch (e) {
      log.error(e);
      throw e;
    }
  }
}

export function createUnregisteredTask(
  data: UnregisteredTaskData,
  projectId: string,
  projectStores?: ScopedStoreLookup,
  mutations?: TaskStoreMutations
): TaskStore {
  return new TaskStore(data, 'unregistered', 'creating', projectId, projectStores, mutations);
}

export function createUnprovisionedTask(
  data: Task,
  projectStores?: ScopedStoreLookup,
  mutations?: TaskStoreMutations
): TaskStore {
  return new TaskStore(data, 'unprovisioned', 'idle', data.projectId, projectStores, mutations);
}

const unavailableProjectStores: ScopedStoreLookup = {
  get(token): never {
    throw new Error(`Project scoped store '${token.id}' is unavailable`);
  },
  has: () => false,
};

const unavailableMutations: TaskStoreMutations = {
  rename: async (task) => err({ type: 'task-not-found', taskId: task.id }),
  updateStatus: async () => {
    throw new Error('Task mutations are unavailable');
  },
  setPinned: async () => {
    throw new Error('Task mutations are unavailable');
  },
  updateLinkedIssue: async () => {
    throw new Error('Task mutations are unavailable');
  },
  convertAutomationTask: async () => {
    throw new Error('Task mutations are unavailable');
  },
};
