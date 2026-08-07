import { createScope, type Scope } from '@emdash/shared/concurrency';
import { observe, remote, type RemoteModel } from '@emdash/wire/state';
import { reaction, runInAction } from 'mobx';
import type { GitRepositoryStore } from '@core/features/source-control/api/browser/stores/git-repository-store';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import type { TaskManagerStore } from '@core/features/tasks/api/browser/stores/task-manager';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';
import type { Task } from '@core/primitives/tasks/api';
import { pullRequestsContract } from '@core/services/pull-requests/api';
import { getPullRequestsRuntimeClient } from '@core/services/pull-requests/api/client';

export class TaskPrSyncCoordinator {
  private readonly scope = createScope({ label: 'task-pr-sync-coordinator' });
  private syncScope: Scope | null = null;
  private syncRemotePromise: Promise<RemoteModel<typeof pullRequestsContract.syncState>> | null =
    null;
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
    void this.syncScope?.dispose();
    this.syncScope = null;
    void this.scope.dispose();
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
    void this.syncScope?.dispose();
    this.syncScope = null;
    if (!repositoryUrl) return;

    const syncRemote = await this.getSyncRemote();
    if (generation !== this.generation) return;
    const syncScope = this.scope.child(`sync:${repositoryUrl}`);
    this.syncScope = syncScope;
    let previousLastSyncedAt: number | undefined;
    const member = syncRemote({ repositoryUrl });
    observe(
      member.states.state,
      (state) => {
        const value = state.value;
        if (
          value?.phase !== 'idle' ||
          value.lastSyncedAt === undefined ||
          value.lastSyncedAt === previousLastSyncedAt
        ) {
          return;
        }
        previousLastSyncedAt = value.lastSyncedAt;
        this.reloadAll();
      },
      { scope: syncScope }
    );
  }

  private getSyncRemote(): Promise<RemoteModel<typeof pullRequestsContract.syncState>> {
    this.syncRemotePromise ??= getPullRequestsRuntimeClient().then((client) =>
      remote(pullRequestsContract.syncState, client.syncState, {
        scope: this.scope,
        lingerMs: 15_000,
      })
    );
    return this.syncRemotePromise;
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
