import {
  type gitRepositoryContract,
  type GitRefsState,
  type GitRemotesState,
  type GitStashesState,
  type GitWorktreesState,
} from '@emdash/core/git';
import type { KeyedMutex } from '@emdash/core/lib';
import type { IWatchService, WatchHandle } from '@emdash/core/watch';
import type { Unsubscribe } from '@emdash/shared';
import { ComputedLiveState, type LiveSource, type ResourceMutationContext } from '@emdash/wire';
import type { CheckoutId, RepositoryIdentity } from '../allocation/identity';
import type { CheckoutResource } from '../checkout/checkout-resource';
import type { GitOperationContext } from '../exec/operation-context';
import type { GitRepository } from './git-repository';
import { RepositoryFamilyLane } from './repository-family-lane';
import { classifyGitWatchEvents, type WorktreeWatchEffects } from './watch-classifier';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

type RepositoryModel = typeof gitRepositoryContract.model;
type RepositoryStateName = Extract<keyof RepositoryModel['states'], string>;
type RepositoryMutationName = Extract<keyof RepositoryModel['mutations'], string>;
type RepositoryMutationContext<Name extends RepositoryMutationName> = ResourceMutationContext<
  RepositoryModel,
  RepositoryResource,
  Name
>;

export type RepositoryResourceOptions = Readonly<{
  identity: RepositoryIdentity;
  commands: GitRepository;
  watcher: IWatchService;
  objectStoreMutex: KeyedMutex;
  onError?: (context: string, error: unknown) => void;
}>;

/** One canonical repository, including commands, live state, ordering, and reconciliation. */
export class RepositoryResource {
  readonly identity: RepositoryIdentity;

  private readonly commands: GitRepository;
  private readonly lane = new RepositoryFamilyLane();
  private readonly states: {
    refs: ComputedLiveState<GitRefsState>;
    remotes: ComputedLiveState<GitRemotesState>;
    stashes: ComputedLiveState<GitStashesState>;
    worktrees: ComputedLiveState<GitWorktreesState>;
  };
  private readonly checkouts = new Map<CheckoutId, CheckoutResource>();
  private readonly commonDirWatch: WatchHandle;
  private readonly onError: (context: string, error: unknown) => void;
  private disposed = false;

  static async create(options: RepositoryResourceOptions): Promise<RepositoryResource> {
    const resource = new RepositoryResource(options);
    try {
      await resource.commonDirWatch.ready();
      return resource;
    } catch (error) {
      await resource.dispose();
      throw error;
    }
  }

  private constructor(private readonly options: RepositoryResourceOptions) {
    this.identity = options.identity;
    this.commands = options.commands;
    this.onError = options.onError ?? (() => {});
    this.states = {
      refs: this.computed('refs', () => this.commands.getRefs()),
      remotes: this.computed('remotes', () => this.commands.getRemotes()),
      stashes: this.computed('stashes', () => this.commands.getStashes()),
      worktrees: this.computed('worktrees', () => this.commands.listWorktrees()),
    };
    this.commonDirWatch = options.watcher.watch(
      this.identity.gitCommonDir,
      (events) => this.onCommonDirEvents(events),
      {
        ignore: ['objects/**'],
        onResync: () => this.onCommonDirResync(),
      }
    );
  }

  state(name: RepositoryStateName): Promise<LiveSource> {
    return this.states[name].prepare();
  }

  invalidate(name: RepositoryStateName): void {
    this.states[name].invalidate();
  }

  readBlobAtRef(ref: string, filePath: string): Promise<string | null> {
    this.assertActive();
    return this.commands.readBlobAtRef(ref, filePath);
  }

  listWorktrees(): Promise<GitWorktreesState> {
    this.assertActive();
    return this.commands.listWorktrees();
  }

  getDefaultBranch(remote?: string): Promise<string> {
    this.assertActive();
    return this.commands.getDefaultBranch(remote);
  }

  async createBranch(context: RepositoryMutationContext<'createBranch'>) {
    const result = await this.execute(
      () => this.commands.createBranch(context.input.options),
      context.input.options.syncWithRemote === true
    );
    if (result.success) this.refsChanged();
    return result;
  }

  async deleteBranch(context: RepositoryMutationContext<'deleteBranch'>) {
    const result = await this.execute(() =>
      this.commands.deleteBranch(context.input.branch, context.input.force)
    );
    if (result.success) this.refsChanged();
    return result;
  }

  async renameBranch(context: RepositoryMutationContext<'renameBranch'>) {
    const result = await this.execute(() =>
      this.commands.renameBranch(context.input.oldName, context.input.newName)
    );
    if (result.success) this.refsChanged();
    return result;
  }

  async setUpstream(context: RepositoryMutationContext<'setUpstream'>) {
    const result = await this.execute(() =>
      this.commands.setUpstream(context.input.branch, context.input.upstream)
    );
    if (result.success) this.refsChanged();
    return result;
  }

  async createTag(context: RepositoryMutationContext<'createTag'>) {
    const result = await this.execute(() => this.commands.createTag(context.input.options));
    if (result.success) this.refsChanged();
    return result;
  }

  async deleteTag(context: RepositoryMutationContext<'deleteTag'>) {
    const result = await this.execute(() => this.commands.deleteTag(context.input.name));
    if (result.success) this.refsChanged();
    return result;
  }

  async addRemote(context: RepositoryMutationContext<'addRemote'>) {
    const result = await this.execute(() =>
      this.commands.addRemote(context.input.name, context.input.url)
    );
    if (result.success) {
      this.invalidate('remotes');
      this.invalidate('refs');
    }
    return result;
  }

  async removeRemote(context: RepositoryMutationContext<'removeRemote'>) {
    const result = await this.execute(() => this.commands.removeRemote(context.input.name));
    if (result.success) {
      this.invalidate('remotes');
      this.invalidate('refs');
    }
    return result;
  }

  async stashDrop(context: RepositoryMutationContext<'stashDrop'>) {
    const result = await this.execute(() => this.commands.stashDrop(context.input.stashIndex));
    if (result.success) this.invalidate('stashes');
    return result;
  }

  async addWorktree(context: RepositoryMutationContext<'addWorktree'>) {
    const result = await this.execute(() => this.commands.addWorktree(context.input.options));
    if (result.success) {
      this.invalidate('worktrees');
      this.invalidate('refs');
    }
    return result;
  }

  async removeWorktree(context: RepositoryMutationContext<'removeWorktree'>) {
    const result = await this.execute(() =>
      this.commands.removeWorktree(context.input.worktreePath, context.input.force)
    );
    if (result.success) this.invalidate('worktrees');
    return result;
  }

  async pruneWorktrees(_context: RepositoryMutationContext<'pruneWorktrees'>) {
    const result = await this.execute(() => this.commands.pruneWorktrees());
    if (result.success) this.invalidate('worktrees');
    return result;
  }

  async fetch(remote: string | undefined, context: GitOperationContext) {
    const result = await this.execute(() => this.commands.fetch(remote, context), true);
    this.invalidate('refs');
    if (result.success) this.invalidateCheckoutHistory();
    else this.invalidate('remotes');
    return result;
  }

  async publishBranch(
    branchName: string,
    remote: string | undefined,
    context: GitOperationContext
  ) {
    const result = await this.execute(
      () => this.commands.publishBranch(branchName, remote, context),
      true
    );
    if (result.success) this.invalidate('refs');
    return result;
  }

  async fetchPrForReview(
    options: Parameters<GitRepository['fetchPrForReview']>[0],
    context: GitOperationContext
  ) {
    const result = await this.execute(() => this.commands.fetchPrForReview(options, context), true);
    this.invalidate('refs');
    this.invalidate('remotes');
    if (result.success) this.invalidateCheckoutHistory();
    return result;
  }

  registerCheckout(checkout: CheckoutResource): Unsubscribe {
    this.assertActive();
    const id = checkout.identity.checkoutId;
    this.checkouts.set(id, checkout);
    return () => {
      if (this.checkouts.get(id) === checkout) this.checkouts.delete(id);
    };
  }

  execute<T>(run: () => Promise<T>, objectTransfer = false): Promise<T> {
    this.assertActive();
    return this.lane.run(() =>
      objectTransfer
        ? this.options.objectStoreMutex.runExclusive(this.identity.objectStoreId, run)
        : run()
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.commonDirWatch.release();
    await this.lane.drain();
    for (const state of Object.values(this.states)) state.dispose();
    this.checkouts.clear();
    this.commands.dispose();
  }

  private refsChanged(): void {
    this.invalidate('refs');
    this.invalidateCheckoutHistory();
  }

  private invalidateCheckoutHistory(): void {
    for (const checkout of this.checkouts.values()) checkout.invalidateRepositoryHistory();
  }

  private onCommonDirEvents(events: Parameters<typeof classifyGitWatchEvents>[0]): void {
    const classification = classifyGitWatchEvents(events, this.layout());
    if (classification.repo.refs) this.invalidate('refs');
    if (classification.repo.remotes) this.invalidate('remotes');
    if (classification.repo.stashes) this.invalidate('stashes');
    if (classification.repo.worktrees) this.invalidate('worktrees');
    for (const [id, effects] of classification.worktrees) {
      this.applyWorktreeWatchEffects(id as CheckoutId, effects);
    }
  }

  private onCommonDirResync(): void {
    for (const state of Object.values(this.states)) state.invalidate();
    for (const checkout of this.checkouts.values()) {
      checkout.applyRepositoryWatchEffects({ status: true, head: true });
    }
  }

  private applyWorktreeWatchEffects(id: CheckoutId, effects: WorktreeWatchEffects): void {
    this.checkouts.get(id)?.applyRepositoryWatchEffects(effects);
  }

  private layout() {
    return {
      gitCommonDir: this.identity.gitCommonDir,
      worktrees: [...this.checkouts.values()].map((checkout) => ({
        id: checkout.identity.checkoutId,
        gitDir: checkout.identity.gitDir,
        worktree: checkout.identity.checkoutRoot,
      })),
    };
  }

  private computed<T>(name: string, compute: () => Promise<T>): ComputedLiveState<T> {
    return new ComputedLiveState({
      compute: () => this.lane.run(compute),
      debounceMs: WATCH_DEBOUNCE_MS,
      revalidateIntervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => this.onError(`${name} ${this.identity.gitCommonDir}`, error),
    });
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('RepositoryResource is disposed');
  }
}
