import type { GitChange } from '@emdash/shared/git';
import { makeAutoObservable } from 'mobx';
import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { commitRef, mergeBaseRange } from '@shared/core/git/git';
import { gitRepoUpdateChannel, gitWorktreeUpdateChannel } from '@shared/core/git/gitEvents';
import {
  isForkPr,
  pullRequestErrorMessage,
  selectCurrentPr,
  type PullRequest,
  type PullRequestMergeOptions,
} from '@shared/core/pull-requests/pull-requests';
import type { Task } from '@shared/core/tasks/tasks';
import { isRegistered, type TaskStore } from './task-store';

export type MergeResult = { success: true } | { success: false; error: string };

/** Extract the numeric PR number from the identifier field (e.g. "#123" → 123). */
function prNumberFromIdentifier(identifier: string | null): number | null {
  if (!identifier) return null;
  const n = Number.parseInt(identifier.replace('#', ''), 10);
  return Number.isNaN(n) ? null : n;
}

export class PrStore {
  private readonly _prFiles = new Map<
    string,
    { resource: Resource<GitChange[]>; baseRefOid: string; headRefOid: string }
  >();

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly gitRepositoryStore: GitRepositoryStore,
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
            subscribe: (handler) => {
              const unsubHead = events.on(gitWorktreeUpdateChannel, (p) => {
                if (p.workspaceId === this.workspaceId && p.update.kind === 'head') handler();
              });
              const unsubRefs = events.on(gitRepoUpdateChannel, (p) => {
                if (p.projectId === this.projectId && p.update.kind === 'refs') handler();
              });
              return () => {
                unsubHead();
                unsubRefs();
              };
            },
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

    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (!prNumber) return { success: false, error: 'Could not determine PR number' };

    const result = await rpc.pullRequests.mergePullRequest(
      this.projectId,
      pr.repositoryUrl,
      prNumber,
      options
    );
    if (result.success) {
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
    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (!prNumber) return;
    await rpc.pullRequests.markReadyForReview(this.projectId, pr.repositoryUrl, prNumber);
  }

  /**
   * Trigger a single PR refresh from GitHub. The updated PR will arrive via
   * `prUpdatedChannel` and be merged into `task.data.prs` by `TaskManagerStore`.
   */
  refresh(id: string): void {
    const pr = this.pullRequests.find((p) => p.url === id);
    if (!pr) return;

    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (prNumber) {
      void rpc.pullRequests.refreshPullRequest(this.projectId, pr.repositoryUrl, prNumber);
    }

    // Also trigger a check-run sync — the result arrives embedded in the
    // next prUpdatedChannel event emitted by syncChecks.
    void rpc.pullRequests.syncChecks(this.projectId, pr.url, pr.headRefOid);
  }

  dispose(): void {
    for (const entry of this._prFiles.values()) entry.resource.dispose();
  }

  private async _fetchPrFiles(pr: PullRequest): Promise<GitChange[]> {
    const baseRef = commitRef(pr.baseRefOid);
    const headRef = commitRef(pr.headRefOid);
    const range = mergeBaseRange(baseRef, headRef);

    const tryRange = async (): Promise<GitChange[] | null> => {
      const result = await rpc.workspace.gitWorktree.getChangedFiles(
        this.projectId,
        this.workspaceId,
        range
      );
      if (!result.success) return null;
      const changes = result.data.changes;
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

    await rpc.gitRepository.fetch(this.projectId, this.workspaceId);
    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (prNumber) {
      await rpc.gitRepository.fetchPrForReview(
        this.projectId,
        prNumber,
        pr.headRefName,
        pr.headRepositoryUrl,
        isForkPr(pr)
      );
    }

    const retry = await tryRange();
    return retry ?? [];
  }
}
