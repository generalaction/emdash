import { createScope, type Scope } from '@emdash/shared/concurrency';
import type { ContractClient } from '@emdash/wire/rpc';
import { observe, remote, whenReady, type RemoteModel } from '@emdash/wire/state';
import { action, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeRepositoryUrl,
  pullRequestsContract,
  type CreatePullRequestInput,
  type PullRequestError,
  type PullRequestFilterOptions,
  type PullRequestMergeOptions,
  type PullRequestsContract,
  type SyncState,
} from '../api';
import { createPullRequestListView } from './pull-request-list-view';

type SyncRemote = RemoteModel<typeof pullRequestsContract.syncState>;
type ModelEntry = {
  scope: Scope;
  state: SyncState | undefined;
  previousRevision: number | undefined;
};
type HistoryRun = {
  controller: AbortController;
  promise: ReturnType<ContractClient<PullRequestsContract>['refreshHistory']>;
  cancelling: boolean;
};

const EMPTY_FILTER_OPTIONS: PullRequestFilterOptions = {
  authors: [],
  labels: [],
  assignees: [],
};

export class PullRequestsStore {
  repositoryUrls: string[];
  filterOptions: PullRequestFilterOptions = EMPTY_FILTER_OPTIONS;
  readonly listView;
  readonly ready: Promise<void>;

  private readonly scope = createScope({ label: 'pull-requests-store' });
  private readonly syncRemote: SyncRemote;
  private readonly syncModels = new Map<string, ModelEntry>();
  private readonly historyRuns = new Map<string, HistoryRun>();
  private filterOptionsRequest = 0;
  private disposed = false;

  constructor(
    readonly client: ContractClient<PullRequestsContract>,
    repositoryUrls: string[]
  ) {
    this.repositoryUrls = unique(repositoryUrls);
    this.syncRemote = remote(pullRequestsContract.syncState, client.syncState, {
      scope: this.scope,
      lingerMs: 15_000,
    });
    this.listView = createPullRequestListView({
      client,
      getRepositoryUrls: () => this.repositoryUrls,
    });
    makeObservable<this, 'syncModels' | 'historyRuns'>(this, {
      repositoryUrls: observable.ref,
      filterOptions: observable.ref,
      syncModels: observable.shallow,
      historyRuns: observable.shallow,
      setRepositoryUrls: action,
    });
    this.ready = this.initialize();
  }

  setRepositoryUrls(repositoryUrls: string[]): void {
    if (this.disposed) return;
    this.repositoryUrls = unique(repositoryUrls);
    void this.reconcileSyncModels();
    void this.loadFilterOptions();
    void this.listView.store.reload();
  }

  syncState(repositoryUrl: string): SyncState | undefined {
    const normalizedUrl = normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl;
    return this.syncModels.get(normalizedUrl)?.state;
  }

  async reload(): Promise<void> {
    await Promise.all([this.listView.store.reload(), this.loadFilterOptions()]);
  }

  async registerRepository(repositoryUrl: string) {
    const normalizedUrl = normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl;
    const result = await this.client.registerRepository({ repositoryUrl: normalizedUrl });
    if (result.success) this.setRepositoryUrls([...this.repositoryUrls, normalizedUrl]);
    return result;
  }

  async unregisterRepository(repositoryUrl: string) {
    const normalizedUrl = normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl;
    const result = await this.client.unregisterRepository({ repositoryUrl: normalizedUrl });
    if (result.success) {
      this.setRepositoryUrls(this.repositoryUrls.filter((url) => url !== normalizedUrl));
    }
    return result;
  }

  async refreshRepository(repositoryUrl: string) {
    const normalizedUrl = normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl;
    return await this.client.refreshRepository({ repositoryUrl: normalizedUrl, policy: 'force' });
  }

  refreshHistory(repositoryUrl: string): HistoryRun['promise'] {
    if (this.disposed) return Promise.reject(new Error('Pull request store is disposed'));
    const normalizedUrl = normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl;
    const existing = this.historyRuns.get(normalizedUrl);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = this.client
      .refreshHistory({ repositoryUrl: normalizedUrl }, { signal: controller.signal })
      .finally(() => {
        runInAction(() => {
          if (this.historyRuns.get(normalizedUrl)?.controller === controller)
            this.historyRuns.delete(normalizedUrl);
        });
      });
    runInAction(() => {
      this.historyRuns.set(normalizedUrl, { controller, promise, cancelling: false });
    });
    return promise;
  }

  canCancelHistory(repositoryUrl: string): boolean {
    const run = this.historyRuns.get(normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl);
    return run !== undefined && !run.cancelling;
  }

  cancelHistory(repositoryUrl: string): void {
    const normalizedUrl = normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl;
    const run = this.historyRuns.get(normalizedUrl);
    if (!run) return;
    runInAction(() => {
      this.historyRuns.set(normalizedUrl, { ...run, cancelling: true });
    });
    run.controller.abort();
  }

  async getPullRequestsForBranch(repositoryUrl: string, branch: string) {
    return await this.client.getPullRequestsForBranch({
      repositoryUrl: normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl,
      branch,
    });
  }

  async getPullRequestFiles(repositoryUrl: string, number: number) {
    return await this.client.getPullRequestFiles({
      repositoryUrl: normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl,
      number,
    });
  }

  async createPullRequest(input: CreatePullRequestInput) {
    const result = await this.client.createPullRequest({
      ...input,
      repositoryUrl: normalizeRepositoryUrl(input.repositoryUrl) ?? input.repositoryUrl,
    });
    if (result.success) await this.reload();
    return result;
  }

  async mergePullRequest(repositoryUrl: string, number: number, options: PullRequestMergeOptions) {
    const result = await this.client.mergePullRequest({
      repositoryUrl: normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl,
      number,
      options,
    });
    if (result.success) await this.reload();
    return result;
  }

  async markReadyForReview(repositoryUrl: string, number: number) {
    const result = await this.client.markReadyForReview({
      repositoryUrl: normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl,
      number,
    });
    if (result.success) await this.reload();
    return result;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const run of this.historyRuns.values()) run.controller.abort();
    runInAction(() => this.historyRuns.clear());
    this.filterOptionsRequest++;
    this.listView.store.dispose();
    const entries = [...this.syncModels.values()];
    this.syncModels.clear();
    await Promise.all(entries.map(async ({ scope }) => await scope.dispose()));
    await this.scope.dispose();
  }

  private async initialize(): Promise<void> {
    await Promise.all([this.reconcileSyncModels(), this.loadFilterOptions()]);
  }

  private async reconcileSyncModels(): Promise<void> {
    const wanted = new Set(this.repositoryUrls);
    const removals: Promise<void>[] = [];
    for (const [repositoryUrl, entry] of this.syncModels) {
      if (wanted.has(repositoryUrl)) continue;
      this.syncModels.delete(repositoryUrl);
      removals.push(entry.scope.dispose());
    }
    const additions: Promise<void>[] = [];
    for (const repositoryUrl of wanted) {
      if (this.syncModels.has(repositoryUrl)) continue;
      const scope = this.scope.child(`sync:${repositoryUrl}`);
      const entry: ModelEntry = {
        scope,
        state: undefined,
        previousRevision: undefined,
      };
      this.syncModels.set(repositoryUrl, entry);
      const member = this.syncRemote({ repositoryUrl });
      observe(
        member.states.state,
        (snapshot) => {
          const current = this.syncModels.get(repositoryUrl);
          if (!current) return;
          const state = snapshot.value;
          const previousRevision = current.previousRevision;
          const nextEntry = {
            ...current,
            state,
            previousRevision: state?.revision ?? current.previousRevision,
          };
          runInAction(() => {
            this.syncModels.set(repositoryUrl, nextEntry);
          });
          if (state?.revision !== undefined && state.revision !== previousRevision) {
            void this.reload();
          }
        },
        { scope }
      );
      additions.push(whenReady(member.states.state, { scope }).then(() => undefined));
    }
    await Promise.all([...removals, ...additions]);
  }

  private async loadFilterOptions(): Promise<void> {
    const request = ++this.filterOptionsRequest;
    const repositoryUrls = this.repositoryUrls;
    if (repositoryUrls.length === 0) {
      runInAction(() => {
        this.filterOptions = EMPTY_FILTER_OPTIONS;
      });
      return;
    }
    const result = await this.client.getFilterOptions({
      repositoryUrls,
    });
    if (!result.success || this.disposed || request !== this.filterOptionsRequest) return;
    runInAction(() => {
      this.filterOptions = result.data;
    });
  }
}

export type PullRequestStoreResult<T> =
  | { success: true; data: T }
  | { success: false; error: PullRequestError };

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeRepositoryUrl(value) ?? value))];
}
