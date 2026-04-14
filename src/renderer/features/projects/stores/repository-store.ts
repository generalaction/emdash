import { computed, makeObservable, reaction } from 'mobx';
import { gitRefChangedChannel, type GitRefChange } from '@shared/events/gitEvents';
import type {
  LocalBranch,
  LocalBranchesPayload,
  RemoteBranch,
  RemoteBranchesPayload,
} from '@shared/git';
import { bareRefName, computeDefaultBranch, selectPreferredRemote } from '@shared/git-utils';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import type { ProjectSettingsStore } from './project-settings-store';

export class RepositoryStore {
  readonly localData: Resource<LocalBranchesPayload, GitRefChange>;
  readonly remoteData: Resource<RemoteBranchesPayload, GitRefChange>;

  private _settingsDisposer: (() => void) | null = null;

  constructor(
    private readonly projectId: string,
    private readonly settingsStore: ProjectSettingsStore,
    private readonly baseRef: string
  ) {
    this.localData = new Resource<LocalBranchesPayload, GitRefChange>(
      () => rpc.repository.getLocalBranches(projectId),
      [
        { kind: 'demand' },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitRefChangedChannel, (p) => {
              if (p.projectId === projectId && p.kind === 'local-refs') handler(p);
            }),
          onEvent: 'reload',
          debounceMs: 200,
        },
      ]
    );

    this.remoteData = new Resource<RemoteBranchesPayload, GitRefChange>(
      () => rpc.repository.getRemoteBranches(projectId),
      [
        { kind: 'demand' },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitRefChangedChannel, (p) => {
              if (p.projectId === projectId && (p.kind === 'remote-refs' || p.kind === 'config'))
                handler(p);
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
      remotes: computed,
    });
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

  get configuredRemote(): string {
    const setting = this.settingsStore.settings?.remote;
    const remotes = this.remoteData.data?.remotes ?? [];
    return selectPreferredRemote(setting, remotes);
  }

  get remotes(): { name: string; url: string }[] {
    return this.remoteData.data?.remotes ?? [];
  }

  get defaultBranchName(): string {
    const d = this.remoteData.data;
    if (!d) return 'main';
    const configured = this.settingsStore.settings?.defaultBranch ?? bareRefName(this.baseRef);
    return computeDefaultBranch(
      configured,
      this.localData.data?.localBranches ?? [],
      this.configuredRemote,
      d.gitDefaultBranch
    );
  }

  isDefault(branch: LocalBranch | RemoteBranch): boolean {
    return branch.branch === this.defaultBranchName;
  }

  isBranchOnRemote(branchName: string): boolean {
    const remote = this.configuredRemote;
    return this.remoteBranches.some((b) => b.branch === branchName && b.remote === remote);
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
