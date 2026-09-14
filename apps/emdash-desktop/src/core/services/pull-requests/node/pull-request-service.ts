import { err, ok, type Result } from '@emdash/shared';
import type { Run, Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { requestPriorities } from '@emdash/shared/requests';
import { waitWithSignal } from '@emdash/shared/scheduling';
import { type ContractClient } from '@emdash/wire/rpc';
import {
  cell,
  derived,
  family,
  snapshot,
  type Cell,
  type Family,
  type Readable,
} from '@emdash/wire/state';
import {
  normalizeRepositoryUrl,
  type CreatePullRequestInput,
  type GitPlatformAuthContract,
  type ListPullRequestsInput,
  type ListPullRequestsResult,
  type PullRequest,
  type PullRequestError,
  type PullRequestFile,
  type PullRequestFilterOptions,
  type PullRequestMergeOptions,
  type SyncState,
  type PullRequestDetails,
  type RefreshRepositoryInput,
  type RefreshPullRequestInput,
} from '../api';
import { PullRequestEngine } from './engine';
import type { Observed, PullRequestMetadata } from './engine/observation';
import type { GitPlatformPullRequestRepository } from './engine/providers/git-platform-provider';
import type { PullRequestStore } from './store';

type SyncResult = Result<void, PullRequestError>;
type SyncRun = Run<SyncResult>;
type SyncStateKey = { repositoryUrl: string };

const FRESHNESS_MS = 60_000;
const DEFAULT_MAX_SYNC_COUNT = 300;
const DEFAULT_ARCHIVE_AGE_MONTHS = 6;

type RepositoryRead = {
  repository: GitPlatformPullRequestRepository;
  sequence: number;
  generation: number;
};

type RepositoryEntry = {
  active: boolean;
  revision: number;
  lastOperation: 'inventory' | 'history';
  inventory: { run?: SyncRun; forceRequested: boolean; fetchedAt?: number; state: SyncState };
  history: { run?: SyncRun; pending: boolean; state: SyncState };
  access?: { identity: string | null; sequence: number; generation: number };
};

type DetailEntry = {
  repositoryUrl: string;
  number: number;
  consumers: number;
  commentConsumers: number;
  commentsRequested: boolean;
  invalidated: boolean;
  forceRequested: boolean;
  run: Promise<void> | null;
  cell: Cell<PullRequestDetails>;
  value: PullRequestDetails;
};

export type PullRequestServiceOptions = {
  store: PullRequestStore;
  githubAuth: ContractClient<GitPlatformAuthContract>;
  scope: Scope;
  logger: Logger;
  incrementalIntervalMs?: number;
  maxSyncCount?: number;
  archiveAgeMonths?: number;
  engine?: PullRequestEngine;
};

export class PullRequestService {
  private readonly syncStateCells: Family<SyncStateKey, Cell<SyncState>>;
  private readonly repositories = new Map<string, RepositoryEntry>();
  private readSequence = 0;
  private readonly acceptedObservations = new Map<
    string,
    { sequence: number; generation: number }
  >();
  private readonly engine: PullRequestEngine;
  private readonly details = new Map<string, DetailEntry>();

  constructor(private readonly options: PullRequestServiceOptions) {
    this.syncStateCells = family<SyncStateKey, Cell<SyncState>>(
      (key) => cell(this.repositoryState(key.repositoryUrl)),
      { name: 'pull-request-sync-state', key: (key) => key.repositoryUrl, scope: options.scope }
    );
    this.engine =
      options.engine ??
      new PullRequestEngine({
        githubAuth: options.githubAuth,
        scope: options.scope,
        logger: options.logger,
      });
    if (options.incrementalIntervalMs) {
      const interval = setInterval(() => {
        void this.syncAllRegistered();
      }, options.incrementalIntervalMs);
      options.scope.add(() => clearInterval(interval));
    }
  }

  private repositoryEntry(repositoryUrl: string): RepositoryEntry {
    let entry = this.repositories.get(repositoryUrl);
    if (!entry) {
      entry = {
        active: false,
        revision: 0,
        lastOperation: 'inventory',
        inventory: { forceRequested: false, state: idleSyncState() },
        history: { pending: false, state: idleSyncState() },
      };
      this.repositories.set(repositoryUrl, entry);
    }
    return entry;
  }

  observeRepository(repositoryUrl: string, scope: Scope): Readable<SyncState> {
    const key = { repositoryUrl: normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl };
    scope.add(this.syncStateCells.retain(key));
    return this.syncStateCells(key);
  }

  observePullRequest(
    key: { repositoryUrl: string; number: number; comments: boolean },
    scope: Scope
  ): Readable<PullRequestDetails> {
    const entry = this.detailEntry(key.repositoryUrl, key.number);
    entry.consumers++;
    if (key.comments) entry.commentConsumers++;
    scope.add(() => {
      entry.consumers--;
      if (key.comments) entry.commentConsumers--;
      if (entry.consumers === 0 && !entry.run)
        this.details.delete(`${entry.repositoryUrl}/pull/${entry.number}`);
    });
    void this.refreshPullRequest({ ...key, policy: 'if-stale' });
    return derived(() =>
      projectDetails(snapshot(entry.cell).value, key.comments)
    ) as Readable<PullRequestDetails>;
  }

  refreshRepository(input: RefreshRepositoryInput): Promise<SyncResult> {
    return this.refreshRepositoryResources(input);
  }

  private async refreshRepositoryResources(
    { repositoryUrl, policy }: RefreshRepositoryInput,
    since = Date.now() - FRESHNESS_MS + 1,
    priority: number = requestPriorities.task,
    includeInventory = true
  ): Promise<SyncResult> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    if (!this.options.store.getRegisteredRepository(normalized))
      return err({ type: 'repository_not_registered', repositoryUrl: normalized });
    const repository = this.repositoryEntry(normalized);
    const last = repository.inventory.fetchedAt;
    const inventory =
      includeInventory &&
      (repository.inventory.run !== undefined ||
        policy === 'force' ||
        last === undefined ||
        last < since)
        ? this.refreshInventory(normalized, policy === 'force', priority)
        : Promise.resolve(ok());
    const details = [...this.details.values()]
      .filter((entry) => entry.repositoryUrl === normalized && entry.consumers > 0)
      .map(async (entry): Promise<SyncResult> => {
        const input = {
          repositoryUrl: normalized,
          number: entry.number,
          comments: entry.commentConsumers > 0,
          policy,
        };
        if (entry.run) return this.refreshPullRequest(input);
        await inventory;
        if (entry.consumers === 0 || this.options.scope.disposed) return ok();
        return detailRefreshOutcome(await this.refreshDetails(input, since), input.comments);
      });
    const result = await inventory;
    if (result.success) this.startPendingHistory(normalized, priority);
    const outcomes = await Promise.all(details);
    return !result.success ? result : (outcomes.find((outcome) => !outcome.success) ?? ok());
  }

  async refreshPullRequest(input: RefreshPullRequestInput): Promise<SyncResult> {
    return detailRefreshOutcome(await this.refreshDetails(input), Boolean(input.comments));
  }

  private async refreshDetails(
    input: RefreshPullRequestInput,
    since = Date.now() - FRESHNESS_MS + 1
  ): Promise<Result<PullRequestDetails, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(input.repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: input.repositoryUrl });
    const entry = this.detailEntry(normalized, input.number);
    if (!this.options.store.getRegisteredRepository(normalized)) {
      const error: PullRequestError = {
        type: 'repository_not_registered',
        repositoryUrl: normalized,
      };
      entry.value = { ...entry.value, errors: { ...entry.value.errors, metadata: error } };
      this.publishDetails(entry);
      if (entry.consumers === 0 && !entry.run)
        this.details.delete(`${normalized}/pull/${input.number}`);
      return err(error);
    }
    const comments = Boolean(input.comments || entry.commentConsumers > 0);
    if (entry.run) {
      if (input.policy === 'force' || (comments && !entry.commentsRequested))
        entry.invalidated = true;
      entry.forceRequested ||= input.policy === 'force';
      entry.commentsRequested ||= comments;
      await entry.run;
      return ok(entry.value);
    }
    const pr = this.options.store.getPullRequestByUrl(`${normalized}/pull/${input.number}`);
    const fresh = (time: number | null | undefined) => time != null && time >= since;
    if (
      input.policy === 'if-stale' &&
      this.repositoryEntry(normalized).access?.identity != null &&
      this.acceptedObservations.get(`${normalized}/pull/${input.number}`)?.generation ===
        this.repositoryEntry(normalized).access?.generation &&
      !entry.value.errors.metadata &&
      !entry.value.errors.checks &&
      (!comments || !entry.value.errors.comments) &&
      fresh(pr?.metadataFetchedAt) &&
      fresh(pr?.checksFetchedAt) &&
      (!comments || fresh(entry.value.commentsFetchedAt))
    ) {
      this.publishDetails(entry);
      if (entry.consumers === 0) this.details.delete(`${normalized}/pull/${input.number}`);
      return ok(entry.value);
    }
    entry.commentsRequested = comments;
    entry.forceRequested = input.policy === 'force';
    entry.run = this.runOperation('refresh-pr', undefined, async (signal) => {
      do {
        entry.invalidated = false;
        const withComments = entry.commentsRequested;
        const force = entry.forceRequested;
        entry.forceRequested = false;
        entry.value = { ...entry.value, refreshing: true };
        this.publishDetails(entry);
        const errors: PullRequestDetails['errors'] = { ...entry.value.errors };
        delete errors.metadata;
        try {
          const read = await this.beginRead(normalized, signal);
          if (!read.success) {
            errors.metadata = read.error;
            entry.value = { ...entry.value, refreshing: false, errors };
            this.publishDetails(entry);
            continue;
          }
          const cached = this.options.store.getPullRequestByUrl(
            `${normalized}/pull/${input.number}`
          );
          const metadata =
            !force &&
            cached &&
            fresh(cached.metadataFetchedAt) &&
            this.acceptedObservations.get(cached.url)?.generation === read.data.generation
              ? ok(cached)
              : await this.fetchMetadata(read.data, input.number, signal);
          if (!metadata.success) errors.metadata = metadata.error;
          else {
            delete errors.checks;
            const checks = await read.data.repository.fetchChecks(input.number, signal);
            if (!checks.success) errors.checks = checks.error;
            else {
              this.assertCurrent(read.data, signal);
              if (
                checks.data.data.headRefOid !== metadata.data.headRefOid ||
                !this.options.store.replaceChecksForHead(
                  metadata.data.url,
                  checks.data.data.headRefOid,
                  checks.data.data.checks,
                  checks.data.fetchedAt
                )
              ) {
                errors.checks = {
                  type: 'checks_failed',
                  message: 'The PR head changed while refreshing checks',
                };
              }
            }
          }
          if (withComments) {
            delete errors.comments;
            const result = await read.data.repository.fetchComments(input.number, signal);
            if (!result.success) errors.comments = result.error;
            else {
              this.assertCurrent(read.data, signal);
              this.options.store.saveCommentObservation(
                `${normalized}/pull/${input.number}`,
                result.data.data,
                result.data.fetchedAt
              );
            }
          }
        } catch (error) {
          if (signal.aborted) return;
          errors.metadata = { type: 'refresh_failed', message: String(error) };
        }
        entry.value = { ...entry.value, refreshing: false, errors };
        this.publishDetails(entry);
        this.notifyCacheChanged(normalized);
      } while (entry.invalidated && !signal.aborted);
    })
      .catch((error) => {
        entry.value = {
          ...entry.value,
          stale: true,
          errors: {
            ...entry.value.errors,
            metadata: { type: 'refresh_failed', message: String(error) },
          },
        };
      })
      .finally(() => {
        entry.run = null;
        entry.value = { ...entry.value, refreshing: false };
        if (!this.options.scope.disposed) this.publishDetails(entry);
        if (entry.consumers === 0)
          this.details.delete(`${entry.repositoryUrl}/pull/${entry.number}`);
      });
    await entry.run;
    return ok(entry.value);
  }

  private detailEntry(repositoryUrl: string, number: number): DetailEntry {
    repositoryUrl = normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl;
    const key = `${repositoryUrl}/pull/${number}`;
    const existing = this.details.get(key);
    if (existing) return existing;
    const value: PullRequestDetails = {
      pr: this.options.store.getPullRequestByUrl(key),
      comments: this.options.store.getComments(key),
      commentsFetchedAt: this.options.store.getCommentState(key)?.lastFetchedAt ?? null,
      refreshing: false,
      stale: true,
      errors: {},
    };
    const entry: DetailEntry = {
      repositoryUrl,
      number,
      consumers: 0,
      commentConsumers: 0,
      commentsRequested: false,
      invalidated: false,
      forceRequested: false,
      run: null,
      cell: cell(value),
      value,
    };
    this.details.set(key, entry);
    return entry;
  }

  private publishDetails(entry: DetailEntry): void {
    const url = `${entry.repositoryUrl}/pull/${entry.number}`;
    const pr = this.options.store.getPullRequestByUrl(url);
    const commentsFetchedAt = this.options.store.getCommentState(url)?.lastFetchedAt ?? null;
    entry.value = projectDetails(
      {
        ...entry.value,
        pr,
        comments: this.options.store.getComments(url),
        commentsFetchedAt,
      },
      true
    );
    entry.cell.set(entry.value);
  }

  private notifyCacheChanged(repositoryUrl: string): void {
    this.repositoryEntry(repositoryUrl).revision++;
    this.publishRepository(repositoryUrl);
    for (const entry of this.details.values())
      if (entry.repositoryUrl === repositoryUrl) this.publishDetails(entry);
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

  getPullRequestsForHead(
    repositoryUrl: string,
    headRepositoryUrl: string,
    headRefName: string
  ): Result<{ prs: PullRequest[] }, PullRequestError> {
    const normalizedRepository = normalizeRepositoryUrl(repositoryUrl);
    if (!normalizedRepository) return err({ type: 'invalid_repository', input: repositoryUrl });
    const normalizedHeadRepository = normalizeRepositoryUrl(headRepositoryUrl);
    if (!normalizedHeadRepository) {
      return err({ type: 'invalid_repository', input: headRepositoryUrl });
    }
    try {
      return ok({
        prs: this.options.store.getPullRequestsForHead(
          normalizedRepository,
          normalizedHeadRepository,
          headRefName
        ),
      });
    } catch (error) {
      return err({
        type: 'task_pull_requests_failed',
        message: error instanceof Error ? error.message : 'Unable to load pull requests',
      });
    }
  }

  /**
   * Breadcrumb validation read: the synced PR with that canonical URL belonging to
   * this repository, or null — an unknown URL is an ordinary miss, never an error,
   * so stale breadcrumbs self-correct at the association layer.
   */
  getPullRequestByUrl(
    repositoryUrl: string,
    url: string
  ): Result<{ pr: PullRequest | null }, PullRequestError> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    try {
      const registered = this.options.store.getRegisteredRepository(normalized);
      if (!registered) return ok({ pr: null });
      const pr = this.options.store.getPullRequestByUrl(url);
      return ok({ pr: pr && pr.repositoryUrl === normalized ? pr : null });
    } catch (error) {
      return err({
        type: 'task_pull_requests_failed',
        message: error instanceof Error ? error.message : 'Unable to load pull request',
      });
    }
  }

  registerRepository(repositoryUrl: string): Result<void, PullRequestError> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    this.options.store.registerRepository(normalized);
    const entry = this.repositoryEntry(normalized);
    if (!entry.active) entry.history.pending = true;
    entry.active = true;
    void this.refreshRepositoryResources(
      { repositoryUrl: normalized, policy: 'if-stale' },
      Date.now() - FRESHNESS_MS + 1,
      requestPriorities.background
    );
    return ok();
  }

  async unregisterRepository(repositoryUrl: string): Promise<Result<void, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    const entry = this.repositoryEntry(normalized);
    entry.active = false;
    entry.history.pending = false;
    await this.cancelAndWait(normalized);
    if (entry.access) entry.access.generation++;
    this.options.store.unregisterRepository(normalized);
    entry.inventory.fetchedAt = undefined;
    entry.inventory.state = idleSyncState();
    entry.history.state = idleSyncState();
    this.notifyCacheChanged(normalized);
    return ok();
  }

  async releaseRepository(repositoryUrl: string): Promise<SyncResult> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    const entry = this.repositoryEntry(normalized);
    entry.active = false;
    entry.history.pending = false;
    await this.cancelAndWait(normalized);
    entry.inventory.state = idleSyncState();
    entry.history.state = idleSyncState();
    this.publishRepository(normalized);
    return ok();
  }

  private startPendingHistory(repositoryUrl: string, priority: number): void {
    const entry = this.repositoryEntry(repositoryUrl);
    if (
      entry.history.pending &&
      entry.active &&
      !this.options.scope.disposed &&
      !entry.history.run
    ) {
      void this.startHistory(repositoryUrl, false, priority);
    }
  }

  async refreshHistory(repositoryUrl: string, signal?: AbortSignal): Promise<SyncResult> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    // A manual history request owns its read, never a shared bootstrap or another caller's read.
    for (;;) {
      const existing = this.repositoryEntry(normalized).history.run;
      if (!existing) break;
      signal?.throwIfAborted();
      const pending = syncRunResult(existing);
      await (signal ? waitWithSignal(pending, signal) : pending);
    }
    signal?.throwIfAborted();
    return this.startHistory(normalized, true, requestPriorities.task, signal);
  }

  async createPullRequest(
    input: CreatePullRequestInput,
    signal: AbortSignal
  ): Promise<Result<{ url: string; number: number }, PullRequestError>> {
    const repositoryUrl = normalizeRepositoryUrl(input.repositoryUrl);
    if (!repositoryUrl) {
      return err({ type: 'invalid_repository', input: input.repositoryUrl });
    }
    if (!this.options.store.getRegisteredRepository(repositoryUrl))
      return err({ type: 'repository_not_registered', repositoryUrl });
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
    if (!this.options.store.getRegisteredRepository(normalized))
      return err({ type: 'repository_not_registered', repositoryUrl: normalized });
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
    if (!this.options.store.getRegisteredRepository(normalized))
      return err({ type: 'repository_not_registered', repositoryUrl: normalized });
    const result = await this.engine.markReadyForReview(normalized, number, signal);
    if (result.success) {
      await this.refreshAfterMutation(normalized, number, signal);
    }
    return result;
  }

  async getPullRequestFiles(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<{ files: PullRequestFile[] }, PullRequestError>> {
    const normalized = normalizeRepositoryUrl(repositoryUrl);
    if (!normalized) return err({ type: 'invalid_repository', input: repositoryUrl });
    if (!this.options.store.getRegisteredRepository(normalized))
      return err({ type: 'repository_not_registered', repositoryUrl: normalized });
    const result = await this.engine.getPullRequestFiles(normalized, number, signal);
    return result.success ? ok({ files: result.data }) : result;
  }

  private async refreshAfterMutation(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted || this.options.scope.disposed) return;
    const refresh = await this.refreshPullRequest({ repositoryUrl, number, policy: 'force' });
    if (!refresh.success) {
      this.options.logger.warn('Pull request refresh failed after mutation', {
        repositoryUrl,
        number,
        error: refresh.error,
      });
    }
  }

  /** Resolve identity before choosing cursors; later identity changes fence pending observations. */
  private async beginRead(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<RepositoryRead, PullRequestError>> {
    if (!this.options.store.getRegisteredRepository(repositoryUrl))
      return err({ type: 'repository_not_registered', repositoryUrl });
    const sequence = ++this.readSequence;
    const opened = await this.engine.openRepository(repositoryUrl, signal);
    signal.throwIfAborted();
    const entry = this.repositoryEntry(repositoryUrl);
    const previous = entry.access;
    if (!opened.success) {
      if (isAccessRejection(opened.error) && (!previous || sequence > previous.sequence)) {
        entry.access = {
          identity: null,
          sequence,
          generation: (previous?.generation ?? 0) + 1,
        };
        this.options.store.clearCursors(repositoryUrl);
        entry.inventory.fetchedAt = undefined;
        if (entry.active) entry.history.pending = true;
      }
      return opened;
    }
    const changed = previous !== undefined && previous.identity !== opened.data.identity;
    if (changed && sequence < previous.sequence)
      return err({ type: 'refresh_failed', message: 'Repository identity changed during refresh' });
    const generation = (previous?.generation ?? 1) + (changed ? 1 : 0);
    if (changed) {
      this.options.store.clearCursors(repositoryUrl);
      entry.inventory.fetchedAt = undefined;
      if (entry.active) entry.history.pending = true;
    }
    entry.access = {
      identity: opened.data.identity,
      sequence: Math.max(sequence, previous?.sequence ?? 0),
      generation,
    };
    return ok({ repository: opened.data, sequence, generation });
  }

  private assertCurrent(read: RepositoryRead, signal: AbortSignal): void {
    signal.throwIfAborted();
    const repositoryUrl = read.repository.repositoryUrl;
    if (
      !this.options.store.getRegisteredRepository(repositoryUrl) ||
      this.repositoryEntry(repositoryUrl).access?.generation !== read.generation
    ) {
      throw new Error('Repository observation was superseded');
    }
  }

  private acceptMetadata(
    read: RepositoryRead,
    observation: Observed<PullRequestMetadata>,
    signal: AbortSignal
  ): PullRequest {
    this.assertCurrent(read, signal);
    const metadata = observation.data;
    const previous = this.options.store.getPullRequestByUrl(metadata.url);
    if (previous && read.sequence < (this.acceptedObservations.get(metadata.url)?.sequence ?? 0))
      return previous;
    const saved = this.options.store.savePullRequest({
      ...metadata,
      metadataFetchedAt: observation.fetchedAt,
      checks: previous?.checks ?? [],
    });
    this.acceptedObservations.set(metadata.url, {
      sequence: read.sequence,
      generation: read.generation,
    });
    return saved;
  }

  private async fetchMetadata(
    read: RepositoryRead,
    number: number,
    signal: AbortSignal
  ): Promise<Result<PullRequest, PullRequestError>> {
    const observed = await read.repository.fetchPullRequest(
      number,
      signal,
      requestPriorities.interactive
    );
    return observed.success ? ok(this.acceptMetadata(read, observed.data, signal)) : observed;
  }

  private async syncOpen(
    repositoryUrl: string,
    signal: AbortSignal,
    priority: number
  ): Promise<SyncResult> {
    this.setSyncState(repositoryUrl, { phase: 'running', kind: 'repository', synced: 0 });
    const opened = await this.beginRead(repositoryUrl, signal);
    if (!opened.success) return opened;
    const read = opened.data;
    const previous = this.options.store.getOpenPullRequestNumbers(repositoryUrl);
    const seen = new Set<number>();
    let cursor: string | null = null;
    let observedAt: number | undefined;
    for (;;) {
      const result = await read.repository.fetchOpenPage(cursor, signal, priority);
      if (!result.success) return result;
      this.assertCurrent(read, signal);
      observedAt ??= result.data.fetchedAt;
      for (const pr of result.data.data.prs) {
        const number = Number(pr.identifier?.replace('#', ''));
        if (!Number.isInteger(number) || number <= 0)
          return err({ type: 'sync_failed', message: 'Invalid PR identity in inventory' });
        seen.add(number);
        this.acceptMetadata(read, { data: pr, fetchedAt: result.data.fetchedAt }, signal);
      }
      this.notifyCacheChanged(repositoryUrl);
      this.setSyncState(repositoryUrl, {
        phase: 'running',
        kind: 'repository',
        synced: seen.size,
      });
      const page = result.data.data.pageInfo;
      if (!page.hasNextPage) break;
      if (!page.endCursor || page.endCursor === cursor)
        return err({ type: 'sync_failed', message: 'Incomplete PR inventory pagination' });
      cursor = page.endCursor;
    }
    // Absence has meaning only after a complete inventory; never infer a terminal status.
    for (const number of previous) {
      if (seen.has(number)) continue;
      const result = await this.fetchMetadata(read, number, signal);
      if (!result.success) return result;
    }
    this.assertCurrent(read, signal);
    this.repositoryEntry(repositoryUrl).inventory.fetchedAt = observedAt ?? Date.now();
    return ok();
  }

  /** Bounded history is independent work, never evidence of open-inventory freshness. */
  private async startHistory(
    repositoryUrl: string,
    force: boolean,
    priority: number,
    callerSignal?: AbortSignal
  ): Promise<SyncResult> {
    const history = this.repositoryEntry(repositoryUrl).history;
    const existing = history.run;
    if (existing) return syncRunResult(existing);
    this.setSyncState(repositoryUrl, { phase: 'running', kind: 'history', synced: 0 });
    const run = this.options.scope.run(`history:${repositoryUrl}`, (signal) =>
      this.syncHistory(
        repositoryUrl,
        callerSignal ? AbortSignal.any([signal, callerSignal]) : signal,
        force,
        priority
      )
    );
    history.run = run;
    const result = await syncRunResult(run);
    if (history.run === run) history.run = undefined;
    if (result.success || callerSignal?.aborted) history.pending = false;
    if (!this.options.scope.disposed) {
      this.setSyncState(
        repositoryUrl,
        result.success || callerSignal?.aborted
          ? {
              phase: 'idle',
              kind: 'history',
              outcome: callerSignal?.aborted ? 'cancelled' : 'success',
            }
          : { phase: 'error', kind: 'history', error: result.error }
      );
      this.notifyCacheChanged(repositoryUrl);
    }
    return result;
  }

  private async syncHistory(
    repositoryUrl: string,
    signal: AbortSignal,
    force: boolean,
    priority: number
  ): Promise<SyncResult> {
    const opened = await this.beginRead(repositoryUrl, signal);
    if (!opened.success) return opened;
    const read = opened.data;
    if (force) this.options.store.clearCursors(repositoryUrl);
    const full = this.options.store.getCursor(repositoryUrl, 'full');
    const incremental = full?.done === true;
    const kind = incremental ? 'incremental' : 'full';
    const existing = this.options.store.getCursor(repositoryUrl, kind);
    const boundary = incremental
      ? (existing?.lastUpdatedAt ?? full.lastUpdatedAt ?? new Date(0).toISOString())
      : undefined;
    let cursor = existing?.done ? null : (existing?.pageCursor ?? null);
    let synced = 0;
    let newest = boundary ?? existing?.lastUpdatedAt;
    const limit = this.options.maxSyncCount ?? DEFAULT_MAX_SYNC_COUNT;
    for (;;) {
      const result = await read.repository.fetchHistoryPage(cursor, signal, priority);
      if (!result.success) return result;
      this.assertCurrent(read, signal);
      const page = result.data.data;
      const recent = boundary ? page.prs.filter((pr) => pr.updatedAt >= boundary) : page.prs;
      const batch = recent.slice(0, Math.max(0, limit - synced));
      for (const pr of batch) {
        this.acceptMetadata(read, { data: pr, fetchedAt: result.data.fetchedAt }, signal);
        if (!newest || pr.updatedAt > newest) newest = pr.updatedAt;
      }
      synced += batch.length;
      const done =
        recent.length !== page.prs.length || !page.pageInfo.hasNextPage || synced >= limit;
      if (!done && (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor))
        return err({ type: 'sync_failed', message: 'Incomplete PR history pagination' });
      if (incremental && synced >= limit && page.pageInfo.hasNextPage) {
        this.options.store.clearCursors(repositoryUrl);
      } else {
        this.options.store.setCursor(repositoryUrl, kind, {
          lastUpdatedAt: done
            ? (newest ?? new Date().toISOString())
            : (boundary ?? newest ?? new Date().toISOString()),
          pageCursor: done ? undefined : (page.pageInfo.endCursor ?? undefined),
          done,
        });
      }
      this.notifyCacheChanged(repositoryUrl);
      this.setSyncState(repositoryUrl, {
        phase: 'running',
        kind: 'history',
        synced,
        total: page.totalCount === undefined ? undefined : Math.min(page.totalCount, limit),
      });
      if (done) break;
      cursor = page.pageInfo.endCursor;
    }
    const cutoff = new Date();
    cutoff.setMonth(
      cutoff.getMonth() - (this.options.archiveAgeMonths ?? DEFAULT_ARCHIVE_AGE_MONTHS)
    );
    this.options.store.archiveOldPullRequests(repositoryUrl, cutoff.toISOString());
    return ok();
  }

  private async refreshInventory(
    repositoryUrl: string,
    force: boolean,
    priority: number
  ): Promise<SyncResult> {
    const registered = this.options.store.getRegisteredRepository(repositoryUrl);
    if (!registered) return err({ type: 'repository_not_registered', repositoryUrl });
    const inventory = this.repositoryEntry(repositoryUrl).inventory;
    const existing = inventory.run;
    if (existing) {
      if (force) inventory.forceRequested = true;
      return await syncRunResult(existing);
    }
    const run = this.options.scope.run(`sync:${repositoryUrl}`, async (signal) => {
      let result: SyncResult;
      do {
        inventory.forceRequested = false;
        try {
          result = await this.syncOpen(repositoryUrl, signal, priority);
        } catch (error) {
          result = err({
            type: 'sync_failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        if (result.success) {
          this.setSyncState(repositoryUrl, {
            phase: 'idle',
            kind: 'repository',
            outcome: 'success',
          });
        } else
          this.setSyncState(repositoryUrl, {
            phase: 'error',
            kind: 'repository',
            error: result.error,
          });
        this.notifyCacheChanged(repositoryUrl);
      } while (inventory.forceRequested && !signal.aborted);
      return result;
    });
    inventory.run = run;
    void run.exit.finally(() => {
      if (inventory.run === run) inventory.run = undefined;
    });
    return await syncRunResult(run);
  }

  private async cancelAndWait(repositoryUrl: string): Promise<void> {
    const entry = this.repositoryEntry(repositoryUrl);
    const runs = [entry.inventory.run, entry.history.run].filter(
      (run): run is SyncRun => run !== undefined
    );
    for (const run of runs)
      run.cancel(
        new DOMException(`Pull request sync cancelled for ${repositoryUrl}`, 'AbortError')
      );
    await Promise.all(runs.map((run) => run.exit));
  }

  private setSyncState(repositoryUrl: string, state: SyncState): void {
    const entry = this.repositoryEntry(repositoryUrl);
    const operation = state.kind === 'history' ? 'history' : 'inventory';
    entry[operation].state = state;
    entry.lastOperation = operation;
    this.publishRepository(repositoryUrl);
  }

  /** Inventory and history own their state. Only this projection chooses what the UI shows. */
  private repositoryState(repositoryUrl: string): SyncState {
    const entry = this.repositoryEntry(repositoryUrl);
    const states = [entry.inventory.state, entry.history.state];
    const state =
      states.find((value) => value.phase === 'running') ??
      states.find((value) => value.phase === 'error') ??
      entry[entry.lastOperation].state;
    return {
      ...state,
      lastSyncedAt: entry.inventory.fetchedAt,
      revision: entry.revision,
    };
  }

  private publishRepository(repositoryUrl: string): void {
    this.syncStateCells.peekMember({ repositoryUrl })?.set(this.repositoryState(repositoryUrl));
  }

  private async syncAllRegistered(): Promise<void> {
    const repositories = new Set(
      [...this.repositories].filter(([, entry]) => entry.active).map(([url]) => url)
    );
    for (const entry of this.details.values()) {
      if (entry.consumers > 0) {
        repositories.add(entry.repositoryUrl);
        this.publishDetails(entry);
      }
    }
    await Promise.all(
      [...repositories].map((repositoryUrl) =>
        this.refreshRepositoryResources(
          { repositoryUrl, policy: 'if-stale' },
          Date.now(),
          requestPriorities.background,
          this.repositoryEntry(repositoryUrl).active
        )
      )
    );
  }
}

function idleSyncState(): SyncState {
  return { phase: 'idle', kind: null };
}

/** A rejected effective identity fences old reads; a transient network/provider error does not. */
function isAccessRejection(error: PullRequestError): boolean {
  return (
    error.type === 'github_disabled' ||
    error.type === 'github_account_not_found' ||
    error.type === 'github_account_host_mismatch' ||
    error.type === 'github_token_missing' ||
    error.type === 'github_auth_required' ||
    error.type === 'ghes_auth_required'
  );
}

function projectDetails(value: PullRequestDetails, comments: boolean): PullRequestDetails {
  const old = (time: number | null | undefined) =>
    time == null || Date.now() - time >= FRESHNESS_MS;
  const errors = {
    ...value.errors,
  };
  if (!comments) delete errors.comments;
  return {
    ...value,
    comments: comments ? value.comments : [],
    commentsFetchedAt: comments ? value.commentsFetchedAt : null,
    errors,
    stale:
      old(value.pr?.metadataFetchedAt) ||
      old(value.pr?.checksFetchedAt) ||
      Boolean(errors.metadata || errors.checks) ||
      (comments && (old(value.commentsFetchedAt) || Boolean(errors.comments))),
  };
}

function detailRefreshOutcome(
  result: Result<PullRequestDetails, PullRequestError>,
  comments: boolean
): SyncResult {
  if (!result.success) return result;
  const failure =
    result.data.errors.metadata ??
    result.data.errors.checks ??
    (comments ? result.data.errors.comments : undefined);
  return failure ? err(failure) : ok();
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
