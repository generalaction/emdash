import { createLiveModelReplica } from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import { OptimisticLiveModel } from '@emdash/wire/util/mobx';
import { action, makeObservable, observable, reaction, runInAction } from 'mobx';
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

type SyncModel = OptimisticLiveModel<typeof pullRequestsContract.syncState>;
type ModelEntry = {
  model: SyncModel;
  disposeReaction: () => void;
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

  private readonly syncModels = new Map<string, ModelEntry>();
  private filterOptionsRequest = 0;
  private disposed = false;

  constructor(
    readonly client: ContractClient<PullRequestsContract>,
    repositoryUrls: string[]
  ) {
    this.repositoryUrls = unique(repositoryUrls);
    this.listView = createPullRequestListView({
      client,
      getRepositoryUrls: () => this.repositoryUrls,
    });
    makeObservable<this, 'syncModels'>(this, {
      repositoryUrls: observable.ref,
      filterOptions: observable.ref,
      syncModels: observable.shallow,
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
    return this.syncModels.get(normalizedUrl)?.model.values.state;
  }

  async reload(): Promise<void> {
    await Promise.all([this.listView.store.reload(), this.loadFilterOptions()]);
  }

  async registerRepository(repositoryUrl: string, accountId?: string) {
    const normalizedUrl = normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl;
    const result = await this.client.registerRepository({
      repositoryUrl: normalizedUrl,
      accountId,
    });
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

  async sync(repositoryUrl: string, forceFull = false) {
    const normalizedUrl = normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl;
    return forceFull
      ? await this.client.forceFullSync({ repositoryUrl: normalizedUrl })
      : await this.client.sync({ repositoryUrl: normalizedUrl });
  }

  async syncAll(): Promise<void> {
    await Promise.all(
      this.repositoryUrls.map(async (repositoryUrl) => {
        await this.client.sync({ repositoryUrl });
      })
    );
  }

  async cancelSync(repositoryUrl: string) {
    return await this.client.cancelSync({
      repositoryUrl: normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl,
    });
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

  async getPullRequestComments(repositoryUrl: string, number: number) {
    return await this.client.getPullRequestComments({
      repositoryUrl: normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl,
      number,
    });
  }

  async syncChecks(repositoryUrl: string, pullRequestUrl: string, headRefOid: string) {
    return await this.client.syncChecks({
      repositoryUrl: normalizeRepositoryUrl(repositoryUrl) ?? repositoryUrl,
      pullRequestUrl,
      headRefOid,
    });
  }

  async refresh(repositoryUrl: string, number: number) {
    return await this.client.syncSingle({
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
    this.filterOptionsRequest++;
    this.listView.store.dispose();
    const entries = [...this.syncModels.values()];
    this.syncModels.clear();
    for (const entry of entries) entry.disposeReaction();
    await Promise.all(entries.map(async ({ model }) => await model.dispose()));
  }

  private async initialize(): Promise<void> {
    await Promise.all([this.reconcileSyncModels(), this.loadFilterOptions()]);
  }

  private async reconcileSyncModels(): Promise<void> {
    const wanted = new Set(this.repositoryUrls);
    const removals: Promise<void>[] = [];
    for (const [repositoryUrl, entry] of this.syncModels) {
      if (wanted.has(repositoryUrl)) continue;
      entry.disposeReaction();
      this.syncModels.delete(repositoryUrl);
      removals.push(entry.model.dispose());
    }
    const additions: Promise<void>[] = [];
    for (const repositoryUrl of wanted) {
      if (this.syncModels.has(repositoryUrl)) continue;
      const replica = createLiveModelReplica(pullRequestsContract.syncState, this.client.syncState);
      const model = new OptimisticLiveModel(
        pullRequestsContract.syncState,
        { repositoryUrl },
        replica
      );
      let previousLastSyncedAt: number | undefined;
      const disposeReaction = reaction(
        () => model.values.state,
        (state) => {
          if (
            state?.phase === 'idle' &&
            state.lastSyncedAt !== undefined &&
            state.lastSyncedAt !== previousLastSyncedAt
          ) {
            previousLastSyncedAt = state.lastSyncedAt;
            void this.reload();
          }
        }
      );
      this.syncModels.set(repositoryUrl, { model, disposeReaction });
      additions.push(model.ready);
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
