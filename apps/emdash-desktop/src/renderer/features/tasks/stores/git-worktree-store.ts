import {
  type GitChange,
  type GitHeadModel,
  type GitStatusModel,
  type GitWorktreeSnapshot,
} from '@emdash/shared/git';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import {
  bindMirror,
  coalesce,
  ModelMirror,
  OptimisticModel,
  type MirrorBinding,
  type MirrorBindingStatus,
} from '@renderer/lib/stores/live';
import { gitWorktreeUpdateChannel } from '@shared/core/git/events';
import type { GitWorktreeMutationResult, GitWorktreeSnapshotError } from '@shared/core/git/rpc';
import { err, ok, type Result } from '@shared/lib/result';
import {
  commitOptimistically,
  discardAllOptimistically,
  discardFilesOptimistically,
  stageAllOptimistically,
  stageFilesOptimistically,
  unstageAllOptimistically,
  unstageFilesOptimistically,
} from './git-status-optimistic-updates';

const TOO_MANY_FILES_MSG = 'Too many files changed to display';

export class GitWorktreeStore {
  private readonly status = new ModelMirror<GitStatusModel>();
  private readonly head = new ModelMirror<GitHeadModel>();
  private readonly optimisticStatus = new OptimisticModel<GitStatusModel>(this.status);
  private readonly bindings: MirrorBinding[];
  private started = false;
  private syncError: string | null = null;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly gitRepositoryStore: GitRepositoryStore
  ) {
    const snapshot = coalesce(
      async (): Promise<Result<GitWorktreeSnapshot, GitWorktreeSnapshotError>> => {
        const result = await rpc.workspace.gitWorktree.getWorktreeSnapshot(
          this.projectId,
          this.workspaceId
        );
        if (!result.success) return err(result.error);
        runInAction(() => {
          this.syncError = null;
        });
        return ok(result.data);
      }
    );
    const onError = (error: GitWorktreeSnapshotError) => {
      runInAction(() => {
        this.syncError = error.type === 'git_error' ? error.message : error.type;
      });
    };
    this.bindings = [
      bindMirror<GitStatusModel, GitWorktreeSnapshotError>({
        mirror: this.status,
        subscribe: (push) =>
          events.on(gitWorktreeUpdateChannel, (payload) => {
            if (payload.workspaceId === this.workspaceId && payload.update.kind === 'status') {
              push({
                value: payload.update.model,
                sequence: payload.update.sequence,
                generation: payload.update.generation,
              });
            }
          }),
        snapshot: async () => {
          const result = await snapshot();
          return result.success ? ok(result.data.status) : err(result.error);
        },
        onError,
      }),
      bindMirror<GitHeadModel, GitWorktreeSnapshotError>({
        mirror: this.head,
        subscribe: (push) =>
          events.on(gitWorktreeUpdateChannel, (payload) => {
            if (payload.workspaceId === this.workspaceId && payload.update.kind === 'head') {
              push({
                value: payload.update.model,
                sequence: payload.update.sequence,
                generation: payload.update.generation,
              });
            }
          }),
        snapshot: async () => {
          const result = await snapshot();
          return result.success ? ok(result.data.head) : err(result.error);
        },
        onError,
      }),
    ];

    makeObservable<this, 'effectiveStatus' | 'syncError'>(this, {
      syncError: observable,
      fileChanges: computed,
      stagedFileChanges: computed,
      unstagedFileChanges: computed,
      totalLinesAdded: computed,
      totalLinesDeleted: computed,
      hasData: computed,
      isLoading: computed,
      error: computed,
      isBranchPublished: computed,
      aheadCount: computed,
      behindCount: computed,
      branchName: computed,
      headKind: computed,
      headDisplay: computed,
      effectiveStatus: computed,
      syncStatus: computed,
      statusRevision: computed,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const binding of this.bindings) binding.start();
  }

  async resync(): Promise<void> {
    return Promise.all(this.bindings.map((binding) => binding.resync())).then(() => undefined);
  }

  dispose(): void {
    for (const binding of this.bindings) binding.dispose();
    this.started = false;
    this.optimisticStatus.dispose();
    this.status.dispose();
    this.head.dispose();
  }

  get statusRevision(): number {
    return Math.max(this.status.sequence, this.head.sequence);
  }

  get syncStatus(): MirrorBindingStatus {
    const statuses = this.bindings.map((binding) => binding.status);
    for (const status of ['error', 'syncing', 'idle'] as const) {
      if (statuses.includes(status)) return status;
    }
    return 'live';
  }

  get fileChanges(): GitChange[] {
    const map = new Map<string, { staged?: GitChange; unstaged?: GitChange }>();
    for (const change of this.stagedFileChanges) {
      map.set(change.path, { ...map.get(change.path), staged: change });
    }
    for (const change of this.unstagedFileChanges) {
      map.set(change.path, { ...map.get(change.path), unstaged: change });
    }
    const out: GitChange[] = [];
    for (const { staged, unstaged } of map.values()) {
      if (staged && unstaged) {
        out.push({
          path: staged.path,
          status: 'modified',
          additions: staged.additions + unstaged.additions,
          deletions: staged.deletions + unstaged.deletions,
        });
      } else if (staged) {
        out.push(staged);
      } else if (unstaged) {
        out.push(unstaged);
      }
    }
    return out;
  }

  get stagedFileChanges(): GitChange[] {
    const status = this.effectiveStatus;
    return status?.kind === 'ok' ? status.staged : [];
  }

  get unstagedFileChanges(): GitChange[] {
    const status = this.effectiveStatus;
    return status?.kind === 'ok' ? status.unstaged : [];
  }

  get totalLinesAdded(): number {
    const status = this.effectiveStatus;
    if (status?.kind !== 'ok') return 0;
    return status.stagedAdded + status.unstaged.reduce((sum, change) => sum + change.additions, 0);
  }

  get totalLinesDeleted(): number {
    const status = this.effectiveStatus;
    if (status?.kind !== 'ok') return 0;
    return (
      status.stagedDeleted + status.unstaged.reduce((sum, change) => sum + change.deletions, 0)
    );
  }

  get hasData(): boolean {
    return this.status.value !== null && this.head.value !== null;
  }

  get isLoading(): boolean {
    return !this.hasData;
  }

  get error(): string | undefined {
    const status = this.effectiveStatus;
    if (status?.kind === 'too-many-files') return TOO_MANY_FILES_MSG;
    if (status?.kind === 'error') return status.message;
    if (!this.hasData && this.syncStatus === 'error') {
      return this.syncError ?? 'Failed to load git status';
    }
    return undefined;
  }

  get branchName(): string | null {
    const head = this.head.value;
    if (!head || head.kind === 'detached') return null;
    return head.name;
  }

  get headKind(): 'branch' | 'detached' | 'unborn' {
    return this.head.value?.kind ?? 'branch';
  }

  get headDisplay(): string | null {
    const head = this.head.value;
    if (!head) return null;
    return head.kind === 'detached' ? head.shortHash : head.name;
  }

  get isBranchPublished(): boolean {
    const name = this.branchName;
    return name ? this.gitRepositoryStore.isBranchOnRemote(name) : false;
  }

  get aheadCount(): number {
    const name = this.branchName;
    return name ? (this.gitRepositoryStore.getBranchDivergence(name)?.ahead ?? 0) : 0;
  }

  get behindCount(): number {
    const name = this.branchName;
    return name ? (this.gitRepositoryStore.getBranchDivergence(name)?.behind ?? 0) : 0;
  }

  async stageFiles(paths: string[]): Promise<GitWorktreeMutationResult> {
    const result = await this.optimisticStatus.run(
      (model) => stageFilesOptimistically(model, paths),
      () => rpc.workspace.gitWorktree.stageFiles(this.projectId, this.workspaceId, paths),
      (data) => data.sequences.status
    );
    return result;
  }

  async stageAllFiles(): Promise<GitWorktreeMutationResult> {
    const result = await this.optimisticStatus.run(
      (model) => stageAllOptimistically(model),
      () => rpc.workspace.gitWorktree.stageAllFiles(this.projectId, this.workspaceId),
      (data) => data.sequences.status
    );
    return result;
  }

  async unstageFiles(paths: string[]): Promise<GitWorktreeMutationResult> {
    const result = await this.optimisticStatus.run(
      (model) => unstageFilesOptimistically(model, paths),
      () => rpc.workspace.gitWorktree.unstageFiles(this.projectId, this.workspaceId, paths),
      (data) => data.sequences.status
    );
    return result;
  }

  async unstageAllFiles(): Promise<GitWorktreeMutationResult> {
    const result = await this.optimisticStatus.run(
      (model) => unstageAllOptimistically(model),
      () => rpc.workspace.gitWorktree.unstageAllFiles(this.projectId, this.workspaceId),
      (data) => data.sequences.status
    );
    return result;
  }

  async discardFiles(paths: string[]): Promise<GitWorktreeMutationResult> {
    const result = await this.optimisticStatus.run(
      (model) => discardFilesOptimistically(model, paths),
      () => rpc.workspace.gitWorktree.revertFiles(this.projectId, this.workspaceId, paths),
      (data) => data.sequences.status
    );
    return result;
  }

  async discardAllFiles(): Promise<GitWorktreeMutationResult> {
    const result = await this.optimisticStatus.run(
      (model) => discardAllOptimistically(model),
      () => rpc.workspace.gitWorktree.revertAllFiles(this.projectId, this.workspaceId),
      (data) => data.sequences.status
    );
    return result;
  }

  async commit(message: string) {
    const result = await this.optimisticStatus.run(
      (model) => commitOptimistically(model),
      () => rpc.workspace.gitWorktree.commit(this.projectId, this.workspaceId, message),
      (data) => data.sequences.status
    );
    if (result.success) return ok();
    return err(result.error);
  }

  async push() {
    const remote = this.gitRepositoryStore.pushRemote.name;
    const result = await rpc.workspace.gitWorktree.push(this.projectId, this.workspaceId, remote);
    if (result.success) return ok();
    return err(result.error);
  }

  async pull() {
    const result = await rpc.workspace.gitWorktree.pull(this.projectId, this.workspaceId);
    if (result.success) return ok();
    return err(result.error);
  }

  private get effectiveStatus(): GitStatusModel | null {
    return this.optimisticStatus.value;
  }
}
