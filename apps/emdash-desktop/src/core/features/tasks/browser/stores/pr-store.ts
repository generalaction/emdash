import { normalizeDiffTarget, type GitChange } from '@emdash/core/runtimes/git/api';
import { makeAutoObservable, reaction, runInAction } from 'mobx';
import type { GitRepositoryStore } from '@core/features/projects/browser/stores/git-repository-store';
import { commitRef, mergeBaseRange } from '@core/primitives/git/api';
import type { Task } from '@core/primitives/tasks/api';
import { checkoutSelector } from '@renderer/lib/runtime/git';
import { getGitRuntimeClient } from '@renderer/lib/runtime/git-client';
import { getPullRequestsRuntimeClient } from '@renderer/lib/runtime/pull-requests-client';
import { Resource } from '@renderer/lib/stores/resource';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import {
  getPrNumber,
  isForkPr,
  pullRequestErrorMessage,
  selectCurrentPr,
  type PullRequest,
  type PullRequestMergeOptions,
} from '@root/src/core/services/pull-requests/api';
import type { GitCheckoutStore } from './git-checkout-store';
import { isRegistered, type TaskStore } from './task-store';

export type MergeResult = { success: true } | { success: false; error: string };

export class PrStore {
  private readonly _prFiles = new Map<
    string,
    { resource: Resource<GitChange[]>; baseRefOid: string; headRefOid: string }
  >();

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly gitRepositoryStore: GitRepositoryStore,
    private readonly gitCheckoutStore: GitCheckoutStore,
    private readonly taskStore: TaskStore
  ) {
    makeAutoObservable(this);
  }

  get pullRequests(): PullRequest[] {
    if (!isRegistered(this.taskStore)) return [];
    return (this.taskStore.data as Task).prs ?? [];
  }

  get currentPr(): PullRequest | undefined {
    return selectCurrentPr(this.pullRequests);
  }

  getFiles(pr: PullRequest): Resource<GitChange[]> {
    const key = pr.url;
    const existing = this._prFiles.get(key);
    if (
      existing &&
      (existing.baseRefOid !== pr.baseRefOid || existing.headRefOid !== pr.headRefOid)
    ) {
      existing.resource.dispose();
      this._prFiles.delete(key);
    }
    if (!this._prFiles.has(key)) {
      const resource = new Resource<GitChange[]>(
        () => this._fetchPrFiles(pr),
        [
          { kind: 'poll', intervalMs: 60_000, pauseWhenHidden: true, demandGated: true },
          {
            kind: 'event',
            subscribe: (handler) =>
              reaction(
                () => [
                  this.gitCheckoutStore.headOid,
                  this.gitCheckoutStore.branchName,
                  this.gitRepositoryStore.branches.map((branch) => branch.oid).join(':'),
                ],
                () => handler()
              ),
            onEvent: 'reload',
            debounceMs: 500,
          },
        ]
      );
      resource.start();
      this._prFiles.set(key, {
        resource,
        baseRefOid: pr.baseRefOid,
        headRefOid: pr.headRefOid,
      });
    }
    return this._prFiles.get(key)!.resource;
  }

  async mergePr(id: string, options: PullRequestMergeOptions): Promise<MergeResult> {
    const pr = this.pullRequests.find((p) => p.url === id);
    if (!pr) {
      captureTelemetry('pr_merged', {
        strategy: options.strategy,
        bypass_requirements: options.bypassRequirements ?? false,
        success: false,
        error_type: 'pr_not_found',
        project_id: this.projectId,
        task_id: this.workspaceId,
      });
      return { success: false, error: 'Pull request not found' };
    }

    const prNumber = getPrNumber(pr);
    if (!prNumber) return { success: false, error: 'Could not determine PR number' };

    const client = await getPullRequestsRuntimeClient();
    const result = await client.mergePullRequest({
      repositoryUrl: pr.repositoryUrl,
      number: prNumber,
      options,
    });
    if (result.success) {
      await this._refreshPr(pr, client);
      captureTelemetry('pr_merged', {
        strategy: options.strategy,
        bypass_requirements: options.bypassRequirements ?? false,
        success: true,
        project_id: this.projectId,
        task_id: this.workspaceId,
      });
      return { success: true };
    }

    captureTelemetry('pr_merged', {
      strategy: options.strategy,
      bypass_requirements: options.bypassRequirements ?? false,
      success: false,
      error_type: 'merge_failed',
      project_id: this.projectId,
      task_id: this.workspaceId,
    });
    return { success: false, error: pullRequestErrorMessage(result.error) };
  }

  async markReadyForReview(id: string): Promise<void> {
    const pr = this.pullRequests.find((p) => p.url === id);
    if (!pr) return;
    const prNumber = getPrNumber(pr);
    if (!prNumber) return;
    const client = await getPullRequestsRuntimeClient();
    const result = await client.markReadyForReview({
      repositoryUrl: pr.repositoryUrl,
      number: prNumber,
    });
    if (result.success) await this._refreshPr(pr, client);
  }

  /** Refresh the pull request and its check runs from GitHub. */
  refresh(id: string): void {
    const pr = this.pullRequests.find((p) => p.url === id);
    if (!pr) return;

    const prNumber = getPrNumber(pr);
    if (prNumber) {
      void getPullRequestsRuntimeClient()
        .then(async (client) => {
          await this._refreshPr(pr, client);
          await client.syncChecks({
            repositoryUrl: pr.repositoryUrl,
            pullRequestUrl: pr.url,
            headRefOid: pr.headRefOid,
          });
          await this._refreshPr(pr, client);
        })
        .catch(() => {});
    }
  }

  dispose(): void {
    for (const entry of this._prFiles.values()) entry.resource.dispose();
  }

  private async _fetchPrFiles(pr: PullRequest): Promise<GitChange[]> {
    const baseRef = commitRef(pr.baseRefOid);
    const headRef = commitRef(pr.headRefOid);
    const range = mergeBaseRange(baseRef, headRef);

    const tryRange = async (): Promise<GitChange[] | null> => {
      const client = await getGitRuntimeClient();
      const result = await client.checkout.getChangedFiles({
        ...checkoutSelector(this.gitCheckoutStore.workspacePath),
        target: normalizeDiffTarget(range),
      });
      if (!result.success) return null;
      const changes = result.data;
      const expectedChangedFiles = pr.changedFiles;
      if (changes.length === 0 && expectedChangedFiles !== 0) return null;
      if (
        expectedChangedFiles != null &&
        expectedChangedFiles > 0 &&
        changes.length > expectedChangedFiles * 2
      ) {
        return null;
      }
      return changes;
    };

    const first = await tryRange();
    if (first) return first;

    await this.gitRepositoryStore.fetchRemote();
    const prNumber = getPrNumber(pr);
    if (prNumber) {
      await this.gitRepositoryStore.fetchPrForReview({
        prNumber,
        headRefName: pr.headRefName,
        headRepositoryUrl: pr.headRepositoryUrl,
        localBranch: pr.headRefName,
        isFork: isForkPr(pr),
        configuredRemote: this.gitRepositoryStore.baseRemote.name,
      });
    }

    const retry = await tryRange();
    return retry ?? [];
  }

  private async _refreshPr(
    pullRequest: PullRequest,
    client: Awaited<ReturnType<typeof getPullRequestsRuntimeClient>>
  ): Promise<void> {
    const number = getPrNumber(pullRequest);
    if (!number) return;
    const result = await client.syncSingle({
      repositoryUrl: pullRequest.repositoryUrl,
      number,
    });
    if (!result.success || !isRegistered(this.taskStore)) return;
    runInAction(() => {
      if (!isRegistered(this.taskStore)) return;
      const task = this.taskStore.data as Task;
      const index = task.prs.findIndex((candidate) => candidate.url === result.data.pr.url);
      if (index >= 0) task.prs.splice(index, 1, result.data.pr);
      else task.prs.push(result.data.pr);
    });
  }
}
