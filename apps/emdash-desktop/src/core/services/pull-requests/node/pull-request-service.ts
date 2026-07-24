import type { Run, Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { requestPriorities } from '@emdash/shared/requests';
import { err, ok, type Result } from '@emdash/shared/result';
import {
  createLiveModelHost,
  type ContractClient,
  type LiveInstance,
  type LiveModelHost,
} from '@emdash/wire';
import {
  normalizeRepositoryUrl,
  pullRequestsContract,
  type CreatePullRequestInput,
  type GitHubAuthContract,
  type ListPullRequestsInput,
  type ListPullRequestsResult,
  type PullRequest,
  type PullRequestComment,
  type PullRequestError,
  type PullRequestFile,
  type PullRequestFilterOptions,
  type PullRequestMergeOptions,
  type SyncState,
} from '../api';
import { PullRequestEngine } from './engine';
import type { PullRequestStore } from './store';

type SyncResult = Result<void, PullRequestError>;
type SyncRun = Run<SyncResult>;
type SyncStateHost = LiveModelHost<typeof pullRequestsContract.syncState>;
type SyncStateInstance = LiveInstance<typeof pullRequestsContract.syncState>;

const DEFAULT_MIN_SYNC_INTERVAL_MS = 60_000;

export type PullRequestServiceOptions = {
  store: PullRequestStore;
  githubAuth: ContractClient<GitHubAuthContract>;
  scope: Scope;
  logger: Logger;
  incrementalIntervalMs?: number;
  maxSyncCount?: number;
  archiveAgeMonths?: number;
  minSyncIntervalMs?: number;
  engine?: PullRequestEngine;
};

export class PullRequestService {
  private readonly syncStates: SyncStateHost;
  private readonly syncRuns = new Map<string, SyncRun>();
  private readonly lastSuccessfulSyncs = new Map<string, number>();
  private readonly engine: PullRequestEngine;

  constructor(private readonly options: PullRequestServiceOptions) {
    this.syncStates = options.scope.use(createLiveModelHost(pullRequestsContract.syncState));
    for (const repository of options.store.listRegisteredRepositories()) {
      this.ensureSyncState(repository.repositoryUrl);
    }
    this.engine =
      options.engine ??
      new PullRequestEngine({
        store: options.store,
        githubAuth: options.githubAuth,
        scope: options.scope,
        logger: options.logger,
        maxSyncCount: options.maxSyncCount,
        archiveAgeMonths: options.archiveAgeMonths,
        onSyncState: (repositoryUrl, state) => this.setSyncState(repositoryUrl, state),
      });
    if (options.incrementalIntervalMs) {
      const interval = setInterval(
        () => void this.syncAllRegistered(),
        options.incrementalIntervalMs
      );
      options.scope.add(() => clearInterval(interval));
    }
  }

  syncStateHost(): SyncStateHost {
    return this.syncStates;
  }

  runOperation<T>(
    name: string,
    callerSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    return this.options.scope
      .run(`operation:${name}`, (scopeSignal) =>
        operation(callerSignal ? AbortSignal.any([scopeSignal, callerSignal]) : scopeSignal)
      )
      .value();
  }

  listPullRequests(input: ListPullRequestsInput): Result<ListPullRequestsResult, PullRequestError> {
    const repositoryUrls = normalizeRepositoryUrls(input.repositoryUrls);
    if (!repositoryUrls.success) return repositoryUrls;
    try {
      return ok(
        this.options.store.listPullRequests({
          ...input,
          repositoryUrls: repositoryUrls.data,
        })
      );
    } catch (error) {
      return err({
        type: 'list_failed',
        message: error instanceof Error ? error.message : 'Unable to list pull requests',
      });
    }
  }

  getFilterOptions(repositoryUrls: string[]): Result<PullRequestFilterOptions, PullRequestError> {
    const normalized = normalizeRepositoryUrls(repositoryUrls);
    if (!normalized.success) return normalized;
    try {
      return ok(this.options.store.getFilterOptions(normalized.data));
    } catch (error) {
      return err({
        type: 'filter_options_failed',
        message: error instanceof Error ? error.message : 'Unable to load filter options',
      });
    }
  }

  getPullRequestsForBranch(
    repositoryUrl: string,
    branch: string
  ): Result<{ prs: PullRequest[] }, PullRequestError> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    try {
      return ok({ prs: this.options.store.getPullRequestsForBranch(normalized, branch) });
    } catch (error) {
      return err({
        type: 'task_pull_requests_failed',
        message: error instanceof Error ? error.message : 'Unable to load pull requests',
      });
    }
  }

  registerRepository(repositoryUrl: string, accountId?: string): Result<void, PullRequestError> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    this.options.store.registerRepository(normalized, accountId);
    this.ensureSyncState(normalized);
    void this.syncWithPriority(normalized, requestPriorities.background);
    return ok();
  }

  async unregisterRepository(repositoryUrl: string): Promise<Result<void, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    await this.cancelAndWait(normalized);
    this.options.store.unregisterRepository(normalized);
    this.lastSuccessfulSyncs.delete(normalized);
    this.syncStates.get({ repositoryUrl: normalized })?.dispose();
    return ok();
  }

  sync(repositoryUrl: string): Promise<SyncResult> {
    return this.syncWithPriority(repositoryUrl, requestPriorities.task);
  }

  private syncWithPriority(repositoryUrl: string, priority: number): Promise<SyncResult> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) {
      return Promise.resolve(err({ type: 'invalid_repository', input: repositoryUrl }));
    }
    const lastSuccessfulSync = this.lastSuccessfulSyncs.get(normalized);
    const minSyncIntervalMs = this.options.minSyncIntervalMs ?? DEFAULT_MIN_SYNC_INTERVAL_MS;
    if (lastSuccessfulSync !== undefined && Date.now() - lastSuccessfulSync < minSyncIntervalMs) {
      return Promise.resolve(ok());
    }
    return this.startSync(normalized, (signal) => this.engine.sync(normalized, signal, priority));
  }

  async forceFullSync(repositoryUrl: string): Promise<SyncResult> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    await this.cancelAndWait(normalized);
    return await this.startSync(normalized, (signal) =>
      this.engine.forceFullSync(normalized, signal, requestPriorities.task)
    );
  }

  async cancelSync(repositoryUrl: string): Promise<Result<void, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    await this.cancelAndWait(normalized);
    return ok();
  }

  async syncSingle(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<{ pr: PullRequest }, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    const result = await this.engine.syncSingle(normalized, number, signal);
    return result.success ? ok({ pr: result.data }) : result;
  }

  async syncChecks(
    repositoryUrl: string,
    pullRequestUrl: string,
    headRefOid: string,
    signal: AbortSignal
  ): Promise<Result<{ hasRunning: boolean }, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    const result = await this.engine.syncChecks(normalized, pullRequestUrl, headRefOid, signal);
    return result.success ? ok({ hasRunning: result.data }) : result;
  }

  async createPullRequest(
    input: CreatePullRequestInput,
    signal: AbortSignal
  ): Promise<Result<{ url: string; number: number }, PullRequestError>> {
    const repositoryUrl = normalizeRepositoryUrl(input.repositoryUrl);
    if (!repositoryUrl) {
      return err({ type: 'invalid_repository', input: input.repositoryUrl });
    }
    const result = await this.engine.createPullRequest({ ...input, repositoryUrl }, signal);
    if (result.success) {
      await this.refreshAfterMutation(repositoryUrl, result.data.number, signal);
    }
    return result;
  }

  async mergePullRequest(
    repositoryUrl: string,
    number: number,
    options: PullRequestMergeOptions,
    signal: AbortSignal
  ): Promise<Result<{ sha: string | null; merged: boolean }, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    const result = await this.engine.mergePullRequest(normalized, number, options, signal);
    if (result.success) {
      await this.refreshAfterMutation(normalized, number, signal);
    }
    return result;
  }

  async markReadyForReview(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<void, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    const result = await this.engine.markReadyForReview(normalized, number, signal);
    if (result.success) {
      await this.refreshAfterMutation(normalized, number, signal);
    }
    return result;
  }

  async getPullRequestComments(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<{ comments: PullRequestComment[] }, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    const result = await this.engine.getPullRequestComments(normalized, number, signal);
    return result.success ? ok({ comments: result.data }) : result;
  }

  async getPullRequestFiles(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<{ files: PullRequestFile[] }, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    const result = await this.engine.getPullRequestFiles(normalized, number, signal);
    return result.success ? ok({ files: result.data }) : result;
  }

  private async refreshAfterMutation(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<void> {
    const refresh = await this.engine.syncSingle(repositoryUrl, number, signal, { emit: false });
    if (!refresh.success) {
      this.options.logger.warn('Pull request refresh failed after mutation', {
        repositoryUrl,
        number,
        error: refresh.error,
      });
    }
  }

  private async startSync(
    repositoryUrl: string,
    operation: (signal: AbortSignal) => Promise<SyncResult>
  ): Promise<SyncResult> {
    const registered = this.options.store.getRegisteredRepository(repositoryUrl);
    if (!registered) return err({ type: 'repository_not_registered', repositoryUrl });
    const existing = this.syncRuns.get(repositoryUrl);
    if (existing) return await syncRunResult(existing);
    const run = this.options.scope.run(`sync:${repositoryUrl}`, async (signal) => {
      const result = await operation(signal);
      if (result.success) {
        this.lastSuccessfulSyncs.set(repositoryUrl, Date.now());
      } else {
        this.lastSuccessfulSyncs.delete(repositoryUrl);
      }
      return result;
    });
    this.syncRuns.set(repositoryUrl, run);
    void run.exit.finally(() => {
      if (this.syncRuns.get(repositoryUrl) === run) this.syncRuns.delete(repositoryUrl);
    });
    return await syncRunResult(run);
  }

  private async cancelAndWait(repositoryUrl: string): Promise<void> {
    const run = this.syncRuns.get(repositoryUrl);
    if (!run) return;
    run.cancel(new DOMException(`Pull request sync cancelled for ${repositoryUrl}`, 'AbortError'));
    await run.exit;
  }

  private ensureSyncState(repositoryUrl: string): SyncStateInstance {
    return (
      this.syncStates.get({ repositoryUrl }) ??
      this.syncStates.create({ repositoryUrl }, { state: { phase: 'idle', kind: null } })
    );
  }

  private setSyncState(repositoryUrl: string, state: SyncState): void {
    if (state.phase === 'idle' && state.lastSyncedAt !== undefined) {
      this.lastSuccessfulSyncs.set(repositoryUrl, state.lastSyncedAt);
    } else if (state.phase === 'error') {
      this.lastSuccessfulSyncs.delete(repositoryUrl);
    }
    this.ensureSyncState(repositoryUrl).states.state.produce(() => state);
  }

  private async syncAllRegistered(): Promise<void> {
    await Promise.all(
      this.options.store
        .listRegisteredRepositories()
        .map(
          async ({ repositoryUrl }) =>
            await this.syncWithPriority(repositoryUrl, requestPriorities.background)
        )
    );
  }
}

async function syncRunResult(run: SyncRun): Promise<SyncResult> {
  const exit = await run.exit;
  switch (exit.kind) {
    case 'success':
      return exit.value;
    case 'cancelled':
      return err({ type: 'sync_failed', message: 'Pull request sync cancelled' });
    case 'failure':
      return err({
        type: 'sync_failed',
        message: exit.error instanceof Error ? exit.error.message : 'Pull request sync failed',
      });
  }
}

function normalizeRepositoryUrls(repositoryUrls: string[]): Result<string[], PullRequestError> {
  const normalized: string[] = [];
  for (const repositoryUrl of repositoryUrls) {
    const value = normalizeRepositoryUrl(repositoryUrl);
    if (!value) return err({ type: 'invalid_repository', input: repositoryUrl });
    normalized.push(value);
  }
  return ok([...new Set(normalized)]);
}
