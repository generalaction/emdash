import type { GitRefsModel, GitRemotesModel } from '@emdash/shared/git';
import { computed, makeObservable, reaction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { bindMirror, ModelMirror, type MirrorBinding } from '@renderer/lib/stores/live';
import { Resource } from '@renderer/lib/stores/resource';
import type { Branch, LocalBranch, Remote, RemoteBranch } from '@shared/core/git/git';
import {
  projectDefaultBranchToBranch,
  resolveConfiguredRemotes,
  resolveDefaultBranch,
  type ConfiguredRemotes,
} from '@shared/core/git/git-utils';
import { gitRepoUpdateChannel } from '@shared/core/git/gitEvents';
import type { ProviderRepository, ProviderRepositoryResult } from '@shared/provider-repository';
import { parseRepositoryRef } from '@shared/repository-ref';
import type { ProjectSettingsStore } from './project-settings-store';

export class GitRepositoryStore {
  private readonly refs = new ModelMirror<GitRefsModel>();
  private readonly remotesModel = new ModelMirror<GitRemotesModel>();
  private readonly bindings: MirrorBinding[];
  readonly providerRepositoryInfo: Resource<ProviderRepositoryResult>;
  readonly gitDefaultBranchInfo: Resource<string>;

  private settingsDisposer: (() => void) | null = null;

  constructor(
    private readonly projectId: string,
    private readonly settingsStore: ProjectSettingsStore,
    private readonly baseRef: string
  ) {
    this.bindings = [
      bindMirror({
        mirror: this.refs,
        subscribe: (push) =>
          events.on(gitRepoUpdateChannel, (payload) => {
            if (payload.projectId === this.projectId && payload.update.kind === 'refs') {
              push({ value: payload.update.model, seq: payload.update.seq });
            }
          }),
        snapshot: async () => {
          const result = await rpc.gitRepository.getRepoSnapshot(this.projectId);
          if (!result.success) throw new Error(result.error.type);
          return result.data.refs;
        },
      }),
      bindMirror({
        mirror: this.remotesModel,
        subscribe: (push) =>
          events.on(gitRepoUpdateChannel, (payload) => {
            if (payload.projectId === this.projectId && payload.update.kind === 'remotes') {
              push({ value: payload.update.model, seq: payload.update.seq });
            }
          }),
        snapshot: async () => {
          const result = await rpc.gitRepository.getRepoSnapshot(this.projectId);
          if (!result.success) throw new Error(result.error.type);
          return result.data.remotes;
        },
      }),
    ];

    this.providerRepositoryInfo = new Resource<ProviderRepositoryResult>(
      () => rpc.gitRepository.resolveProviderRepository(projectId),
      [{ kind: 'demand' }]
    );
    this.gitDefaultBranchInfo = new Resource<string>(
      async () => (await rpc.gitRepository.getRemoteBranches(projectId)).gitDefaultBranch,
      [{ kind: 'demand' }]
    );

    for (const binding of this.bindings) binding.start();
    this.providerRepositoryInfo.start();
    this.gitDefaultBranchInfo.start();

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

    makeObservable<this, 'configuredRemotes' | 'defaultBranchPreference'>(this, {
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
      pushRepositoryUrl: computed,
    });
  }

  get loading(): boolean {
    return this.refs.value === null || this.remotesModel.value === null;
  }

  get localData() {
    return {
      loading: this.loading,
      data: {
        localBranches: this.localBranches,
      },
      load: () => this.resync(),
    };
  }

  get remoteData() {
    return {
      loading: this.loading,
      data: {
        remoteBranches: this.remoteBranches,
        remotes: this.remotes,
        gitDefaultBranch: this.gitDefaultBranchInfo.data ?? 'main',
      },
      load: () => this.resync(),
    };
  }

  get branches(): (LocalBranch | RemoteBranch)[] {
    return (this.refs.value?.branches as (LocalBranch | RemoteBranch)[] | undefined) ?? [];
  }

  get localBranches(): LocalBranch[] {
    return this.branches.filter((branch): branch is LocalBranch => branch.type === 'local');
  }

  get remoteBranches(): RemoteBranch[] {
    return this.branches.filter((branch): branch is RemoteBranch => branch.type === 'remote');
  }

  private get configuredRemotes(): ConfiguredRemotes {
    return resolveConfiguredRemotes(this.settingsStore.settings ?? undefined, this.remotes);
  }

  get baseRemote(): Remote {
    return this.configuredRemotes.baseRemote;
  }

  get pushRemote(): Remote {
    return this.configuredRemotes.pushRemote;
  }

  get remotes(): Remote[] {
    return this.remotesModel.value?.remotes ?? [];
  }

  get canonicalRepositoryUrl(): string | null {
    const url = this.baseRemote.url;
    return parseRepositoryRef(url)?.repositoryUrl ?? null;
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

  get pushRepositoryUrl(): string | null {
    const url = this.pushRemote.url;
    return parseRepositoryRef(url)?.repositoryUrl ?? null;
  }

  private get defaultBranchPreference(): Branch | undefined {
    return projectDefaultBranchToBranch(
      this.settingsStore.settings?.defaultBranch,
      this.baseRemote,
      this.remotes
    );
  }

  get defaultBranch(): LocalBranch | RemoteBranch | undefined {
    return resolveDefaultBranch({
      preference: this.defaultBranchPreference,
      branches: this.branches,
      configuredRemoteName: this.baseRemote.name,
      gitDefaultBranch: this.gitDefaultBranchInfo.data ?? undefined,
      baseRef: this.baseRef,
    });
  }

  isDefault(branch: LocalBranch | RemoteBranch): boolean {
    const defaultBranch = this.defaultBranch;
    if (!defaultBranch) return false;
    if (branch.type !== defaultBranch.type) return false;
    if (branch.type === 'remote' && defaultBranch.type === 'remote') {
      return (
        branch.branch === defaultBranch.branch && branch.remote.name === defaultBranch.remote.name
      );
    }
    return branch.branch === defaultBranch.branch;
  }

  isBranchOnRemote(branchName: string): boolean {
    const remoteName = this.pushRemote.name;
    return this.remoteBranches.some(
      (branch) => branch.branch === branchName && branch.remote.name === remoteName
    );
  }

  getBranchDivergence(branchName: string): { ahead: number; behind: number } | null {
    return this.localBranches.find((branch) => branch.branch === branchName)?.divergence ?? null;
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

  async resync(): Promise<void> {
    await Promise.all(this.bindings.map((binding) => binding.resync()));
  }

  dispose(): void {
    for (const binding of this.bindings) binding.dispose();
    this.refs.dispose();
    this.remotesModel.dispose();
    this.providerRepositoryInfo.dispose();
    this.gitDefaultBranchInfo.dispose();
    this.settingsDisposer?.();
    this.settingsDisposer = null;
  }
}
