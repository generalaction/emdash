import { gitRefChangedChannel, gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import {
  commitRef,
  mergeBaseRange,
  refsEqual,
  remoteRef,
  type Commit,
  type GitChange,
  type GitObjectRef,
} from '@shared/git';
import { selectCurrentPr, type PrCheckRun, type PullRequest } from '@shared/pull-requests';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import type { PrComment } from '@renderer/utils/github/types';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

type MergeMode = 'merge' | 'squash' | 'rebase';
export type MergeResult = { success: true } | { success: false; error: string };

export class PrStore {
  readonly commitHistory: Resource<{ commits: Commit[]; aheadCount: number }>;

  private _prFiles = new Map<string, Resource<GitChange[]>>();
  private _prCheckRuns = new Map<string, Resource<PrCheckRun[]>>();
  private _prComments = new Map<string, Resource<PrComment[]>>();

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly repositoryStore: RepositoryStore,
    private readonly getPrs: () => PullRequest[]
  ) {
    this.commitHistory = new Resource(
      () => this._fetchCommitHistory(),
      [
        { kind: 'demand' },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitWorkspaceChangedChannel, (p) => {
              if (p.workspaceId === workspaceId && p.kind === 'head') handler();
            }),
          onEvent: 'reload',
          debounceMs: 300,
        },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitRefChangedChannel, (p) => {
              if (p.projectId === projectId && p.kind === 'remote-refs') handler();
            }),
          onEvent: 'reload',
          debounceMs: 500,
        },
      ]
    );
    this.commitHistory.start();
  }

  get pullRequests(): PullRequest[] {
    return this.getPrs();
  }

  get currentPr(): PullRequest | undefined {
    return selectCurrentPr(this.getPrs());
  }

  getFiles(pr: PullRequest): Resource<GitChange[]> {
    const key = String(pr.metadata.number);
    if (!this._prFiles.has(key)) {
      const resource = new Resource<GitChange[]>(
        () => this._fetchPrFiles(pr.metadata.baseRefName, pr.metadata.changedFiles),
        [
          { kind: 'poll', intervalMs: 60_000, pauseWhenHidden: true, demandGated: true },
          {
            kind: 'event',
            subscribe: (handler) => {
              const unsubHead = events.on(gitWorkspaceChangedChannel, (p) => {
                if (p.workspaceId === this.workspaceId && p.kind === 'head') handler();
              });
              const unsubRemote = events.on(gitRefChangedChannel, (p) => {
                if (p.projectId !== this.projectId || p.kind !== 'remote-refs') return;
                const baseRef = remoteRef(
                  this.repositoryStore.configuredRemote,
                  pr.metadata.baseRefName
                );
                const relevant = !p.changedRefs || p.changedRefs.some((r) => refsEqual(r, baseRef));
                if (relevant) handler();
              });
              return () => {
                unsubHead();
                unsubRemote();
              };
            },
            onEvent: 'reload',
            debounceMs: 500,
          },
        ]
      );
      resource.start();
      this._prFiles.set(key, resource);
    }
    return this._prFiles.get(key)!;
  }

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

  async mergePr(
    id: string,
    options: { strategy: MergeMode; commitHeadOid?: string }
  ): Promise<MergeResult> {
    const pr = this.getPrs().find((p) => p.id === id);
    if (!pr) {
      captureTelemetry('pr_merged', {
        strategy: options.strategy,
        success: false,
        error_type: 'pr_not_found',
        project_id: this.projectId,
        task_id: this.workspaceId,
      });
      return { success: false, error: 'Pull request not found' };
    }

    const result = await rpc.pullRequests.mergePullRequest(
      pr.nameWithOwner,
      pr.metadata.number,
      options
    );
    if (result.success) {
      captureTelemetry('pr_merged', {
        strategy: options.strategy,
        success: true,
        project_id: this.projectId,
        task_id: this.workspaceId,
      });
      return { success: true };
    }

    captureTelemetry('pr_merged', {
      strategy: options.strategy,
      success: false,
      error_type: 'merge_failed',
      project_id: this.projectId,
      task_id: this.workspaceId,
    });
    return { success: false, error: result.error ?? 'Merge failed' };
  }

  async markReadyForReview(id: string): Promise<void> {
    const pr = this.getPrs().find((p) => p.id === id);
    if (!pr) return;
    await rpc.pullRequests.markReadyForReview(pr.nameWithOwner, pr.metadata.number);
  }

  async addComment(pr: PullRequest, body: string): Promise<void> {
    const result = await rpc.pullRequests.addPrComment(pr.nameWithOwner, pr.metadata.number, body);
    if (result.success) {
      this.getComments(pr).invalidate();
    }
  }

  refresh(id: string): void {
    const pr = this.getPrs().find((p) => p.id === id);
    if (pr) {
      const checkRunsKey = `${pr.nameWithOwner}:${pr.metadata.number}`;
      this._prCheckRuns.get(checkRunsKey)?.invalidate();

      void rpc.pullRequests.getPullRequest(pr.nameWithOwner, pr.metadata.number, true);
    }
  }

  dispose(): void {
    this.commitHistory.dispose();
    for (const r of this._prFiles.values()) r.dispose();
    for (const r of this._prCheckRuns.values()) r.dispose();
    for (const r of this._prComments.values()) r.dispose();
  }

  private async _fetchPrFiles(
    baseRefName: string,
    expectedChangedFiles: number
  ): Promise<GitChange[]> {
    const remote = this.repositoryStore.configuredRemote;
    const baseRef = remoteRef(remote, baseRefName);
    const headRef = commitRef('HEAD');
    const range = mergeBaseRange(baseRef, headRef);

    const tryRange = async (): Promise<GitChange[] | null> => {
      const result = await rpc.git.getChangedFiles(this.projectId, this.workspaceId, range);
      if (!result.success) return null;
      const changes = result.data.changes;
      // Return null (trigger fetch+retry) when:
      //   - result is empty but API says there should be changes (stale base)
      //   - result is larger than expected (stale base includes extra diverged commits)
      if (expectedChangedFiles > 0 && changes.length === 0) return null;
      if (expectedChangedFiles > 0 && changes.length > expectedChangedFiles * 2) return null;
      return changes;
    };

    const first = await tryRange();
    if (first) return first;

    return (await tryRange()) ?? [];
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
    commits: Commit[];
    aheadCount: number;
  }> {
    const remote = this.repositoryStore.configuredRemote;
    const currentPr = selectCurrentPr(this.getPrs());
    // When a PR is open, compute aheadCount relative to the PR's base branch so
    // the commit list matches what GitHub shows rather than @{upstream}.
    const base: GitObjectRef | undefined = currentPr
      ? remoteRef(remote, currentPr.metadata.baseRefName)
      : undefined;
    const result = await rpc.git.getLog(
      this.projectId,
      this.workspaceId,
      undefined,
      undefined,
      undefined,
      remote.name,
      base
    );
    if (!result.success) return { commits: [], aheadCount: 0 };
    return result.data;
  }
}

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
