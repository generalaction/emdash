import path from 'node:path';
import {
  type gitCheckoutContract,
  type BlameResult,
  type BoundFileDiffKey,
  type CheckoutHeadState,
  type CheckoutStatusState,
  type Commit,
  type CommitFile,
  type ConflictVersions,
  type DiffTarget,
  type FileDiff,
  type GitChange,
  type GitCommandError,
  type GitLogOptions,
  type GitLogResult,
  type ImageReadResult,
} from '@emdash/core/git';
import type { IWatchService, WatchHandle } from '@emdash/core/services/fs-watch/api';
import type { PendingLease, Result, Unsubscribe } from '@emdash/shared';
import {
  ComputedLiveState,
  type LiveCursor,
  type LiveSource,
  type ResourceMutationContext,
} from '@emdash/wire';
import type { CheckoutIdentity } from '../allocation/identity';
import type { GitOperationContext } from '../exec/operation-context';
import type { RepositoryResource } from '../repository/repository-resource';
import type { WorktreeWatchEffects } from '../repository/watch-classifier';
import { FileDiffRegistry } from './file-diff-registry';
import type { GitCheckout } from './git-checkout';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

type CheckoutModel = typeof gitCheckoutContract.model;
type CheckoutStateName = Extract<keyof CheckoutModel['states'], string>;
type CheckoutMutationName = Extract<keyof CheckoutModel['mutations'], string>;
type CheckoutMutationContext<Name extends CheckoutMutationName> = ResourceMutationContext<
  CheckoutModel,
  CheckoutResource,
  Name
>;

export type CheckoutResourceOptions = Readonly<{
  identity: CheckoutIdentity;
  commands: GitCheckout;
  repository: RepositoryResource;
  watcher: IWatchService;
  onError?: (context: string, error: unknown) => void;
  maxFileDiffStates?: number;
}>;

/** One canonical checkout, including commands, live state, ordering, and reconciliation. */
export class CheckoutResource {
  readonly identity: CheckoutIdentity;
  readonly repository: RepositoryResource;

  private readonly commands: GitCheckout;
  private readonly states: {
    status: ComputedLiveState<CheckoutStatusState>;
    head: ComputedLiveState<CheckoutHeadState>;
  };
  private readonly fileDiffs: FileDiffRegistry;
  private readonly worktreeWatch: WatchHandle;
  private readonly unregister: Unsubscribe;
  private readonly onError: (context: string, error: unknown) => void;
  private disposed = false;

  static async create(options: CheckoutResourceOptions): Promise<CheckoutResource> {
    const resource = new CheckoutResource(options);
    try {
      await resource.worktreeWatch.ready();
      return resource;
    } catch (error) {
      await resource.dispose();
      throw error;
    }
  }

  private constructor(options: CheckoutResourceOptions) {
    this.identity = options.identity;
    this.commands = options.commands;
    this.repository = options.repository;
    this.onError = options.onError ?? (() => {});
    this.states = {
      status: this.computed('status', () => this.commands.getStatus()),
      head: this.computed('head', () => this.commands.getHead()),
    };
    this.fileDiffs = new FileDiffRegistry({
      checkoutRoot: this.identity.checkoutRoot,
      maxEntries: options.maxFileDiffStates,
    });
    this.worktreeWatch = options.watcher.watch(
      this.identity.checkoutRoot,
      (events) => this.onWorktreeEvents(events),
      {
        ignore: ['.git/**'],
        onResync: () => this.onWorktreeResync(),
      }
    );
    this.unregister = this.repository.registerCheckout(this);
  }

  state(name: CheckoutStateName): Promise<LiveSource> {
    return this.states[name].prepare();
  }

  refresh(name: CheckoutStateName, mutationId?: string): Promise<LiveCursor> {
    return this.states[name].refresh({ mutationId });
  }

  invalidate(name: CheckoutStateName): void {
    this.states[name].invalidate();
  }

  acquireFileDiffStaleness(key: BoundFileDiffKey): PendingLease<LiveSource> {
    this.assertActive();
    return this.fileDiffs.acquire(key);
  }

  getFileDiff(filePath: string, target?: DiffTarget): Promise<Result<FileDiff, GitCommandError>> {
    this.assertActive();
    return this.commands.getFileDiff(filePath, target);
  }

  getChangedFiles(target: DiffTarget): Promise<GitChange[]> {
    this.assertActive();
    return this.commands.getChangedFiles(target);
  }

  getConflictVersions(filePath: string): Promise<Result<ConflictVersions, GitCommandError>> {
    this.assertActive();
    return this.commands.getConflictVersions(filePath);
  }

  getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    this.assertActive();
    return this.commands.getFileAtRef(filePath, ref);
  }

  getFileAtIndex(filePath: string): Promise<string | null> {
    this.assertActive();
    return this.commands.getFileAtIndex(filePath);
  }

  getImageAtRef(filePath: string, ref: string): Promise<ImageReadResult> {
    this.assertActive();
    return this.commands.getImageAtRef(filePath, ref);
  }

  getImageAtIndex(filePath: string): Promise<ImageReadResult> {
    this.assertActive();
    return this.commands.getImageAtIndex(filePath);
  }

  getLog(options?: GitLogOptions): Promise<GitLogResult> {
    this.assertActive();
    return this.commands.getLog(options);
  }

  getCommit(hash: string): Promise<Commit | null> {
    this.assertActive();
    return this.commands.getCommit(hash);
  }

  getCommitFiles(hash: string): Promise<CommitFile[]> {
    this.assertActive();
    return this.commands.getCommitFiles(hash);
  }

  blame(filePath: string, ref?: string): Promise<Result<BlameResult, GitCommandError>> {
    this.assertActive();
    return this.commands.blame(filePath, ref);
  }

  async stage(context: CheckoutMutationContext<'stage'>) {
    const result = await this.execute(() => this.commands.stage(context.input.paths));
    if (result.success) await this.settleIndexChange(context, context.input.paths);
    return result;
  }

  async unstage(context: CheckoutMutationContext<'unstage'>) {
    const result = await this.execute(() => this.commands.unstage(context.input.paths));
    if (result.success) await this.settleIndexChange(context, context.input.paths);
    return result;
  }

  async stageAll(context: CheckoutMutationContext<'stageAll'>) {
    const result = await this.execute(() => this.commands.stageAll());
    if (result.success) await this.settleIndexChange(context, 'all');
    return result;
  }

  async unstageAll(context: CheckoutMutationContext<'unstageAll'>) {
    const result = await this.execute(() => this.commands.unstageAll());
    if (result.success) await this.settleIndexChange(context, 'all');
    return result;
  }

  async revert(context: CheckoutMutationContext<'revert'>) {
    const result = await this.execute(() => this.commands.revert(context.input.paths));
    if (result.success) this.contentChanged(context.input.paths);
    return result;
  }

  async revertAll(_context: CheckoutMutationContext<'revertAll'>) {
    const result = await this.execute(() => this.commands.revertAll());
    if (result.success) this.contentChanged('all');
    return result;
  }

  async clean(context: CheckoutMutationContext<'clean'>) {
    const result = await this.execute(() => this.commands.clean(context.input));
    if (result.success) this.contentChanged(context.input.paths ?? 'all');
    return result;
  }

  async stageHunk(context: CheckoutMutationContext<'stageHunk'>) {
    const result = await this.execute(() =>
      this.commands.stageHunk(context.input.path, context.input.hunkHeader)
    );
    if (result.success) this.indexChanged([context.input.path]);
    return result;
  }

  async unstageHunk(context: CheckoutMutationContext<'unstageHunk'>) {
    const result = await this.execute(() =>
      this.commands.unstageHunk(context.input.path, context.input.hunkHeader)
    );
    if (result.success) this.indexChanged([context.input.path]);
    return result;
  }

  async discardHunk(context: CheckoutMutationContext<'discardHunk'>) {
    const result = await this.execute(() =>
      this.commands.discardHunk(context.input.path, context.input.hunkHeader)
    );
    if (result.success) this.contentChanged([context.input.path]);
    return result;
  }

  async commit(context: CheckoutMutationContext<'commit'>) {
    const result = await this.execute(() =>
      this.commands.commit(context.input.message, context.input.options)
    );
    this.historyChanged(result.success);
    return result;
  }

  async switch(context: CheckoutMutationContext<'switch'>) {
    const result = await this.execute(() => this.commands.switch(context.input.options));
    this.historyChanged(result.success);
    return result;
  }

  async reset(context: CheckoutMutationContext<'reset'>) {
    const result = await this.execute(() =>
      this.commands.reset(context.input.ref, context.input.mode)
    );
    this.historyChanged(result.success);
    return result;
  }

  async merge(context: CheckoutMutationContext<'merge'>) {
    const result = await this.execute(() => this.commands.merge(context.input.options));
    this.historyChanged(result.success);
    return result;
  }

  async mergeContinue(context: CheckoutMutationContext<'mergeContinue'>) {
    const result = await this.execute(() => this.commands.mergeContinue(context.input.message));
    this.historyChanged(result.success);
    return result;
  }

  async mergeAbort(_context: CheckoutMutationContext<'mergeAbort'>) {
    const result = await this.execute(() => this.commands.mergeAbort());
    this.historyChanged(result.success);
    return result;
  }

  async rebase(context: CheckoutMutationContext<'rebase'>) {
    const result = await this.execute(() => this.commands.rebase(context.input.options));
    this.historyChanged(result.success);
    return result;
  }

  async rebaseContinue(_context: CheckoutMutationContext<'rebaseContinue'>) {
    const result = await this.execute(() => this.commands.rebaseContinue());
    this.historyChanged(result.success);
    return result;
  }

  async rebaseAbort(_context: CheckoutMutationContext<'rebaseAbort'>) {
    const result = await this.execute(() => this.commands.rebaseAbort());
    this.historyChanged(result.success);
    return result;
  }

  async rebaseSkip(_context: CheckoutMutationContext<'rebaseSkip'>) {
    const result = await this.execute(() => this.commands.rebaseSkip());
    this.historyChanged(result.success);
    return result;
  }

  async cherryPick(context: CheckoutMutationContext<'cherryPick'>) {
    const result = await this.execute(() =>
      this.commands.cherryPick(context.input.commits, context.input.noCommit)
    );
    this.historyChanged(result.success);
    return result;
  }

  async revertCommit(context: CheckoutMutationContext<'revertCommit'>) {
    const result = await this.execute(() =>
      this.commands.revertCommit(context.input.commit, context.input.noCommit)
    );
    this.historyChanged(result.success);
    return result;
  }

  async stashPush(context: CheckoutMutationContext<'stashPush'>) {
    const result = await this.execute(() => this.commands.stashPush(context.input.options));
    if (result.success) this.stashChanged();
    return result;
  }

  async stashApply(context: CheckoutMutationContext<'stashApply'>) {
    const result = await this.execute(() => this.commands.stashApply(context.input.stashIndex));
    if (result.success) this.stashChanged();
    return result;
  }

  async stashPop(context: CheckoutMutationContext<'stashPop'>) {
    const result = await this.execute(() => this.commands.stashPop(context.input.stashIndex));
    if (result.success) this.stashChanged();
    return result;
  }

  async push(options: Parameters<GitCheckout['push']>[0], context: GitOperationContext) {
    const result = await this.execute(() => this.commands.push(options, context));
    if (result.success) this.repository.invalidate('refs');
    return result;
  }

  async pull(context: GitOperationContext) {
    const result = await this.execute(() => this.commands.pull(context), true);
    this.syncChanged();
    return result;
  }

  async sync(context: Parameters<GitCheckout['sync']>[0]) {
    const result = await this.execute(() => this.commands.sync(context), true);
    this.syncChanged();
    return result;
  }

  invalidateRepositoryHistory(): void {
    this.invalidate('status');
    this.invalidate('head');
    this.fileDiffs.bump('all', 'ref-changed');
  }

  applyRepositoryWatchEffects(effects: WorktreeWatchEffects): void {
    if (effects.status) this.invalidate('status');
    if (effects.head) this.invalidate('head');
    if (effects.head) this.fileDiffs.bump('all', 'ref-changed');
    else if (effects.status) this.fileDiffs.bump('all', 'index-changed');
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unregister();
    await this.worktreeWatch.release();
    for (const state of Object.values(this.states)) state.dispose();
    this.fileDiffs.dispose();
  }

  private execute<T>(run: () => Promise<T>, objectTransfer = false): Promise<T> {
    this.assertActive();
    return this.repository.execute(run, objectTransfer);
  }

  private async settleIndexChange(
    context:
      | CheckoutMutationContext<'stage'>
      | CheckoutMutationContext<'unstage'>
      | CheckoutMutationContext<'stageAll'>
      | CheckoutMutationContext<'unstageAll'>,
    paths: 'all' | readonly string[]
  ): Promise<void> {
    await context.settle('status', this.refresh('status', context.mutationId));
    this.fileDiffs.bump(paths, 'index-changed');
  }

  private indexChanged(paths: 'all' | readonly string[]): void {
    this.invalidate('status');
    this.fileDiffs.bump(paths, 'index-changed');
  }

  private contentChanged(paths: 'all' | readonly string[]): void {
    this.invalidate('status');
    this.fileDiffs.bump(paths, 'content-changed');
  }

  private historyChanged(success: boolean): void {
    this.invalidate('status');
    this.invalidate('head');
    this.fileDiffs.bump('all', 'ref-changed');
    if (success) this.repository.invalidate('refs');
  }

  private stashChanged(): void {
    this.indexChanged('all');
    this.repository.invalidate('stashes');
  }

  private syncChanged(): void {
    this.invalidateRepositoryHistory();
    this.repository.invalidate('refs');
  }

  private onWorktreeEvents(events: { path: string }[]): void {
    this.invalidate('status');
    const paths = events.map((event) => this.toRelativePath(event.path));
    this.fileDiffs.bump(paths, 'content-changed');
  }

  private onWorktreeResync(): void {
    this.invalidate('status');
    this.invalidate('head');
    this.fileDiffs.bump('all', 'content-changed');
  }

  private computed<T>(name: string, compute: () => Promise<T>): ComputedLiveState<T> {
    return new ComputedLiveState({
      compute: () => this.repository.execute(compute),
      debounceMs: WATCH_DEBOUNCE_MS,
      revalidateIntervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => this.onError(`${name} ${this.identity.checkoutRoot}`, error),
    });
  }

  private toRelativePath(filePath: string): string {
    return path.relative(this.identity.checkoutRoot, filePath).replace(/\\/g, '/');
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('CheckoutResource is disposed');
  }
}
