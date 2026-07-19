import type { AgentProviderId } from '@emdash/plugins/agents';
import { makeObservable, observable, reaction, runInAction, toJS } from 'mobx';
import { toast } from 'sonner';
import { match } from 'ts-pattern';
import { conversationRegistry } from '@renderer/features/conversations/stores/conversation-registry';
import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import {
  getProjectManagerStore,
  getProjectSshConnectionId,
} from '@renderer/features/projects/stores/project-selectors';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import { getTaskGitWorktreeStore } from '@renderer/features/tasks/stores/task-selectors';
import { events, rpc } from '@renderer/lib/ipc';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import type { Conversation } from '@shared/core/conversations/conversations';
import { gitWorktreeUpdateChannel } from '@shared/core/git/events';
import { prSyncProgressChannel, prUpdatedChannel } from '@shared/core/pull-requests/prEvents';
import {
  lifecycleScriptStatusChannel,
  taskCreatedChannel,
  taskDeletedChannel,
  taskProvisionProgressChannel,
  taskProvisionedChannel,
  taskStatusUpdatedChannel,
} from '@shared/core/tasks/taskEvents';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskWarning,
  DeleteTaskOptions,
  ProvisionWorkspaceError,
  Task,
  TaskLifecycleStatus,
} from '@shared/core/tasks/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { formatFetchErrorDetail, formatPushErrorDetail } from '../utils';
import {
  createUnprovisionedTask,
  createUnregisteredTask,
  isProvisioned,
  isRegistered,
  isUnprovisioned,
  isUnregistered,
  type TaskStore,
} from './task-store';
import { terminalRegistry } from './terminal-registry';
import { workspaceRegistry } from './workspace-registry';

function formatCreateTaskError(error: CreateTaskError, opts?: { isSshProject?: boolean }): string {
  return match(error)
    .with({ type: 'project-not-found' }, () => 'Project not found.')
    .with(
      { type: 'initial-commit-required' },
      () => 'Create an initial commit to enable branch-based tasks.'
    )
    .with({ type: 'branch-create-failed' }, (e) => {
      switch (e.error.type) {
        case 'already_exists':
          return `Branch "${e.error.branch}" already exists. Try a different task name.`;
        case 'fetch_failed':
          return `Could not update "${e.error.remote}/${e.error.branch}" before creating the task: ${formatFetchErrorDetail(e.error.error, opts)}`;
        case 'invalid_base':
          return `Source branch "${e.error.from}" is not a valid base. Check that it exists locally or on the selected remote.`;
        case 'invalid_name':
          return `Branch "${e.error.branch}" is not a valid branch name.`;
        default:
          return `Could not create branch "${e.branch}": ${e.error.message}`;
      }
    })
    .with({ type: 'pr-fetch-failed' }, (e) =>
      e.error.type === 'not_found'
        ? `PR #${e.error.prNumber} was not found on remote "${e.remote}".`
        : `Could not fetch the pull request branch: ${e.error.message}`
    )
    .with(
      { type: 'branch-not-found' },
      (e) =>
        `Branch "${e.branch}" was not found locally or on the remote. Make sure the PR branch exists.`
    )
    .with({ type: 'worktree-setup-failed' }, (e) =>
      e.message
        ? `Could not set up the worktree for branch "${e.branch}": ${e.message}`
        : `Could not set up the worktree for branch "${e.branch}".`
    )
    .with({ type: 'provision-failed' }, (e) => e.message)
    .with({ type: 'provision-timeout' }, (e) => `Provisioning timed out after ${e.timeoutMs}ms.`)
    .exhaustive();
}

function formatProvisionWorkspaceError(error: ProvisionWorkspaceError): string {
  return match(error)
    .with(
      { type: 'no-intent' },
      () => 'Workspace is missing recoverable setup intent and cannot be provisioned.'
    )
    .with(
      { type: 'missing-workspace' },
      () => 'This task does not have a workspace record and cannot be opened.'
    )
    .with(
      { type: 'setup-failed' },
      (e) =>
        `Setup step '${e.stepKind}' failed (${e.stepErrorType})${e.message ? `: ${e.message}` : ''}.`
    )
    .exhaustive();
}

function formatCreateTaskWarning(warning: CreateTaskWarning): string {
  return match(warning)
    .with({ type: 'branch-publish-failed' }, (w) => {
      const detail = formatPushErrorDetail(w.error);
      return `Failed to publish branch "${w.branch}" to "${w.remote}": ${detail}`;
    })
    .exhaustive();
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TaskManagerStore {
  private readonly projectId: string;
  private readonly _repository: GitRepositoryStore;
  private readonly _settingsStore: ProjectSettingsStore;
  private _loadPromise: Promise<void> | null = null;
  private _teardownPromises = new Map<string, Promise<void>>();
  private _provisionPromises = new Map<string, Promise<void>>();

  private _unsubTaskCreated: (() => void) | null = null;
  private _unsubTaskDeleted: (() => void) | null = null;
  private _unsubPrUpdated: (() => void) | null = null;
  private _unsubPrSyncProgress: (() => void) | null = null;
  private _unsubGitWorktreeUpdate: (() => void) | null = null;
  private _unsubProvisionProgress: (() => void) | null = null;
  private _unsubStatusUpdated: (() => void) | null = null;
  private _unsubLifecycleScriptStatus: (() => void) | null = null;
  private _unsubProvisioned: (() => void) | null = null;
  private _disposeRepositoryReaction: (() => void) | null = null;

  tasks = observable.map<string, TaskStore>();

  constructor(
    projectId: string,
    repository: GitRepositoryStore,
    settingsStore: ProjectSettingsStore
  ) {
    this.projectId = projectId;
    this._repository = repository;
    this._settingsStore = settingsStore;
    makeObservable(this, { tasks: observable });

    this._unsubTaskCreated = events.on(taskCreatedChannel, ({ task }) => {
      if (task.projectId !== this.projectId || this.tasks.has(task.id)) return;
      runInAction(() => {
        this.tasks.set(task.id, createUnprovisionedTask(task));
        // Acquire conversation/terminal managers inside the same action so the
        // WorkspaceViewModel's reaction on `conversations.size` registers the
        // manager's observable map as a dependency on its first evaluation.
        conversationRegistry.acquire(task.id, this.projectId, []);
        terminalRegistry.acquire(task.id, this.projectId);
      });
    });

    this._unsubTaskDeleted = events.on(
      taskDeletedChannel,
      ({ taskId, projectId: evtProjectId }) => {
        if (evtProjectId !== this.projectId) return;
        this._removeTaskLocally(taskId);
      }
    );

    this._unsubStatusUpdated = events.on(
      taskStatusUpdatedChannel,
      ({ taskId, projectId: evtProjectId, status }) => {
        if (evtProjectId !== this.projectId) return;
        const store = this.tasks.get(taskId);
        if (store && isProvisioned(store)) {
          runInAction(() => {
            store.data.status = status as TaskLifecycleStatus;
          });
        }
      }
    );

    this._unsubProvisionProgress = events.on(
      taskProvisionProgressChannel,
      ({ taskId, projectId: evtProjectId, message }) => {
        if (evtProjectId !== this.projectId) return;
        const store = this.tasks.get(taskId);
        if (store?.isBootstrapping) {
          runInAction(() => {
            store.provisionProgressMessage = message;
          });
        }
      }
    );

    this._unsubLifecycleScriptStatus = events.on(lifecycleScriptStatusChannel, (statusEvent) => {
      if (
        statusEvent.projectId !== this.projectId ||
        statusEvent.status !== 'failed' ||
        !statusEvent.surfaceFailure
      ) {
        return;
      }
      const { taskId, type, message } = statusEvent;
      const taskName = this.tasks.get(taskId)?.data.name;
      const label = type[0].toUpperCase() + type.slice(1);
      toast.error(`${label} script failed${taskName ? ` for ${taskName}` : ''}`, {
        description: message,
      });
    });

    // Handles tasks provisioned by the automation path (or any main-process caller)
    // without renderer-initiated RPCs. The `isUnprovisioned` guard prevents a
    // double-transition if the renderer-driven RPC already completed first.
    this._unsubProvisioned = events.on(
      taskProvisionedChannel,
      ({ taskId, projectId: evtProjectId, path, workspaceId, sshConnectionId }) => {
        if (evtProjectId !== this.projectId) return;
        void this._doHandleProvisioned(taskId, path, workspaceId, sshConnectionId);
      }
    );

    this._unsubPrUpdated = events.on(prUpdatedChannel, ({ prs }) => {
      const repoUrl = this._repository.pullRequestRepositoryUrl;
      if (!repoUrl) return;
      for (const pr of prs) {
        if (pr.repositoryUrl !== repoUrl) continue;
        for (const [, store] of this.tasks) {
          if (!isRegistered(store)) continue;
          const task = store.data as Task;
          const branchName = getTaskGitWorktreeStore(task.projectId, task.id)?.branchName;
          if (branchName !== pr.headRefName) continue;
          runInAction(() => {
            const idx = task.prs.findIndex((p) => p.url === pr.url);
            if (idx >= 0) {
              task.prs.splice(idx, 1, pr);
            } else {
              task.prs.push(pr);
            }
          });
        }
      }
    });

    this._unsubPrSyncProgress = events.on(prSyncProgressChannel, (progress) => {
      if (progress.status !== 'done') return;
      const repoUrl = this._repository.pullRequestRepositoryUrl;
      if (!repoUrl || progress.remoteUrl !== repoUrl) return;
      for (const [, store] of this.tasks) {
        if (isRegistered(store)) {
          void this._reloadPrsForTask(store);
        }
      }
    });

    this._unsubGitWorktreeUpdate = events.on(gitWorktreeUpdateChannel, (payload) => {
      if (payload.projectId !== this.projectId || payload.update.kind !== 'head') return;
      for (const [, store] of this.tasks) {
        if (isRegistered(store) && store.workspaceId === payload.workspaceId) {
          void this._reloadPrsForTask(store);
        }
      }
    });

    this._disposeRepositoryReaction = reaction(
      () => this._repository.pullRequestRepositoryUrl,
      () => {
        for (const [, store] of this.tasks) {
          if (isRegistered(store)) {
            void this._reloadPrsForTask(store);
          }
        }
      }
    );
  }

  private async _reloadPrsForTask(store: TaskStore): Promise<void> {
    if (!isRegistered(store)) return;
    const result = await rpc.pullRequests.getPullRequestsForTask(this.projectId, store.data.id);
    if (!result.success) return;
    const prs = result.data.prs;
    runInAction(() => {
      if (isRegistered(store)) {
        (store.data as Task).prs = prs;
      }
    });
  }

  private _releaseTaskRegistries(taskId: string): void {
    conversationRegistry.release(taskId);
    terminalRegistry.release(taskId);
  }

  private _removeTaskLocally(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this._releaseTaskRegistries(taskId);
    task.dispose();
    runInAction(() => {
      this.tasks.delete(taskId);
    });
  }

  loadTasks(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = Promise.all([
        rpc.tasks.getTasks(this.projectId),
        rpc.conversations.getConversationsForProject(this.projectId),
      ])
        .then(([tasks, allConversations]) => {
          const conversationsByTask = new Map<string, Conversation[]>();
          for (const conv of allConversations) {
            const list = conversationsByTask.get(conv.taskId) ?? [];
            list.push(conv);
            conversationsByTask.set(conv.taskId, list);
          }
          runInAction(() => {
            for (const t of tasks) {
              this.tasks.set(t.id, createUnprovisionedTask(t));
              // Preload conversations for each task so sidebar badges are available immediately.
              conversationRegistry.acquire(
                t.id,
                this.projectId,
                conversationsByTask.get(t.id) ?? []
              );
              terminalRegistry.acquire(t.id, this.projectId);
            }
          });
          const reloadPromises = tasks.flatMap((t) => {
            const store = this.tasks.get(t.id);
            return store && isRegistered(store) ? [this._reloadPrsForTask(store)] : [];
          });
          void Promise.all(reloadPromises);
        })
        .catch((e) => {
          console.error('Error loading tasks', e);
        });
    }
    return this._loadPromise;
  }

  async createTask(params: CreateTaskParams) {
    runInAction(() => {
      const { taskConfig } = params;
      this.tasks.set(
        params.id,
        createUnregisteredTask({
          id: params.id,
          lastInteractedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          name: taskConfig.name,
          status: taskConfig.initialStatus ?? 'in_progress',
          statusChangedAt: new Date().toISOString(),
          isPinned: false,
          type: 'task',
        })
      );

      if (taskConfig.initialConversation) {
        const ic = taskConfig.initialConversation;
        const optimistic: Conversation = {
          id: ic.id,
          projectId: this.projectId,
          taskId: params.id,
          providerId: ic.provider as AgentProviderId,
          title: ic.title ?? '',
          lastInteractedAt: null,
          autoApprove: ic.autoApprove ?? false,
          model: ic.model,
          initialQueue: ic.initialQueue,
          isInitialConversation: true,
          type: ic.type ?? 'pty',
        };
        conversationRegistry.acquire(params.id, this.projectId, [optimistic]);
      } else {
        conversationRegistry.acquire(params.id, this.projectId, []);
      }
      terminalRegistry.acquire(params.id, this.projectId);
    });

    const result = await rpc.tasks
      .createTask(JSON.parse(JSON.stringify(toJS(params))) as typeof params)
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        runInAction(() => {
          const current = this.tasks.get(params.id);
          if (current && isUnregistered(current)) {
            current.phase = 'create-error';
            current.errorMessage = message;
          }
        });
        throw e;
      });

    if (!result.success) {
      const message = formatCreateTaskError(result.error, {
        isSshProject: getProjectSshConnectionId(this.projectId) !== undefined,
      });
      runInAction(() => {
        const current = this.tasks.get(params.id);
        if (current && isUnregistered(current)) {
          current.phase = 'create-error';
          current.errorMessage = message;
        }
      });
      throw new Error(message);
    }

    runInAction(() => {
      const current = this.tasks.get(params.id);
      if (current && isUnregistered(current)) {
        current.transitionToUnprovisioned(result.data.task, 'provision');
        // For repository-instance tasks the workspace ID is known at creation time —
        // set it immediately so consumers can reference it before provisioning completes.
        if (
          params.workspaceConfig.workspace.kind === 'repository-instance' &&
          result.data.task.workspaceId
        ) {
          current.workspaceId = result.data.task.workspaceId;
        }
        // Conversation and terminal registries already acquired in the optimistic phase.
      }
    });

    this._settingsStore.pageData.invalidate();

    if (result.data.warning) {
      toast.error(formatCreateTaskWarning(result.data.warning));
    }

    await this.provisionTask(params.id);
  }

  async provisionTask(taskId: string): Promise<void> {
    await getProjectManagerStore().mountProject(this.projectId);
    await this.loadTasks();

    const inFlight = this._provisionPromises.get(taskId);
    if (inFlight) return inFlight;

    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task)) return;

    runInAction(() => {
      task.phase = 'provision';
    });

    const promise = this._doProvision(taskId).finally(() => {
      this._provisionPromises.delete(taskId);
    });

    this._provisionPromises.set(taskId, promise);
    return promise;
  }

  private async _doProvision(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isUnprovisioned(task)) return;

    const wsId = (task.data as Task).workspaceId;

    // Single-phase provision: workspace bootstrap + task provider construction + registration.
    if (wsId) workspaceRegistry.setBootstrapState(this.projectId, wsId, { kind: 'resolving' });
    const result = await rpc.tasks.provisionWorkspace(taskId);
    if (!result.success) {
      const message = formatProvisionWorkspaceError(result.error);
      if (wsId)
        workspaceRegistry.setBootstrapState(this.projectId, wsId, { kind: 'error', message });
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isUnprovisioned(current)) {
          current.phase = 'provision-error';
          current.errorMessage = message;
        }
      });
      return;
    }

    if (wsId) workspaceRegistry.setBootstrapState(this.projectId, wsId, { kind: 'ready' });

    const savedSnapshot = (await viewStateCache.get(`task:${taskId}`)) as
      | TaskViewSnapshot
      | undefined;

    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (current && isUnprovisioned(current)) {
        conversationRegistry.acquire(taskId, this.projectId);
        terminalRegistry.acquire(taskId, this.projectId);
        current.transitionToProvisioned(
          { ...current.data, lastInteractedAt: new Date().toISOString() },
          result.data.path,
          result.data.workspaceId,
          this._repository,
          result.data.sshConnectionId ?? undefined,
          savedSnapshot
        );
        current.activate();
      }
    });
  }

  private async _doHandleProvisioned(
    taskId: string,
    path: string,
    workspaceId: string,
    sshConnectionId?: string
  ): Promise<void> {
    const savedSnapshot = (await viewStateCache.get(`task:${taskId}`)) as
      | TaskViewSnapshot
      | undefined;
    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (current && isUnprovisioned(current)) {
        conversationRegistry.acquire(taskId, this.projectId);
        terminalRegistry.acquire(taskId, this.projectId);
        current.transitionToProvisioned(
          { ...current.data, lastInteractedAt: new Date().toISOString() },
          path,
          workspaceId,
          this._repository,
          sshConnectionId,
          savedSnapshot
        );
        current.activate();
      }
    });
  }

  async teardownTask(taskId: string): Promise<void> {
    const inFlight = this._teardownPromises.get(taskId);
    if (inFlight) return inFlight;

    const task = this.tasks.get(taskId);
    if (!task) return;

    runInAction(() => {
      const current = this.tasks.get(taskId);
      if (!current) return;
      if (isProvisioned(current)) {
        current.transitionToUnprovisioned({ ...current.data }, 'teardown');
      } else if (isUnprovisioned(current)) {
        current.phase = 'teardown';
      }
    });

    const promise = rpc.tasks
      .teardownTask(this.projectId, taskId)
      .then(() => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.phase = 'idle';
          }
        });
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.tasks.get(taskId);
          if (current && isUnprovisioned(current)) {
            current.phase = 'teardown-error';
          }
        });
        throw err;
      })
      .finally(() => {
        this._teardownPromises.delete(taskId);
      });

    this._teardownPromises.set(taskId, promise);
    return promise;
  }

  async setTaskPinned(taskId: string, isPinned: boolean): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    await task.setPinned(isPinned);
  }

  async archiveTask(taskId: string): Promise<void> {
    const currentTask = this.tasks.get(taskId);
    if (!currentTask || !isRegistered(currentTask)) return;
    const previousArchivedAt = currentTask.data.archivedAt;

    try {
      runInAction(() => {
        const task = this.tasks.get(taskId);
        if (task && isRegistered(task)) {
          task.data.archivedAt = new Date().toISOString();
        }
      });
      await rpc.tasks.archiveTask(this.projectId, taskId);
    } catch (e) {
      runInAction(() => {
        const task = this.tasks.get(taskId);
        if (task && isRegistered(task)) {
          task.data.archivedAt = previousArchivedAt;
        }
      });
      throw e;
    }

    this._releaseTaskRegistries(taskId);
    runInAction(() => {
      const task = this.tasks.get(taskId);
      if (task && isRegistered(task)) {
        task.transitionToDryUnprovisioned({ ...task.data }, 'idle');
      }
    });
  }

  async restoreTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !isRegistered(task)) return;
    const archivedAt = task.data.archivedAt;

    try {
      await rpc.tasks.restoreTask(taskId);
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isRegistered(current)) {
          current.data.archivedAt = undefined;
        }
      });
    } catch (e) {
      runInAction(() => {
        const current = this.tasks.get(taskId);
        if (current && isRegistered(current)) {
          current.data.archivedAt = archivedAt;
        }
      });
      throw e;
    }
  }

  async deleteTask(taskId: string, opts?: DeleteTaskOptions): Promise<void> {
    return this.deleteTasks([taskId], opts);
  }

  async deleteTasks(taskIds: string[], opts?: DeleteTaskOptions): Promise<void> {
    const removed = new Map<string, TaskStore>();

    // Optimistic removal empties this.tasks before taskDeleted events arrive,
    // so record confirmations here and skip them during rollback.
    const confirmed = new Set<string>();
    const unsubConfirmations = events.on(taskDeletedChannel, ({ taskId, projectId }) => {
      if (projectId === this.projectId) confirmed.add(taskId);
    });

    runInAction(() => {
      for (const id of taskIds) {
        const t = this.tasks.get(id);
        if (t) {
          removed.set(id, t);
          this.tasks.delete(id);
        }
      }
    });

    try {
      // Release conversation and terminal registries before disposing each task.
      removed.forEach((t, id) => {
        this._releaseTaskRegistries(id);
        t.dispose();
      });
      await rpc.tasks.deleteTasks(this.projectId, taskIds, opts);
      for (const id of taskIds) {
        snapshotRegistry.evict(`task:${id}`);
        snapshotRegistry.evict(`task:${id}:tabs`);
      }
    } catch (e) {
      runInAction(() => {
        removed.forEach((t, id) => {
          if (!confirmed.has(id)) this.tasks.set(id, t);
        });
      });
      toast.error(`Could not delete ${taskIds.length === 1 ? 'task' : 'tasks'}`, {
        description: formatErrorMessage(e),
      });
      throw e;
    } finally {
      unsubConfirmations();
    }
  }

  dispose(): void {
    this._unsubTaskCreated?.();
    this._unsubTaskCreated = null;
    this._unsubTaskDeleted?.();
    this._unsubTaskDeleted = null;
    this._unsubPrUpdated?.();
    this._unsubPrUpdated = null;
    this._unsubPrSyncProgress?.();
    this._unsubPrSyncProgress = null;
    this._unsubGitWorktreeUpdate?.();
    this._unsubGitWorktreeUpdate = null;
    this._unsubProvisionProgress?.();
    this._unsubProvisionProgress = null;
    this._unsubStatusUpdated?.();
    this._unsubStatusUpdated = null;
    this._unsubLifecycleScriptStatus?.();
    this._unsubLifecycleScriptStatus = null;
    this._unsubProvisioned?.();
    this._unsubProvisioned = null;
    this._disposeRepositoryReaction?.();
    this._disposeRepositoryReaction = null;
  }
}
