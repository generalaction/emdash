import { computed, makeObservable, reaction } from 'mobx';
import { gitRefChangedChannel, type GitRefChange } from '@shared/events/gitEvents';
import type {
  LocalBranch,
  LocalBranchesPayload,
  Remote,
  RemoteBranch,
  RemoteBranchesPayload,
} from '@shared/git';
import { bareRefName, computeDefaultBranch, selectPreferredRemote } from '@shared/git-utils';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import { isGitHubUrl, normalizeGitHubUrl } from '@renderer/utils/github/utils';
import type { ProjectSettingsStore } from './project-settings-store';

export class RepositoryStore {
  readonly localData: Resource<LocalBranchesPayload, GitRefChange>;
  readonly remoteData: Resource<RemoteBranchesPayload, GitRefChange>;

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
              if (workspaceId ? p.workspaceId !== workspaceId : p.workspaceId !== undefined) return;
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
              if (workspaceId ? p.workspaceId !== workspaceId : p.workspaceId !== undefined) return;
              if (p.kind === 'remote-refs' || p.kind === 'config') handler(p);
            }),
          onEvent: 'reload',
          debounceMs: 300,
        },
      ]
    );

    // Activate event strategies — demand is wired in Resource constructor, event strategies are not.
    this.localData.start();
    this.remoteData.start();

    // Invalidate remote data when settings that affect remote resolution change.
    this._settingsDisposer = reaction(
      () => [settingsStore.settings?.remote, settingsStore.settings?.defaultBranch],
      () => this.remoteData.invalidate()
    );

    makeObservable(this, {
      isUnborn: computed,
      currentBranch: computed,
      branches: computed,
      localBranches: computed,
      remoteBranches: computed,
      configuredRemote: computed,
      defaultBranchName: computed,
      defaultBranch: computed,
      remotes: computed,
      loading: computed,
      isGitHubRemote: computed,
      repositoryUrl: computed,
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

  get configuredRemote(): Remote {
    const setting = this.settingsStore.settings?.remote;
    const remotes = this.remoteData.data?.remotes ?? [];
    return selectPreferredRemote(setting, remotes);
  }

  get remotes(): Remote[] {
    return this.remoteData.data?.remotes ?? [];
  }

  /** True when the configured remote points to a GitHub.com repository. */
  get isGitHubRemote(): boolean {
    const url = this.configuredRemote.url;
    return !!url && isGitHubUrl(url);
  }

  /**
   * The normalised HTTPS GitHub URL for the configured remote
   * (e.g. `https://github.com/owner/repo`), or `null` if not a GitHub remote.
   */
  get repositoryUrl(): string | null {
    const url = this.configuredRemote.url;
    if (!url || !isGitHubUrl(url)) return null;
    return normalizeGitHubUrl(url);
  }

  get defaultBranchName(): string {
    const d = this.remoteData.data;
    if (!d) return 'main';
    const raw = this.settingsStore.settings?.defaultBranch;
    const configured =
      raw === undefined ? bareRefName(this.baseRef) : typeof raw === 'string' ? raw : raw.name;
    return computeDefaultBranch(
      configured,
      this.branches,
      this.configuredRemote.name,
      d.gitDefaultBranch
    );
  }

  get defaultBranch(): LocalBranch | RemoteBranch | undefined {
    const name = this.defaultBranchName;
    const raw = this.settingsStore.settings?.defaultBranch;
    const isRemotePref = typeof raw === 'object' && raw.remote === true;

    if (isRemotePref) {
      const remote = this.remoteBranches.find(
        (b) => b.branch === name && b.remote.name === this.configuredRemote.name
      );
      if (remote) return remote;
    }
    const local = this.localBranches.find((b) => b.branch === name);
    if (local) return local;
    return this.remoteBranches.find((b) => b.branch === name);
  }

  isDefault(branch: LocalBranch | RemoteBranch): boolean {
    return branch.branch === this.defaultBranchName;
  }

  isBranchOnRemote(branchName: string): boolean {
    const remoteName = this.configuredRemote.name;
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
  }

  /** Refresh both — for call-sites that don't know which half changed. */
  refresh(): void {
    this.localData.invalidate();
    this.remoteData.invalidate();
  }

  dispose(): void {
    this.localData.dispose();
    this.remoteData.dispose();
    this._settingsDisposer?.();
    this._settingsDisposer = null;
  }
}
