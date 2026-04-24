import { makeAutoObservable, type IObservableArray } from 'mobx';
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
import { isForkPr, ownerFromUrl, selectCurrentPr, type PullRequest } from '@shared/pull-requests';
import type { Task } from '@shared/tasks';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { isRegistered, type TaskStore } from './task';

type MergeMode = 'merge' | 'squash' | 'rebase';
export type MergeResult = { success: true } | { success: false; error: string };

/** Extract the numeric PR number from the identifier field (e.g. "#123" → 123). */
function prNumberFromIdentifier(identifier: string | null): number | null {
  if (!identifier) return null;
  const n = Number.parseInt(identifier.replace('#', ''), 10);
  return Number.isNaN(n) ? null : n;
}

export class PrStore {
  readonly commitHistory: Resource<{ commits: Commit[]; aheadCount: number }>;

  private readonly _prFiles = new Map<
    string,
    { resource: Resource<GitChange[]>; headRefOid: string }
  >();

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly repositoryStore: RepositoryStore,
    private readonly tasks: IObservableArray<TaskStore>
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

    makeAutoObservable(this, {
      commitHistory: false,
    });
  }

  get pullRequests(): PullRequest[] {
    const task = this.tasks[0];
    if (!task || !isRegistered(task)) return [];
    return (task.data as Task).prs ?? [];
  }

  get currentPr(): PullRequest | undefined {
    return selectCurrentPr(this.pullRequests);
  }

  getFiles(pr: PullRequest): Resource<GitChange[]> {
    const key = pr.url;
    const existing = this._prFiles.get(key);
    if (existing && existing.headRefOid !== pr.headRefOid) {
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
              const unsubHead = events.on(gitWorkspaceChangedChannel, (p) => {
                if (p.workspaceId === this.workspaceId && p.kind === 'head') handler();
              });
              const unsubBaseRef = events.on(gitRefChangedChannel, (p) => {
                if (p.projectId !== this.projectId || p.kind !== 'remote-refs') return;
                const baseRef = remoteRef(this.repositoryStore.configuredRemote, pr.baseRefName);
                const relevant = !p.changedRefs || p.changedRefs.some((r) => refsEqual(r, baseRef));
                if (relevant) handler();
              });
              const unsubPrHead = events.on(gitRefChangedChannel, (p) => {
                if (p.projectId !== this.projectId || p.kind !== 'remote-refs') return;
                const sameRepoRef = remoteRef(
                  this.repositoryStore.configuredRemote,
                  pr.headRefName
                );
                const forkOwner = isForkPr(pr)
                  ? (ownerFromUrl(pr.headRepositoryUrl) ?? null)
                  : null;
                const forkRef = forkOwner ? remoteRef(forkOwner, pr.headRefName) : null;
                const relevant =
                  !p.changedRefs ||
                  p.changedRefs.some(
                    (r) => refsEqual(r, sameRepoRef) || (forkRef != null && refsEqual(r, forkRef))
                  );
                if (relevant) handler();
              });
              return () => {
                unsubHead();
                unsubBaseRef();
                unsubPrHead();
              };
            },
            onEvent: 'reload',
            debounceMs: 500,
          },
        ]
      );
      resource.start();
      this._prFiles.set(key, { resource, headRefOid: pr.headRefOid });
    }
    return this._prFiles.get(key)!.resource;
  }

  async mergePr(
    id: string,
    options: { strategy: MergeMode; commitHeadOid?: string }
  ): Promise<MergeResult> {
    const pr = this.pullRequests.find((p) => p.url === id);
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

    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (!prNumber) return { success: false, error: 'Could not determine PR number' };

    const result = await rpc.pullRequests.mergePullRequest(pr.repositoryUrl, prNumber, options);
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
    const pr = this.pullRequests.find((p) => p.url === id);
    if (!pr) return;
    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (!prNumber) return;
    await rpc.pullRequests.markReadyForReview(pr.repositoryUrl, prNumber);
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
      void rpc.pullRequests.refreshPullRequest(pr.repositoryUrl, prNumber);
    }

    // Also trigger a check-run sync — the result arrives embedded in the
    // next prUpdatedChannel event emitted by syncChecks.
    void rpc.pullRequests.syncChecks(pr.url, pr.headRefOid);
  }

  dispose(): void {
    this.commitHistory.dispose();
    for (const entry of this._prFiles.values()) entry.resource.dispose();
  }

  private async _fetchPrFiles(pr: PullRequest): Promise<GitChange[]> {
    const remote = this.repositoryStore.configuredRemote;
    // Dereference the MobX-observable Remote into a plain object — MobX proxies
    // cannot be structured-cloned by Electron IPC and will throw.
    const plainRemote = { name: remote.name, url: remote.url };
    const baseRef = remoteRef(plainRemote, pr.baseRefName);
    const headRef = commitRef(pr.headRefOid);
    const range = mergeBaseRange(baseRef, headRef);

    const tryRange = async (): Promise<GitChange[] | null> => {
      const result = await rpc.git.getChangedFiles(this.projectId, this.workspaceId, range);
      if (!result.success) return null;
      const changes = result.data.changes;
      const expectedChangedFiles = pr.changedFiles ?? 0;
      if (expectedChangedFiles > 0 && changes.length === 0) return null;
      if (expectedChangedFiles > 0 && changes.length > expectedChangedFiles * 2) return null;
      return changes;
    };

    const first = await tryRange();
    if (first) return first;

    // headRefOid not available locally — fetch the PR branch then retry
    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (prNumber) {
      await rpc.repository.fetchPrForReview(
        this.projectId,
        prNumber,
        pr.headRefName,
        pr.headRepositoryUrl,
        isForkPr(pr)
      );
    }
    return (await tryRange()) ?? [];
  }

  private async _fetchCommitHistory(): Promise<{
    commits: Commit[];
    aheadCount: number;
  }> {
    const remote = this.repositoryStore.configuredRemote;
    // Plain copy to avoid MobX proxy IPC serialization failure.
    const plainRemote = { name: remote.name, url: remote.url };
    const currentPr = selectCurrentPr(this.pullRequests);
    const base: GitObjectRef | undefined = currentPr
      ? remoteRef(plainRemote, currentPr.baseRefName)
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
