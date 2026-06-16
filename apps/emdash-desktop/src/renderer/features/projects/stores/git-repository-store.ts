import type {
  GitBranchRef,
  GitRepoSnapshot,
  GitRefsModel,
  GitRemote,
  GitRemotesModel,
  LocalBranch,
  RemoteBranch,
} from '@emdash/shared/git';
import { computed, makeObservable, reaction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { bindMirror, coalesce, ModelMirror, type MirrorBinding } from '@renderer/lib/stores/live';
import { Resource } from '@renderer/lib/stores/resource';
import { gitRepoUpdateChannel } from '@shared/core/git/events';
import type { GitDefaultBranchResult, GitRepositorySnapshotError } from '@shared/core/git/rpc';
import type { ConfiguredRemotes } from '@shared/core/git/types';
import {
  projectDefaultBranchToBranch,
  resolveConfiguredRemotes,
  resolveDefaultBranch,
} from '@shared/core/git/utils';
import { err, ok, type Result } from '@shared/lib/result';
import type { ProviderRepository, ProviderRepositoryResult } from '@shared/provider-repository';
import { parseRepositoryRef } from '@shared/repository-ref';
import type { ProjectSettingsStore } from './project-settings-store';

export class GitRepositoryStore {
  private readonly refs = new ModelMirror<GitRefsModel>();
  private readonly remotesModel = new ModelMirror<GitRemotesModel>();
  private readonly bindings: MirrorBinding[];
  readonly providerRepositoryInfo: Resource<ProviderRepositoryResult>;
  readonly gitDefaultBranchInfo: Resource<GitDefaultBranchResult>;

  private settingsDisposer: (() => void) | null = null;
  private started = false;

  constructor(
    private readonly projectId: string,
    private readonly settingsStore: ProjectSettingsStore,
    private readonly baseRef: string
  ) {
    const snapshot = coalesce(
      async (): Promise<Result<GitRepoSnapshot, GitRepositorySnapshotError>> => {
        const result = await rpc.gitRepository.getRepoSnapshot(this.projectId);
        if (!result.success) return err(result.error);
        return ok(result.data);
      }
    );
    this.bindings = [
      bindMirror<GitRefsModel, GitRepositorySnapshotError>({
        mirror: this.refs,
        subscribe: (push) =>
          events.on(gitRepoUpdateChannel, (payload) => {
            if (payload.projectId === this.projectId && payload.update.kind === 'refs') {
              push({
                value: payload.update.model,
                sequence: payload.update.sequence,
                generation: payload.update.generation,
              });
            }
          }),
        snapshot: async () => {
          const result = await snapshot();
          return result.success ? ok(result.data.refs) : err(result.error);
        },
      }),
      bindMirror<GitRemotesModel, GitRepositorySnapshotError>({
        mirror: this.remotesModel,
        subscribe: (push) =>
          events.on(gitRepoUpdateChannel, (payload) => {
            if (payload.projectId === this.projectId && payload.update.kind === 'remotes') {
              push({
                value: payload.update.model,
                sequence: payload.update.sequence,
                generation: payload.update.generation,
              });
            }
          }),
        snapshot: async () => {
          const result = await snapshot();
          return result.success ? ok(result.data.remotes) : err(result.error);
        },
      }),
    ];

    this.providerRepositoryInfo = new Resource<ProviderRepositoryResult>(
      () => rpc.gitRepository.resolveProviderRepository(projectId),
      [{ kind: 'demand' }]
    );
    this.gitDefaultBranchInfo = new Resource<GitDefaultBranchResult>(
      () => rpc.gitRepository.getDefaultBranch(projectId),
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

    makeObservable<this, 'configuredRemotes' | 'defaultBranchPreference' | 'gitDefaultBranch'>(
      this,
      {
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
      }
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const binding of this.bindings) binding.start();
    this.providerRepositoryInfo.start();
    this.gitDefaultBranchInfo.start();
  }

  async resync(): Promise<void> {
    await Promise.all(this.bindings.map((binding) => binding.resync()));
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
    for (const binding of this.bindings) binding.dispose();
    this.refs.dispose();
    this.remotesModel.dispose();
    this.providerRepositoryInfo.dispose();
    this.gitDefaultBranchInfo.dispose();
    this.settingsDisposer?.();
    this.settingsDisposer = null;
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
        gitDefaultBranch: this.gitDefaultBranch ?? 'main',
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

  get baseRemote(): GitRemote {
    return this.configuredRemotes.baseRemote;
  }

  get pushRemote(): GitRemote {
    return this.configuredRemotes.pushRemote;
  }

  get remotes(): GitRemote[] {
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
    const remoteName = this.pushRemote.name;
    return this.remoteBranches.some(
      (branch) => branch.branch === branchName && branch.remote.name === remoteName
    );
  }

  getBranchDivergence(branchName: string): { ahead: number; behind: number } | null {
    return this.localBranches.find((branch) => branch.branch === branchName)?.divergence ?? null;
  }

  fetchRemote() {
    return rpc.gitRepository.fetch(this.projectId);
  }

  publishBranch(branchName: string, workspaceId?: string) {
    return rpc.gitRepository.publishBranch(
      this.projectId,
      branchName,
      this.pushRemote.name,
      workspaceId
    );
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
    return result?.success ? result.data.defaultBranch : undefined;
  }
}
