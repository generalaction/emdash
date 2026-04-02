import { reaction, runInAction } from 'mobx';
import type { GitChange } from '@shared/git';
import type { PrCheckRun, PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/core/ipc';
import type { PrComment } from '@renderer/lib/github/types';
import type { GitStore } from './git';
import { Resource } from './resource';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrListData {
  prs: PullRequest[];
  nameWithOwner: string | null;
  taskBranch: string | null;
}

type MergeMode = 'merge' | 'squash' | 'rebase';
export type MergeResult = { success: true } | { success: false; error: string };

// ---------------------------------------------------------------------------
// PrStore
// ---------------------------------------------------------------------------

/**
 * Owns all pull-request related server state for a single task.
 * Replaces the `PrProvider` React context bridge.
 *
 * - `prList` is always active (starts when the task activates).
 * - Per-PR resources (`getFiles`, `getCheckRuns`, `getComments`) are lazy:
 *   they are created on first access and only poll while observed (demandGated).
 * - `commitHistory` provides the task's git log (demand-loaded, used by the
 *   PR commits list to show ahead-of-upstream commits).
 */
export class PrStore {
  readonly prList: Resource<PrListData>;
  readonly commitHistory: Resource<{ commits: import('@shared/git').Commit[]; aheadCount: number }>;

  private _prFiles = new Map<string, Resource<GitChange[]>>();
  private _prCheckRuns = new Map<string, Resource<PrCheckRun[]>>();
  private _prComments = new Map<string, Resource<PrComment[]>>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    private readonly git: GitStore
  ) {
    this.prList = new Resource<PrListData>(
      () => this._fetchPrList(),
      [
        { kind: 'poll', intervalMs: 60_000, pauseWhenHidden: true, demandGated: true },
        // Invalidate whenever git status reloads (same trigger as old PrProvider).
        {
          kind: 'event',
          subscribe: (h) => reaction(() => git.status.data, h),
          onEvent: 'reload',
        },
      ]
    );

    this.commitHistory = new Resource(() => this._fetchCommitHistory(), [{ kind: 'demand' }]);
  }

  // ---------------------------------------------------------------------------
  // Forwarded accessors — drop-in replacements for PrProvider consumers
  // ---------------------------------------------------------------------------

  get pullRequests(): PullRequest[] {
    return this.prList.data?.prs ?? [];
  }

  get nameWithOwner(): string | null {
    return this.prList.data?.nameWithOwner ?? null;
  }

  get taskBranch(): string | null {
    return this.prList.data?.taskBranch ?? null;
  }

  // ---------------------------------------------------------------------------
  // Lazy per-PR resource accessors
  // ---------------------------------------------------------------------------

  /** Files changed between the PR's base ref and HEAD. Demand-gated 60s poll. */
  getFiles(pr: PullRequest): Resource<GitChange[]> {
    const key = pr.metadata.baseRefName;
    if (!this._prFiles.has(key)) {
      const resource = new Resource<GitChange[]>(
        () => this._fetchPrFiles(pr.metadata.baseRefName),
        [
          { kind: 'poll', intervalMs: 60_000, pauseWhenHidden: true, demandGated: true },
          {
            kind: 'event',
            subscribe: (h) => reaction(() => this.git.status.data, h),
            onEvent: 'reload',
          },
        ]
      );
      this._prFiles.set(key, resource);
    }
    return this._prFiles.get(key)!;
  }

  /**
   * Check runs for a PR. Demand-gated 15s poll (fast enough to catch pending→complete
   * transitions without a timer for every open task).
   */
  getCheckRuns(pr: PullRequest): Resource<PrCheckRun[]> {
    const key = `${pr.nameWithOwner}:${pr.metadata.number}`;
    if (!this._prCheckRuns.has(key)) {
      const resource = new Resource<PrCheckRun[]>(
        () => this._fetchCheckRuns(pr.nameWithOwner, pr.metadata.number),
        [{ kind: 'poll', intervalMs: 15_000, pauseWhenHidden: true, demandGated: true }]
      );
      this._prCheckRuns.set(key, resource);
    }
    return this._prCheckRuns.get(key)!;
  }

  /** Comments and reviews for a PR. Demand-gated 60s poll. */
  getComments(pr: PullRequest): Resource<PrComment[]> {
    const key = `${pr.nameWithOwner}:${pr.metadata.number}`;
    if (!this._prComments.has(key)) {
      const resource = new Resource<PrComment[]>(
        () => this._fetchComments(pr.nameWithOwner, pr.metadata.number),
        [{ kind: 'poll', intervalMs: 60_000, pauseWhenHidden: true, demandGated: true }]
      );
      this._prComments.set(key, resource);
    }
    return this._prComments.get(key)!;
  }

  // ---------------------------------------------------------------------------
  // Actions — colocated with the mutations they trigger
  // ---------------------------------------------------------------------------

  async mergePr(
    id: string,
    options: { strategy: MergeMode; commitHeadOid?: string }
  ): Promise<MergeResult> {
    const pr = this.pullRequests.find((p) => p.id === id);
    if (!pr) return { success: false, error: 'Pull request not found' };
    const result = await rpc.pullRequests.mergePullRequest(
      pr.nameWithOwner,
      pr.metadata.number,
      options
    );
    if (result.success) {
      this.prList.invalidate();
    }
    return result.success
      ? { success: true }
      : { success: false, error: result.error ?? 'Merge failed' };
  }

  async markReadyForReview(id: string): Promise<void> {
    const pr = this.pullRequests.find((p) => p.id === id);
    if (!pr) return;
    await rpc.pullRequests.markReadyForReview(pr.nameWithOwner, pr.metadata.number);
    this.prList.invalidate();
  }

  async addComment(pr: PullRequest, body: string): Promise<void> {
    const result = await rpc.pullRequests.addPrComment(pr.nameWithOwner, pr.metadata.number, body);
    if (result.success) {
      this.getComments(pr).invalidate();
    }
  }

  /**
   * Force-refresh the PR list and the check-run state for the given PR id.
   * Called from the UI's "Refresh" button on a stale PR.
   */
  refresh(id: string): void {
    this.prList.invalidate();
    const pr = this.pullRequests.find((p) => p.id === id);
    if (pr) {
      const checkRunsKey = `${pr.nameWithOwner}:${pr.metadata.number}`;
      this._prCheckRuns.get(checkRunsKey)?.invalidate();
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Activate always-on strategies. Call from TaskStore.activate(). */
  start(): void {
    this.prList.start();
  }

  dispose(): void {
    this.prList.dispose();
    this.commitHistory.dispose();
    for (const r of this._prFiles.values()) r.dispose();
    for (const r of this._prCheckRuns.values()) r.dispose();
    for (const r of this._prComments.values()) r.dispose();
  }

  // ---------------------------------------------------------------------------
  // Private fetch helpers
  // ---------------------------------------------------------------------------

  private async _fetchPrList(): Promise<PrListData> {
    const result = await rpc.pullRequests.getPullRequestsForTask(this.projectId, this.taskId);
    if (!result.success) return { prs: [], nameWithOwner: null, taskBranch: null };
    return result.data;
  }

  private async _fetchPrFiles(baseRefName: string): Promise<GitChange[]> {
    const result = await rpc.git.getChangedFiles(this.projectId, this.taskId, baseRefName);
    return result.success ? result.data.changes : [];
  }

  private async _fetchCheckRuns(nameWithOwner: string, prNumber: number): Promise<PrCheckRun[]> {
    const result = await rpc.pullRequests.getCheckRuns(nameWithOwner, prNumber);
    if (!result.success) throw new Error(result.error ?? 'Failed to fetch check runs');
    return result.checks as PrCheckRun[];
  }

  private async _fetchComments(nameWithOwner: string, prNumber: number): Promise<PrComment[]> {
    const result = await rpc.pullRequests.getPrComments(nameWithOwner, prNumber);
    if (!result.success) throw new Error(result.error ?? 'Failed to fetch comments');
    const comments = 'comments' in result ? result.comments : [];
    const reviews = 'reviews' in result ? result.reviews : [];
    return _mergeAndSortComments(comments ?? [], reviews ?? []);
  }

  private async _fetchCommitHistory(): Promise<{
    commits: import('@shared/git').Commit[];
    aheadCount: number;
  }> {
    const result = await rpc.git.getLog(this.projectId, this.taskId);
    if (!result.success) return { commits: [], aheadCount: 0 };
    return result.data;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function _mergeAndSortComments(
  rawComments: Array<{
    id: number;
    author: { login: string; avatarUrl?: string };
    body: string;
    createdAt: string;
  }>,
  rawReviews: Array<{
    id: number;
    author: { login: string; avatarUrl?: string };
    body: string;
    submittedAt?: string;
    state: string;
  }>
): PrComment[] {
  const comments: PrComment[] = rawComments.map((c) => ({
    id: String(c.id),
    author: c.author,
    body: c.body,
    createdAt: c.createdAt,
    type: 'comment' as const,
  }));

  const reviews: PrComment[] = rawReviews
    .filter((r) => r.body || r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
    .map((r) => ({
      id: String(r.id),
      author: r.author,
      body: r.body,
      createdAt: r.submittedAt ?? '',
      type: 'review' as const,
      reviewState: r.state as PrComment['reviewState'],
    }));

  const toMillis = (dateStr: string): number => {
    const ms = new Date(dateStr).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  };

  return [...comments, ...reviews].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
}
