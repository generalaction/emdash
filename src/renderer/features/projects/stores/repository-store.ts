import { computed, makeObservable, reaction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import { gitRefChangedChannel, type GitRefChange } from '@shared/events/gitEvents';
import type {
  Branch,
  LocalBranch,
  LocalBranchesPayload,
  Remote,
  RemoteBranch,
  RemoteBranchesPayload,
} from '@shared/git';
import {
  projectDefaultBranchToBranch,
  resolveConfiguredRemotes,
  resolveDefaultBranch,
  type ConfiguredRemotes,
} from '@shared/git-utils';
import type { ProviderRepository, ProviderRepositoryResult } from '@shared/provider-repository';
import { parseRepositoryRef } from '@shared/repository-ref';
import type { ProjectSettingsStore } from './project-settings-store';

export class RepositoryStore {
  readonly localData: Resource<LocalBranchesPayload, GitRefChange>;
  readonly remoteData: Resource<RemoteBranchesPayload, GitRefChange>;
  readonly providerRepositoryInfo: Resource<ProviderRepositoryResult, GitRefChange>;

  private _settingsDisposer: (() => void) | null = null;

  constructor(
    private readonly projectId: string,
    private readonly settingsStore: ProjectSettingsStore,
    private readonly baseRef: string,
    private readonly workspaceId?: string
  ) {
    this.localData = new Resource<LocalBranchesPayload, GitRefChange>(
      () => rpc.repository.getLocalBranches(projectId, workspaceId),
      [
        { kind: 'demand' },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitRefChangedChannel, (p) => {
              if (p.projectId !== projectId) return;
              if (p.workspaceId !== undefined && p.workspaceId !== workspaceId) return;
              if (p.kind === 'local-refs') handler(p);
            }),
          onEvent: 'reload',
          debounceMs: 200,
        },
      ]
    );

    this.remoteData = new Resource<RemoteBranchesPayload, GitRefChange>(
      () => rpc.repository.getRemoteBranches(projectId, workspaceId),
      [
        { kind: 'demand' },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitRefChangedChannel, (p) => {
              if (p.projectId !== projectId) return;
              if (p.workspaceId !== undefined && p.workspaceId !== workspaceId) return;
              if (p.kind === 'remote-refs' || p.kind === 'config') handler(p);
            }),
          onEvent: 'reload',
          debounceMs: 300,
        },
      ]
    );

    this.providerRepositoryInfo = new Resource<ProviderRepositoryResult, GitRefChange>(
      () => rpc.repository.resolveProviderRepository(projectId),
      [
        { kind: 'demand' },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitRefChangedChannel, (p) => {
              if (p.projectId !== projectId) return;
              if (workspaceId ? p.workspaceId !== workspaceId : p.workspaceId !== undefined) return;
              if (p.kind === 'config') handler(p);
            }),
          onEvent: 'reload',
          debounceMs: 300,
        },
      ]
    );

    // Activate event strategies — demand is wired in Resource constructor, event strategies are not.
    this.localData.start();
    this.remoteData.start();
    this.providerRepositoryInfo.start();

    // Invalidate remote data when settings that affect remote resolution change.
    this._settingsDisposer = reaction(
      () => [
        settingsStore.settings?.baseRemote,
        settingsStore.settings?.pushRemote,
        settingsStore.settings?.defaultBranch,
      ],
      () => {
        this.remoteData.invalidate();
        this.providerRepositoryInfo.invalidate();
      }
    );

    makeObservable<this, 'configuredRemotes' | 'defaultBranchPreference'>(this, {
      isUnborn: computed,
      currentBranch: computed,
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
    return this.localData.loading || this.remoteData.loading;
  }

  get isUnborn(): boolean {
    return this.localData.data?.isUnborn ?? false;
  }

  get currentBranch(): string | null {
    return this.localData.data?.currentBranch ?? null;
  }

  /** Combined local + remote branches, preserving the same shape as the old BranchesPayload.branches. */
  get branches(): (LocalBranch | RemoteBranch)[] {
    return [...this.localBranches, ...this.remoteBranches];
  }

  get localBranches(): LocalBranch[] {
    const d = this.localData.data;
    if (!d) return [];
    if (d.isUnborn && d.currentBranch) return [{ type: 'local', branch: d.currentBranch }];
    return d.localBranches;
  }

  get remoteBranches(): RemoteBranch[] {
    return this.remoteData.data?.remoteBranches ?? [];
  }

  private get configuredRemotes(): ConfiguredRemotes {
    const remotes = this.remoteData.data?.remotes ?? [];
    return resolveConfiguredRemotes(this.settingsStore.settings ?? undefined, remotes);
  }

  get baseRemote(): Remote {
    return this.configuredRemotes.baseRemote;
  }

  get pushRemote(): Remote {
    return this.configuredRemotes.pushRemote;
  }

  get remotes(): Remote[] {
    return this.remoteData.data?.remotes ?? [];
  }

  /**
   * The normalised HTTPS repository URL for the base remote
   * (e.g. `https://github.com/owner/repo`), or `null` if not parseable.
   */
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
    const d = this.remoteData.data;
    if (!d) return undefined;
    return resolveDefaultBranch({
      preference: this.defaultBranchPreference,
      branches: this.branches,
      configuredRemoteName: this.baseRemote.name,
      gitDefaultBranch: d.gitDefaultBranch,
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
    return this.remoteBranches.some((b) => b.branch === branchName && b.remote.name === remoteName);
  }

  getBranchDivergence(branchName: string): { ahead: number; behind: number } | null {
    return this.localBranches.find((b) => b.branch === branchName)?.divergence ?? null;
  }

  refreshLocal(): void {
    this.localData.invalidate();
  }

  refreshRemote(): void {
    this.remoteData.invalidate();
    this.providerRepositoryInfo.invalidate();
  }

  /** Refresh both — for call-sites that don't know which half changed. */
  refresh(): void {
    this.localData.invalidate();
    this.remoteData.invalidate();
    this.providerRepositoryInfo.invalidate();
  }

  dispose(): void {
    this.localData.dispose();
    this.remoteData.dispose();
    this.providerRepositoryInfo.dispose();
    this._settingsDisposer?.();
    this._settingsDisposer = null;
  }
}
