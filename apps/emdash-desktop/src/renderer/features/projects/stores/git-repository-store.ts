import {
  gitContract,
  type GitBranchRef,
  type FetchPrForReviewOptions,
  type GitRefsState,
  type GitRemote,
  type GitRemotesState,
  type LocalBranch,
  type RemoteBranch,
} from '@emdash/core/git';
import { createLiveModelReplica, type LiveModelReplica, type ReplicaInstance } from '@emdash/wire';
import { createImmutableMobxStore } from '@emdash/wire/util/mobx';
import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { rpc } from '@renderer/lib/ipc';
import { repositorySelector, runRuntimeJob } from '@renderer/lib/runtime/git';
import { getGitRuntimeClient } from '@renderer/lib/runtime/git-client';
import { Resource } from '@renderer/lib/stores/resource';
import type { ConfiguredRemotes } from '@shared/core/git/types';
import {
  projectDefaultBranchToBranch,
  resolveConfiguredRemotes,
  resolveDefaultBranch,
} from '@shared/core/git/utils';
import type { ProviderRepository, ProviderRepositoryResult } from '@shared/provider-repository';
import { parseRepositoryRef } from '@shared/repository-ref';
import type { ProjectSettingsStore } from './project-settings-store';

type RepositoryModel = typeof gitContract.repository.model;

export class GitRepositoryStore {
  private replica: LiveModelReplica<RepositoryModel> | null = null;
  private model: ReplicaInstance<RepositoryModel> | null = null;
  private releaseModel: (() => Promise<void>) | null = null;
  private startPromise: Promise<void> | null = null;
  private started = false;
  private loadError: string | null = null;

  readonly providerRepositoryInfo: Resource<ProviderRepositoryResult>;
  readonly gitDefaultBranchInfo: Resource<Awaited<ReturnType<typeof loadDefaultBranch>>>;
  private settingsDisposer: (() => void) | null = null;

  constructor(
    private readonly projectId: string,
    private readonly projectPath: string,
    private readonly settingsStore: ProjectSettingsStore,
    private readonly baseRef: string
  ) {
    this.providerRepositoryInfo = new Resource<ProviderRepositoryResult>(
      () => rpc.repository.resolveProvider(projectId),
      [{ kind: 'demand' }]
    );
    this.gitDefaultBranchInfo = new Resource(
      () => loadDefaultBranch(this.projectPath, this.baseRemote.name),
      [{ kind: 'demand' }]
    );
    this.settingsDisposer = reaction(
      () => [
        settingsStore.settings?.baseRemote,
        settingsStore.settings?.pushRemote,
        settingsStore.settings?.defaultBranch,
      ],
      () => {
        this.gitDefaultBranchInfo.invalidate();
        this.providerRepositoryInfo.invalidate();
      }
    );
    makeObservable<
      GitRepositoryStore,
      'model' | 'loadError' | 'configuredRemotes' | 'defaultBranchPreference' | 'gitDefaultBranch'
    >(this, {
      model: observable.ref,
      loadError: observable,
      branches: computed,
      localBranches: computed,
      remoteBranches: computed,
      configuredRemotes: computed,
      baseRemote: computed,
      pushRemote: computed,
      defaultBranchPreference: computed,
      defaultBranch: computed,
      remotes: computed,
      loading: computed,
      canonicalRepositoryUrl: computed,
      providerRepository: computed,
      pullRequestRepositoryUrl: computed,
      issueRepositoryUrl: computed,
      gitDefaultBranch: computed,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.providerRepositoryInfo.start();
    this.gitDefaultBranchInfo.start();
    void this.ensureStarted();
  }

  async resync(): Promise<void> {
    await this.ensureStarted();
    const model = this.model;
    if (!model) return;
    await Promise.all([model.states.refs.refresh(), model.states.remotes.refresh()]);
  }

  refreshLocal(): void {
    void this.resync();
  }

  refreshRemote(): void {
    void this.resync();
    this.providerRepositoryInfo.invalidate();
    this.gitDefaultBranchInfo.invalidate();
  }

  refresh(): void {
    this.refreshRemote();
  }

  dispose(): void {
    this.started = false;
    this.providerRepositoryInfo.dispose();
    this.gitDefaultBranchInfo.dispose();
    this.settingsDisposer?.();
    this.settingsDisposer = null;
    const release = this.releaseModel;
    const replica = this.replica;
    this.releaseModel = null;
    this.replica = null;
    this.model = null;
    void (async () => {
      try {
        await release?.();
      } finally {
        await replica?.dispose();
      }
    })();
  }

  get loading(): boolean {
    return this.model === null && this.loadError === null;
  }

  get localData() {
    return {
      loading: this.loading,
      data: { localBranches: this.localBranches },
      load: () => this.resync(),
    };
  }

  get remoteData() {
    return {
      loading: this.loading,
      data: {
        remoteBranches: this.remoteBranches,
        remotes: this.remotes,
        gitDefaultBranch: this.gitDefaultBranch ?? 'main',
      },
      load: () => this.resync(),
    };
  }

  get branches(): (LocalBranch | RemoteBranch)[] {
    return this.refs?.branches ?? [];
  }

  get localBranches(): LocalBranch[] {
    return this.branches.filter((branch): branch is LocalBranch => branch.type === 'local');
  }

  get remoteBranches(): RemoteBranch[] {
    return this.branches.filter((branch): branch is RemoteBranch => branch.type === 'remote');
  }

  get baseRemote(): GitRemote {
    return this.configuredRemotes.baseRemote;
  }

  get pushRemote(): GitRemote {
    return this.configuredRemotes.pushRemote;
  }

  get remotes(): GitRemote[] {
    return this.remotesState?.remotes ?? [];
  }

  get canonicalRepositoryUrl(): string | null {
    return parseRepositoryRef(this.baseRemote.url)?.repositoryUrl ?? null;
  }

  get providerRepository(): ProviderRepository | null {
    const result = this.providerRepositoryInfo.data;
    return result?.success ? result.data : null;
  }

  get pullRequestRepositoryUrl(): string | null {
    const repository = this.providerRepository;
    return repository?.capabilities.pullRequests ? repository.repositoryUrl : null;
  }

  get issueRepositoryUrl(): string | null {
    const repository = this.providerRepository;
    return repository?.capabilities.issues ? repository.repositoryUrl : null;
  }

  get defaultBranch(): LocalBranch | RemoteBranch | undefined {
    return resolveDefaultBranch({
      preference: this.defaultBranchPreference,
      branches: this.branches,
      configuredRemoteName: this.baseRemote.name,
      gitDefaultBranch: this.gitDefaultBranch,
      baseRef: this.baseRef,
    });
  }

  isBranchOnRemote(branchName: string): boolean {
    return this.remoteBranches.some(
      (branch) => branch.branch === branchName && branch.remote.name === this.pushRemote.name
    );
  }

  getBranchDivergence(branchName: string): { ahead: number; behind: number } | null {
    return this.localBranches.find((branch) => branch.branch === branchName)?.divergence ?? null;
  }

  async fetchRemote() {
    const client = await getGitRuntimeClient();
    return runRuntimeJob(gitContract.repository.fetch, client.repository.fetch, {
      ...repositorySelector(this.projectPath),
      remote: this.baseRemote.name,
    });
  }

  async addRemote(name: string, url: string) {
    const model = await this.requireModel();
    const invocation = await model.mutations.addRemote({ name, url });
    if (invocation.result.success) await invocation.settled;
    return invocation.result;
  }

  async publishBranch(branchName: string, _workspaceId?: string) {
    const client = await getGitRuntimeClient();
    return runRuntimeJob(gitContract.repository.publishBranch, client.repository.publishBranch, {
      ...repositorySelector(this.projectPath),
      branchName,
      remote: this.pushRemote.name,
    });
  }

  async fetchPrForReview(options: FetchPrForReviewOptions) {
    const client = await getGitRuntimeClient();
    return runRuntimeJob(
      gitContract.repository.fetchPrForReview,
      client.repository.fetchPrForReview,
      { ...repositorySelector(this.projectPath), options }
    );
  }

  private get refs(): GitRefsState | null {
    return this.model?.states.refs.current() ?? null;
  }

  private get remotesState(): GitRemotesState | null {
    return this.model?.states.remotes.current() ?? null;
  }

  private get configuredRemotes(): ConfiguredRemotes {
    return resolveConfiguredRemotes(this.settingsStore.settings ?? undefined, this.remotes);
  }

  private get defaultBranchPreference(): GitBranchRef | undefined {
    return projectDefaultBranchToBranch(
      this.settingsStore.settings?.defaultBranch,
      this.baseRemote,
      this.remotes
    );
  }

  private get gitDefaultBranch(): string | undefined {
    const result = this.gitDefaultBranchInfo.data;
    return result?.success ? result.data : undefined;
  }

  private ensureStarted(): Promise<void> {
    this.startPromise ??= this.bindRuntime();
    return this.startPromise;
  }

  private async requireModel(): Promise<ReplicaInstance<RepositoryModel>> {
    await this.ensureStarted();
    if (!this.model) throw new Error(this.loadError ?? 'Git repository is unavailable');
    return this.model;
  }

  private async bindRuntime(): Promise<void> {
    try {
      const client = await getGitRuntimeClient();
      const replica = createLiveModelReplica(
        gitContract.repository.model,
        client.repository.model,
        {
          stores: {
            refs: createImmutableMobxStore,
            remotes: createImmutableMobxStore,
            stashes: createImmutableMobxStore,
            worktrees: createImmutableMobxStore,
          },
        }
      );
      const lease = replica.acquire(repositorySelector(this.projectPath));
      const model = await lease.ready();
      if (!this.started) {
        await lease.release();
        await replica.dispose();
        return;
      }
      runInAction(() => {
        this.replica = replica;
        this.releaseModel = () => lease.release();
        this.model = model;
        this.loadError = null;
      });
    } catch (error) {
      runInAction(() => {
        this.loadError = error instanceof Error ? error.message : String(error);
      });
    }
  }
}

async function loadDefaultBranch(projectPath: string, remote: string) {
  const client = await getGitRuntimeClient();
  const result = await client.repository.getDefaultBranch({
    ...repositorySelector(projectPath),
    remote,
  });
  return result.success ? { success: true as const, data: result.data } : result;
}
