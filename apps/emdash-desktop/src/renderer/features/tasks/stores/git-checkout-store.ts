import {
  gitContract,
  type CheckoutHeadState,
  type CheckoutStatusState,
  type FileGitStatus,
  type GitChange,
  type GitChangeStatus,
} from '@emdash/core/git';
import { err, ok } from '@emdash/shared';
import { createLiveModelReplica, type LiveModelReplica, type ReplicaInstance } from '@emdash/wire';
import { createImmutableMobxStore } from '@emdash/wire/util/mobx';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import { getFilesRuntimeClient } from '@renderer/lib/runtime/files-client';
import { checkoutSelector, gitFilePath, runRuntimeJob } from '@renderer/lib/runtime/git';
import { getGitRuntimeClient } from '@renderer/lib/runtime/git-client';
import { hostPathFromNative } from '@shared/core/runtime/paths';

const TOO_MANY_FILES_MSG = 'Too many files changed to display';
const MAX_UNTRACKED_STAT_BYTES = 2 * 1024 * 1024;
type CheckoutModel = typeof gitContract.checkout.model;

export class GitCheckoutStore {
  private replica: LiveModelReplica<CheckoutModel> | null = null;
  private model: ReplicaInstance<CheckoutModel> | null = null;
  private releaseModel: (() => Promise<void>) | null = null;
  private startPromise: Promise<void> | null = null;
  private started = false;
  private syncError: string | null = null;
  private changesRequest = 0;
  private stagedChanges: GitChange[] = [];
  private unstagedChanges: GitChange[] = [];
  private revision = 0;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    readonly workspacePath: string,
    private readonly gitRepositoryStore: GitRepositoryStore
  ) {
    makeObservable<
      GitCheckoutStore,
      'model' | 'syncError' | 'stagedChanges' | 'unstagedChanges' | 'revision'
    >(this, {
      model: observable.ref,
      syncError: observable,
      stagedChanges: observable.ref,
      unstagedChanges: observable.ref,
      revision: observable,
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
      headOid: computed,
      headKind: computed,
      headDisplay: computed,
      statusRevision: computed,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.ensureStarted();
  }

  async resync(): Promise<void> {
    await this.ensureStarted();
    const model = this.model;
    if (!model) return;
    await Promise.all([model.states.status.refresh(), model.states.head.refresh()]);
    await this.refreshChanges();
  }

  dispose(): void {
    this.started = false;
    this.changesRequest += 1;
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

  get statusRevision(): number {
    return this.revision;
  }

  get fileChanges(): GitChange[] {
    const combined = new Map<string, GitChange>();
    for (const change of [...this.stagedChanges, ...this.unstagedChanges]) {
      const current = combined.get(change.path);
      combined.set(
        change.path,
        current
          ? {
              path: change.path,
              status: current.status === change.status ? change.status : 'modified',
              additions: current.additions + change.additions,
              deletions: current.deletions + change.deletions,
            }
          : change
      );
    }
    return [...combined.values()];
  }

  get stagedFileChanges(): GitChange[] {
    return this.stagedChanges;
  }

  get unstagedFileChanges(): GitChange[] {
    return this.unstagedChanges;
  }

  get totalLinesAdded(): number {
    return this.fileChanges.reduce((sum, change) => sum + change.additions, 0);
  }

  get totalLinesDeleted(): number {
    return this.fileChanges.reduce((sum, change) => sum + change.deletions, 0);
  }

  get hasData(): boolean {
    return this.model !== null;
  }

  get isLoading(): boolean {
    return !this.hasData && this.syncError === null;
  }

  get error(): string | undefined {
    const status = this.status;
    if (status?.kind === 'too-many-files') return TOO_MANY_FILES_MSG;
    if (status?.kind === 'error') return status.message;
    return this.syncError ?? undefined;
  }

  get branchName(): string | null {
    const head = this.head;
    return !head || head.kind === 'detached' ? null : head.name;
  }

  get headOid(): string | null {
    const head = this.head;
    return head?.kind === 'branch' || head?.kind === 'detached' ? head.oid : null;
  }

  get headKind(): CheckoutHeadState['kind'] {
    return this.head?.kind ?? 'branch';
  }

  get headDisplay(): string | null {
    const head = this.head;
    if (!head) return null;
    return head.kind === 'detached' ? head.shortHash : head.name;
  }

  get isBranchPublished(): boolean {
    return this.branchName ? this.gitRepositoryStore.isBranchOnRemote(this.branchName) : false;
  }

  get aheadCount(): number {
    return this.branchName
      ? (this.gitRepositoryStore.getBranchDivergence(this.branchName)?.ahead ?? 0)
      : 0;
  }

  get behindCount(): number {
    return this.branchName
      ? (this.gitRepositoryStore.getBranchDivergence(this.branchName)?.behind ?? 0)
      : 0;
  }

  async stageFiles(paths: string[]) {
    const model = await this.requireModel();
    return settleMutation(model.mutations.stage({ paths: paths.map(gitFilePath) }));
  }

  async stageAllFiles() {
    const model = await this.requireModel();
    return settleMutation(model.mutations.stageAll({}));
  }

  async unstageFiles(paths: string[]) {
    const model = await this.requireModel();
    return settleMutation(model.mutations.unstage({ paths: paths.map(gitFilePath) }));
  }

  async unstageAllFiles() {
    const model = await this.requireModel();
    return settleMutation(model.mutations.unstageAll({}));
  }

  async discardFiles(paths: string[]) {
    const model = await this.requireModel();
    return settleMutation(model.mutations.revert({ paths: paths.map(gitFilePath) }));
  }

  async discardAllFiles() {
    const model = await this.requireModel();
    return settleMutation(model.mutations.revertAll({}));
  }

  async commit(message: string) {
    const model = await this.requireModel();
    const result = await settleMutation(model.mutations.commit({ message }));
    return result.success ? ok() : err(result.error);
  }

  async push() {
    const client = await getGitRuntimeClient();
    return runRuntimeJob(gitContract.checkout.push, client.checkout.push, {
      ...checkoutSelector(this.workspacePath),
      options: { remote: this.gitRepositoryStore.pushRemote.name },
    });
  }

  async pull() {
    const client = await getGitRuntimeClient();
    return runRuntimeJob(
      gitContract.checkout.pull,
      client.checkout.pull,
      checkoutSelector(this.workspacePath)
    );
  }

  private get status(): CheckoutStatusState | null {
    return this.model?.states.status.current() ?? null;
  }

  private get head(): CheckoutHeadState | null {
    return this.model?.states.head.current() ?? null;
  }

  private ensureStarted(): Promise<void> {
    this.startPromise ??= this.bindRuntime();
    return this.startPromise;
  }

  private async requireModel(): Promise<ReplicaInstance<CheckoutModel>> {
    await this.ensureStarted();
    if (!this.model) throw new Error(this.syncError ?? 'Git checkout is unavailable');
    return this.model;
  }

  private async bindRuntime(): Promise<void> {
    try {
      const client = await getGitRuntimeClient();
      const replica = createLiveModelReplica(gitContract.checkout.model, client.checkout.model, {
        stores: {
          status: createImmutableMobxStore,
          head: createImmutableMobxStore,
        },
        onChange: {
          status: () => {
            runInAction(() => {
              this.revision += 1;
            });
            void this.refreshChanges();
          },
          head: () => {
            runInAction(() => {
              this.revision += 1;
            });
          },
        },
      });
      const lease = replica.acquire(checkoutSelector(this.workspacePath));
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
        this.syncError = null;
      });
      await this.refreshChanges();
    } catch (error) {
      runInAction(() => {
        this.syncError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private async refreshChanges(): Promise<void> {
    const status = this.status;
    if (!status || status.kind !== 'ok') {
      runInAction(() => {
        this.stagedChanges = [];
        this.unstagedChanges = [];
      });
      return;
    }
    const request = ++this.changesRequest;
    const client = await getGitRuntimeClient();
    const selector = checkoutSelector(this.workspacePath);
    const [stagedResult, unstagedResult] = await Promise.all([
      client.checkout.getChangedFiles({ ...selector, target: { kind: 'staged-vs-head' } }),
      client.checkout.getChangedFiles({ ...selector, target: { kind: 'working-vs-index' } }),
    ]);
    if (request !== this.changesRequest || !this.started) return;
    if (!stagedResult.success || !unstagedResult.success) {
      runInAction(() => {
        this.syncError = 'Failed to load changed files';
      });
      return;
    }

    const staged = completeChanges(stagedResult.data, status.entries, 'staged');
    const unstaged = completeChanges(unstagedResult.data, status.entries, 'unstaged');
    await addUntrackedLineCounts(unstaged, this.workspacePath);
    if (request !== this.changesRequest || !this.started) return;
    runInAction(() => {
      this.stagedChanges = staged;
      this.unstagedChanges = unstaged;
      this.syncError = null;
    });
  }
}

async function settleMutation<
  Invocation extends Promise<{ result: { success: boolean }; settled: Promise<void> }>,
>(invocationPromise: Invocation): Promise<Awaited<Invocation>['result']> {
  const invocation = await invocationPromise;
  if (invocation.result.success) await invocation.settled;
  return invocation.result;
}

function completeChanges(
  changes: GitChange[],
  entries: Record<string, FileGitStatus>,
  side: 'staged' | 'unstaged'
): GitChange[] {
  const byPath = new Map(changes.map((change) => [change.path, change]));
  for (const entry of Object.values(entries)) {
    const changed =
      side === 'staged'
        ? entry.index !== 'unmodified' && entry.index !== 'untracked' && entry.index !== 'ignored'
        : entry.worktree !== 'unmodified' && entry.worktree !== 'ignored';
    if (!changed || byPath.has(entry.path)) continue;
    byPath.set(entry.path, {
      path: entry.path,
      status: changeStatus(entry),
      additions: 0,
      deletions: 0,
    });
  }
  return [...byPath.values()];
}

function changeStatus(entry: FileGitStatus): GitChangeStatus {
  if (entry.isConflicted || entry.index === 'unmerged' || entry.worktree === 'unmerged') {
    return 'conflicted';
  }
  const code = entry.worktree !== 'unmodified' ? entry.worktree : entry.index;
  if (code === 'added' || code === 'copied' || code === 'untracked') return 'added';
  if (code === 'deleted') return 'deleted';
  if (code === 'renamed') return 'renamed';
  return 'modified';
}

async function addUntrackedLineCounts(changes: GitChange[], workspacePath: string): Promise<void> {
  const untracked = changes.filter((change) => change.status === 'added' && change.additions === 0);
  if (untracked.length === 0) return;
  const client = await getFilesRuntimeClient();
  const root = hostPathFromNative(workspacePath);
  await Promise.all(
    untracked.map(async (change) => {
      const result = await client.fs.readText({
        root,
        relative: change.path,
        options: { maxBytes: MAX_UNTRACKED_STAT_BYTES },
      });
      if (result.success && !result.data.truncated) {
        change.additions = result.data.content.split('\n').length - 1;
      }
    })
  );
}
