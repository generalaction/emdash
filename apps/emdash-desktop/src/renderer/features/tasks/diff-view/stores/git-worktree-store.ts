import type { GitChange, GitHeadModel, GitStatusData, GitStatusModel } from '@emdash/shared/git';
import { computed, makeObservable } from 'mobx';
import { toast } from 'sonner';
import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import {
  bindMirror,
  ModelMirror,
  OverlayStack,
  type MirrorBinding,
} from '@renderer/lib/stores/live';
import { gitWorktreeUpdateChannel } from '@shared/core/git/gitEvents';
import { err, ok } from '@shared/lib/result';
import { formatPushErrorDetail } from '../../utils';

const TOO_MANY_FILES_MSG = 'Too many files changed to display';

export class GitWorktreeStore {
  private readonly status = new ModelMirror<GitStatusModel>();
  private readonly head = new ModelMirror<GitHeadModel>();
  private readonly statusOverlay = new OverlayStack<GitStatusModel>(this.status);
  private readonly bindings: MirrorBinding[];

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly gitRepositoryStore: GitRepositoryStore
  ) {
    this.bindings = [
      bindMirror({
        mirror: this.status,
        subscribe: (push) =>
          events.on(gitWorktreeUpdateChannel, (payload) => {
            if (payload.workspaceId === this.workspaceId && payload.update.kind === 'status') {
              push({ value: payload.update.model, seq: payload.update.seq });
            }
          }),
        snapshot: async () => {
          const result = await rpc.workspace.gitWorktree.getWorktreeSnapshot(
            this.projectId,
            this.workspaceId
          );
          if (!result.success) throw new Error(errorType(result.error));
          return result.data.status;
        },
      }),
      bindMirror({
        mirror: this.head,
        subscribe: (push) =>
          events.on(gitWorktreeUpdateChannel, (payload) => {
            if (payload.workspaceId === this.workspaceId && payload.update.kind === 'head') {
              push({ value: payload.update.model, seq: payload.update.seq });
            }
          }),
        snapshot: async () => {
          const result = await rpc.workspace.gitWorktree.getWorktreeSnapshot(
            this.projectId,
            this.workspaceId
          );
          if (!result.success) throw new Error(errorType(result.error));
          return result.data.head;
        },
      }),
    ];

    makeObservable<this, 'effectiveStatus'>(this, {
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
      fullStatus: computed,
    });
  }

  get fullStatus(): { lastUpdatedAt: number } {
    return { lastUpdatedAt: Math.max(this.status.seq, this.head.seq) };
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
    if (!status) return undefined;
    if (status.kind === 'too-many-files') return TOO_MANY_FILES_MSG;
    if (status.kind === 'error') return status.message;
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

  startWatching(): void {
    for (const binding of this.bindings) binding.start();
  }

  resync(): Promise<void> {
    return Promise.all(this.bindings.map((binding) => binding.resync())).then(() => undefined);
  }

  dispose(): void {
    for (const binding of this.bindings) binding.dispose();
    this.statusOverlay.dispose();
    this.status.dispose();
    this.head.dispose();
  }

  async stageFiles(paths: string[]): Promise<void> {
    const result = await this.statusOverlay.run(
      (model) => applyToOk(model, (status) => movePaths(status, paths, 'unstaged', 'staged')),
      () => rpc.workspace.gitWorktree.stageFiles(this.projectId, this.workspaceId, paths),
      (data) => data.seqs.status
    );
    if (!result.success) throw new Error(errorType(result.error));
  }

  async stageAllFiles(): Promise<void> {
    const result = await this.statusOverlay.run(
      (model) => applyToOk(model, stageAll),
      () => rpc.workspace.gitWorktree.stageAllFiles(this.projectId, this.workspaceId),
      (data) => data.seqs.status
    );
    if (!result.success) throw new Error(errorType(result.error));
  }

  async unstageFiles(paths: string[]): Promise<void> {
    const result = await this.statusOverlay.run(
      (model) => applyToOk(model, (status) => movePaths(status, paths, 'staged', 'unstaged')),
      () => rpc.workspace.gitWorktree.unstageFiles(this.projectId, this.workspaceId, paths),
      (data) => data.seqs.status
    );
    if (!result.success) throw new Error(errorType(result.error));
  }

  async unstageAllFiles(): Promise<void> {
    const result = await this.statusOverlay.run(
      (model) => applyToOk(model, unstageAll),
      () => rpc.workspace.gitWorktree.unstageAllFiles(this.projectId, this.workspaceId),
      (data) => data.seqs.status
    );
    if (!result.success) throw new Error(errorType(result.error));
  }

  async discardFiles(paths: string[]): Promise<void> {
    const result = await this.statusOverlay.run(
      (model) => applyToOk(model, (status) => removeUnstaged(status, paths)),
      () => rpc.workspace.gitWorktree.revertFiles(this.projectId, this.workspaceId, paths),
      (data) => data.seqs.status
    );
    if (!result.success) throw new Error(errorType(result.error));
  }

  async discardAllFiles(): Promise<void> {
    const result = await this.statusOverlay.run(
      (model) => applyToOk(model, (status) => ({ ...status, unstaged: [] })),
      () => rpc.workspace.gitWorktree.revertAllFiles(this.projectId, this.workspaceId),
      (data) => data.seqs.status
    );
    if (!result.success) throw new Error(errorType(result.error));
  }

  async commit(message: string) {
    const result = await this.statusOverlay.run(
      (model) =>
        applyToOk(model, (status) => ({
          ...status,
          staged: [],
          stagedAdded: 0,
          stagedDeleted: 0,
        })),
      () => rpc.workspace.gitWorktree.commit(this.projectId, this.workspaceId, message),
      (data) => data.seqs.status
    );
    if (result.success) return ok();
    toast.error(`Failed to commit changes: ${errorType(result.error)} `);
    return err(result.error);
  }

  async fetchRemote() {
    const result = await rpc.gitRepository.fetch(this.projectId);
    if (result.success) return ok();
    toast.error(`Failed to fetch remote changes: ${result.error.type} `);
    return err(result.error);
  }

  async push() {
    const remote = this.gitRepositoryStore.pushRemote.name;
    const result = await rpc.workspace.gitWorktree.push(this.projectId, this.workspaceId, remote);
    if (result.success) return ok();
    toast.error(`Failed to push: ${formatPushErrorDetail(result.error)}`);
    return err(result.error);
  }

  async publishBranch() {
    const branchName = this.branchName;
    if (!branchName) return err({ type: 'git_error' as const, message: 'No branch checked out' });
    const remote = this.gitRepositoryStore.pushRemote.name;
    const result = await rpc.gitRepository.publishBranch(
      this.projectId,
      branchName,
      remote,
      this.workspaceId
    );
    if (result.success) return ok();
    toast.error(`Failed to publish branch: ${formatPushErrorDetail(result.error)}`);
    return err(result.error);
  }

  async pull() {
    const result = await rpc.workspace.gitWorktree.pull(this.projectId, this.workspaceId);
    if (result.success) return ok();
    toast.error(`Failed to pull changes: ${result.error.type} `);
    return err(result.error);
  }

  private get effectiveStatus(): GitStatusModel | null {
    return this.statusOverlay.value;
  }
}

function applyToOk(
  model: GitStatusModel,
  fn: (status: GitStatusData) => GitStatusData
): GitStatusModel {
  return model.kind === 'ok' ? fn(model) : model;
}

function movePaths(
  status: GitStatusData,
  paths: string[],
  from: 'staged' | 'unstaged',
  to: 'staged' | 'unstaged'
): GitStatusData {
  const pathSet = new Set(paths);
  const moving = status[from].filter((change) => pathSet.has(change.path));
  const nextFrom = status[from].filter((change) => !pathSet.has(change.path));
  const existingTarget = status[to].filter((change) => !pathSet.has(change.path));
  const next = {
    ...status,
    [from]: nextFrom,
    [to]: [...existingTarget, ...moving],
  };
  return recountStaged(next);
}

function stageAll(status: GitStatusData): GitStatusData {
  return recountStaged({
    ...status,
    staged: mergeByPath([...status.staged, ...status.unstaged]),
    unstaged: [],
  });
}

function unstageAll(status: GitStatusData): GitStatusData {
  return {
    ...status,
    staged: [],
    unstaged: mergeByPath([...status.unstaged, ...status.staged]),
    stagedAdded: 0,
    stagedDeleted: 0,
  };
}

function removeUnstaged(status: GitStatusData, paths: string[]): GitStatusData {
  const pathSet = new Set(paths);
  return {
    ...status,
    unstaged: status.unstaged.filter((change) => !pathSet.has(change.path)),
  };
}

function mergeByPath(changes: GitChange[]): GitChange[] {
  const byPath = new Map<string, GitChange>();
  for (const change of changes) {
    byPath.set(change.path, change);
  }
  return [...byPath.values()];
}

function recountStaged(status: GitStatusData): GitStatusData {
  return {
    ...status,
    stagedAdded: status.staged.reduce((sum, change) => sum + change.additions, 0),
    stagedDeleted: status.staged.reduce((sum, change) => sum + change.deletions, 0),
  };
}

function errorType(error: unknown): string {
  return error && typeof error === 'object' && 'type' in error
    ? String((error as { type: unknown }).type)
    : String(error);
}
