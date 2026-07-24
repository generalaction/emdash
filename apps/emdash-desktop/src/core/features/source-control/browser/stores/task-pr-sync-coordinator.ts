import { createLiveModelReplica } from '@emdash/wire';
import { OptimisticLiveModel } from '@emdash/wire/util/mobx';
import { reaction, runInAction } from 'mobx';
import type { GitRepositoryStore } from '@core/features/source-control/api/browser/stores/git-repository-store';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import type { TaskManagerStore } from '@core/features/tasks/api/browser/stores/task-manager';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';
import type { Task } from '@core/primitives/tasks/api';
import { getPullRequestsRuntimeClient } from '@renderer/lib/runtime/pull-requests-client';
import { pullRequestsContract } from '@root/src/core/services/pull-requests/api';

export class TaskPrSyncCoordinator {
  private model: OptimisticLiveModel<typeof pullRequestsContract.syncState> | null = null;
  private disposeSyncReaction: (() => void) | null = null;
  private generation = 0;
  private readonly disposeGitHeadReaction: () => void;
  private readonly disposeRepositoryReaction: () => void;

  constructor(
    private readonly tasks: TaskManagerStore,
    private readonly repository: GitRepositoryStore
  ) {
    this.disposeGitHeadReaction = reaction(
      () =>
        [...tasks.tasks.values()].filter(isRegistered).map((store) => {
          const git = getTaskGitCheckoutStore(store);
          return `${store.workspaceId}:${git?.branchName ?? ''}:${git?.headOid ?? ''}`;
        }),
      () => this.reloadAll()
    );
    this.disposeRepositoryReaction = reaction(
      () => repository.pullRequestRepositoryUrl,
      (repositoryUrl) => {
        void this.watchSync(repositoryUrl);
        this.reloadAll();
      },
      { fireImmediately: true }
    );
  }

  dispose(): void {
    this.generation++;
    this.disposeSyncReaction?.();
    this.disposeSyncReaction = null;
    if (this.model) void this.model.dispose();
    this.model = null;
    this.disposeGitHeadReaction();
    this.disposeRepositoryReaction();
  }

  private reloadAll(): void {
    for (const store of this.tasks.tasks.values()) {
      if (isRegistered(store)) void this.reloadTask(store);
    }
  }

  private async reloadTask(store: TaskStore): Promise<void> {
    if (!isRegistered(store)) return;
    const repositoryUrl = this.repository.pullRequestRepositoryUrl;
    const branch = getTaskGitCheckoutStore(store)?.branchName;
    if (!repositoryUrl || !branch) return;
    const result = await (
      await getPullRequestsRuntimeClient()
    ).getPullRequestsForBranch({
      repositoryUrl,
      branch,
    });
    if (!result.success) return;
    if (
      this.repository.pullRequestRepositoryUrl !== repositoryUrl ||
      getTaskGitCheckoutStore(store)?.branchName !== branch
    ) {
      return;
    }
    runInAction(() => {
      if (isRegistered(store)) (store.data as Task).prs = result.data.prs;
    });
  }

  private async watchSync(repositoryUrl: string | null): Promise<void> {
    const generation = ++this.generation;
    this.disposeSyncReaction?.();
    this.disposeSyncReaction = null;
    if (this.model) {
      void this.model.dispose();
      this.model = null;
    }
    if (!repositoryUrl) return;

    const client = await getPullRequestsRuntimeClient();
    if (generation !== this.generation) return;
    const replica = createLiveModelReplica(pullRequestsContract.syncState, client.syncState);
    const model = new OptimisticLiveModel(
      pullRequestsContract.syncState,
      { repositoryUrl },
      replica
    );
    this.model = model;
    let previousLastSyncedAt: number | undefined;
    this.disposeSyncReaction = reaction(
      () => model.values.state,
      (state) => {
        if (
          state?.phase !== 'idle' ||
          state.lastSyncedAt === undefined ||
          state.lastSyncedAt === previousLastSyncedAt
        ) {
          return;
        }
        previousLastSyncedAt = state.lastSyncedAt;
        this.reloadAll();
      }
    );
    try {
      await model.ready;
    } catch {
      if (this.model === model) {
        this.disposeSyncReaction?.();
        this.disposeSyncReaction = null;
        this.model = null;
      }
      await model.dispose();
    }
  }
}

function getTaskGitCheckoutStore(store: TaskStore) {
  return store.workspaceId
    ? workspaceRegistry.get(store.workspaceId)?.get(gitCheckoutStoreToken)
    : undefined;
}

function isRegistered(store: TaskStore): boolean {
  return store.state !== 'unregistered';
}
