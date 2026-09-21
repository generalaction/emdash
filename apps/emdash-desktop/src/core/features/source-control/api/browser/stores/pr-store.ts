import { normalizeDiffTarget, type GitChange } from '@emdash/core/runtimes/git/api';
import type { UpdateWorktreeError } from '@emdash/core/runtimes/workspace-registry/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { remote } from '@emdash/wire/state';
import { comparer, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import {
  asAvailableProject,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import type { ProjectHostObservation } from '@core/features/projects/api/host-observation';
import {
  checkoutSelector,
  getSourceControlClient,
} from '@core/features/source-control/api/browser/client';
import type { GitRepositoryStore } from '@core/features/source-control/api/browser/stores/git-repository-store';
import type { TaskPrAssociationStore } from '@core/features/source-control/api/browser/stores/task-pr-association-store';
import { getWorkspaceRegistryWireClient } from '@core/features/workspaces/api/browser/client';
import { Resource } from '@core/primitives/async-resource/browser/resource';
import { commitRef, mergeBaseRange } from '@core/primitives/git/api';
import { projectHostRef } from '@core/primitives/projects/api';
import { captureTelemetry } from '@core/primitives/telemetry/browser/telemetry-client';
import { observeReadableInAction } from '@core/primitives/wire/browser/mobx-readable';
import { compilePrUpdateInstruction } from '@core/primitives/workspaces/api';
import {
  getPrNumber,
  isForkPr,
  pullRequestErrorMessage,
  selectCurrentPr,
  type PrCheckoutDrift,
  type PullRequest,
  type PullRequestMergeOptions,
} from '@core/services/pull-requests/api';
import { getPullRequestsRuntimeClient } from '@core/services/pull-requests/api/client';
import { pullRequestsContract } from '@core/services/pull-requests/api/contract';
import type { PullRequestDetails } from '@core/services/pull-requests/api/schemas';
import type { GitCheckoutStore } from '../../../browser/stores/git-checkout-store';

export type MergeResult = { success: true } | { success: false; error: string };

export class PrStore {
  details: PullRequestDetails | null = null;
  private readonly _scope = createScope({ label: 'pr-store' });
  private _detailsScope: Scope | null = null;
  private readonly _prFiles = new Map<
    string,
    { resource: Resource<GitChange[]>; baseRefOid: string; headRefOid: string }
  >();

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly gitRepositoryStore: GitRepositoryStore,
    private readonly gitCheckoutStore: GitCheckoutStore,
    private readonly associationStore: TaskPrAssociationStore
  ) {
    makeAutoObservable<this, '_scope' | '_detailsScope'>(this, {
      details: observable.ref,
      _scope: false,
      _detailsScope: false,
    });
  }

  bindDetails(interest: () => { visible: boolean; comments: boolean }): void {
    this._scope.add(
      reaction(
        () => {
          const demand = interest();
          const pr = demand.visible ? this.currentPr : undefined;
          const number = pr ? getPrNumber(pr) : null;
          return pr && number !== null
            ? { repositoryUrl: pr.repositoryUrl, number, comments: demand.comments }
            : null;
        },
        (key) => {
          void this._detailsScope?.dispose();
          this._detailsScope = null;
          this.details = null;
          if (!key || this._scope.disposed) return;
          const scope = this._scope.child('displayed-pr');
          this._detailsScope = scope;
          void getPullRequestsRuntimeClient()
            .then((client) => {
              if (scope.disposed) return;
              const model = remote(pullRequestsContract.details, client.details, { scope });
              observeReadableInAction(
                model(key).states.state,
                (state) => {
                  if (scope.disposed) return;
                  if (state.status === 'error') this.setDetailsError(state.error);
                  else if (state.value) this.details = state.value;
                },
                { scope }
              );
            })
            .catch((error) => {
              if (!scope.disposed) runInAction(() => this.setDetailsError(error));
            });
        },
        { fireImmediately: true, equals: comparer.structural }
      )
    );
  }

  private setDetailsError(error: unknown): void {
    this.details = {
      ...(this.details ?? { pr: null, comments: [], commentsFetchedAt: null }),
      refreshing: false,
      stale: true,
      errors: { metadata: { type: 'refresh_failed', message: String(error) } },
    };
  }

  get pullRequests(): readonly PullRequest[] {
    return this.associationStore.pullRequests;
  }

  get pullRequestsObservation(): ProjectHostObservation<readonly PullRequest[]> {
    const association = this.associationStore.state;
    return this.gitRepositoryStore.observeHost(
      association.kind !== 'unknown'
        ? {
            kind: 'observed',
            value: this.associationStore.pullRequests,
            observedAt: association.observedAt,
          }
        : { kind: 'never-observed' }
    );
  }

  get currentPr(): PullRequest | undefined {
    return selectCurrentPr(this.pullRequests);
  }

  /**
   * Checkout drift vs the current PR's cached head (pr-workspace-model spec,
   * Staleness), derived by the task-PR sync coordinator; unknown until derived.
   */
  get checkoutDrift(): PrCheckoutDrift {
    return this.associationStore.checkoutDrift;
  }

  /**
   * The manual "Update now" verb (pr-workspace-model spec, Staleness): compiles the
   * `{ remote, sourceRef }` instruction from the current PR association and the
   * project's base remote, and invokes the registry-owned fast-forward through the
   * workspace wire API — never reading workspace config or host record fields, so
   * pre-model workspaces update too. Guard refusals (dirty worktree, active
   * sessions, diverged branch) come back as readable messages; after a success the
   * host's post-update scan feeds observation and the drift state returns to
   * in-sync on the next derivation.
   */
  async updatePrCheckout(): Promise<MergeResult> {
    const pr = this.currentPr;
    if (!pr) return { success: false, error: 'No pull request is associated with this task' };
    const baseRemote = this.gitRepositoryStore.baseRemote;
    if (baseRemote === null) {
      return { success: false, error: 'This repository has no git remotes to fetch the PR from' };
    }
    const instruction = compilePrUpdateInstruction(pr, { baseRemote: baseRemote.name });
    if (!instruction) return { success: false, error: 'Could not determine the PR number' };
    const project = asAvailableProject(getProjectStore(this.projectId));
    if (!project) return { success: false, error: 'The project is not available' };

    const client = await getWorkspaceRegistryWireClient();
    const result = await client.updateWorktree({
      host: projectHostRef(project.project),
      workspaceId: this.workspaceId,
      remote: instruction.remote,
      sourceRef: instruction.sourceRef,
    });
    if (!result.success) {
      return { success: false, error: describeUpdateCheckoutError(result.error) };
    }
    return { success: true };
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
    await client.markReadyForReview({
      repositoryUrl: pr.repositoryUrl,
      number: prNumber,
    });
  }

  /** Refresh the pull request and its check runs from GitHub. */
  refresh(id: string): void {
    const pr = this.pullRequests.find((p) => p.url === id);
    if (!pr) return;

    const prNumber = getPrNumber(pr);
    if (prNumber) {
      void getPullRequestsRuntimeClient()
        .then(async (client) => {
          await client.refreshPullRequest({
            repositoryUrl: pr.repositoryUrl,
            number: prNumber,
            comments: true,
            policy: 'force',
          });
        })
        .catch(() => {});
    }
  }

  dispose(): void {
    void this._scope.dispose();
    this.details = null;
    for (const entry of this._prFiles.values()) entry.resource.dispose();
  }

  private async _fetchPrFiles(pr: PullRequest): Promise<GitChange[]> {
    const baseRef = commitRef(pr.baseRefOid);
    const headRef = commitRef(pr.headRefOid);
    const range = mergeBaseRange(baseRef, headRef);

    const tryRange = async (): Promise<GitChange[] | null> => {
      const client = await getSourceControlClient();
      const result = await client.checkout.getChangedFiles({
        ...checkoutSelector(this.workspaceId),
        target: normalizeDiffTarget(range),
      });
      if (!result.success) return null;
      const changes = result.data.files;
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

    // Without a base remote there is nothing to fetch the PR from — an
    // honest skip instead of a fabricated remote name.
    const baseRemote = this.gitRepositoryStore.baseRemote;
    if (baseRemote === null) return [];

    await this.gitRepositoryStore.fetchRemote();
    const prNumber = getPrNumber(pr);
    if (prNumber) {
      await this.gitRepositoryStore.fetchPrForReview({
        prNumber,
        headRefName: pr.headRefName,
        headRepositoryUrl: pr.headRepositoryUrl,
        localBranch: pr.headRefName,
        isFork: isForkPr(pr),
        configuredRemote: baseRemote.name,
      });
    }

    const retry = await tryRange();
    return retry ?? [];
  }
}

/** Each host guard refusal keeps its own distinct, actionable message. */
function describeUpdateCheckoutError(error: UpdateWorktreeError | RuntimeResolveError): string {
  switch (error.type) {
    case 'worktree-dirty':
      return 'The checkout has uncommitted changes — commit or stash them first.';
    case 'workspace-active':
      return 'The workspace has active sessions — stop them before updating.';
    case 'diverged':
      return 'The checkout has local commits the PR head lacks — resolve manually.';
    case 'stage-failed':
      return error.message;
    case 'workspace-not-found':
    case 'not-a-worktree':
    case 'workspace-missing':
      return 'The workspace is not an updatable worktree.';
    case 'host-unavailable':
    case 'not-configured':
    case 'host-identity-lost':
      return error.message;
  }
}
