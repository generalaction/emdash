import type {
  FileDiffStalenessReason,
  GitRefsState,
  GitRemotesState,
  GitStashesState,
  GitWorktreesState,
} from '@emdash/core/git';
import type { KeyedMutex } from '@emdash/core/lib';
import type { IWatchService, WatchHandle } from '@emdash/core/services/fs-watch/api';
import type { Result, Unsubscribe } from '@emdash/shared';
import { ComputedLiveState, type LiveSource } from '@emdash/wire';
import type { GitRepository } from '../repository/git-repository';
import type { CheckoutMount } from './checkout-mount';
import {
  effectPlanFor,
  type CheckoutOperation,
  type GitEffect,
  type GitEffectPlan,
  type GitSettledState,
  type RepositoryOperation,
} from './effect-plan';
import type { CheckoutId, RepositoryIdentity } from './identity';
import { RepositoryFamilyLane } from './repository-family-lane';
import { classifyGitWatchEvents, type WorktreeWatchEffects } from './watch-classifier';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

export type RepositoryStateName = 'refs' | 'remotes' | 'stashes' | 'worktrees';

export type GitExecution<T, E> = Readonly<{
  result: Result<T, E>;
  settled: readonly GitSettledState[];
}>;

export type RepositoryMountOptions = Readonly<{
  identity: RepositoryIdentity;
  repository: GitRepository;
  watcher: IWatchService;
  objectStoreMutex: KeyedMutex;
  onError?: (context: string, error: unknown) => void;
}>;

/** Shared live orchestration for one canonical Git common directory. */
export class RepositoryMount {
  readonly identity: RepositoryIdentity;
  readonly repository: GitRepository;

  private readonly lane = new RepositoryFamilyLane();
  private readonly refs: ComputedLiveState<GitRefsState>;
  private readonly remotes: ComputedLiveState<GitRemotesState>;
  private readonly stashes: ComputedLiveState<GitStashesState>;
  private readonly worktrees: ComputedLiveState<GitWorktreesState>;
  private readonly checkouts = new Map<CheckoutId, CheckoutMount>();
  private readonly commonDirWatch: WatchHandle;
  private readonly onError: (context: string, error: unknown) => void;
  private disposed = false;

  static async create(options: RepositoryMountOptions): Promise<RepositoryMount> {
    const mount = new RepositoryMount(options);
    try {
      await mount.commonDirWatch.ready();
      return mount;
    } catch (error) {
      await mount.dispose();
      throw error;
    }
  }

  private constructor(private readonly options: RepositoryMountOptions) {
    this.identity = options.identity;
    this.repository = options.repository;
    this.onError = options.onError ?? (() => {});
    this.refs = this.computed('refs', () => this.repository.getRefs());
    this.remotes = this.computed('remotes', () => this.repository.getRemotes());
    this.stashes = this.computed('stashes', () => this.repository.getStashes());
    this.worktrees = this.computed('worktrees', () => this.repository.listWorktrees());
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
    return this.projection(name).prepare();
  }

  query<T>(read: (repository: GitRepository) => Promise<T>): Promise<T> {
    this.assertActive();
    return read(this.repository);
  }

  compute<T>(read: () => Promise<T>): Promise<T> {
    this.assertActive();
    return this.lane.run(read);
  }

  mutate<T, E>(
    operation: RepositoryOperation,
    mutationId: string | undefined,
    run: (repository: GitRepository) => Promise<Result<T, E>>,
    options: { objectTransfer?: boolean } = {}
  ): Promise<GitExecution<T, E>> {
    return this.execute(
      operation,
      undefined,
      'all',
      mutationId,
      () => run(this.repository),
      options.objectTransfer === true
    );
  }

  runJob<T, E>(
    operation: RepositoryOperation,
    run: (repository: GitRepository) => Promise<Result<T, E>>,
    options: { objectTransfer?: boolean } = {}
  ): Promise<Result<T, E>> {
    return this.mutate(operation, undefined, run, options).then((execution) => execution.result);
  }

  executeCheckout<T, E>(
    checkout: CheckoutMount,
    operation: CheckoutOperation,
    paths: 'all' | readonly string[],
    mutationId: string | undefined,
    run: () => Promise<Result<T, E>>,
    options: { objectTransfer?: boolean } = {}
  ): Promise<GitExecution<T, E>> {
    return this.execute(
      operation,
      checkout,
      paths,
      mutationId,
      run,
      options.objectTransfer === true
    );
  }

  registerCheckout(checkout: CheckoutMount): Unsubscribe {
    this.assertActive();
    const id = checkout.identity.checkoutId;
    this.checkouts.set(id, checkout);
    return () => {
      if (this.checkouts.get(id) === checkout) this.checkouts.delete(id);
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.commonDirWatch.release();
    await this.lane.drain();
    this.refs.dispose();
    this.remotes.dispose();
    this.stashes.dispose();
    this.worktrees.dispose();
    this.checkouts.clear();
    await this.repository.dispose();
  }

  private async execute<T, E>(
    operation: RepositoryOperation | CheckoutOperation,
    checkout: CheckoutMount | undefined,
    paths: 'all' | readonly string[],
    mutationId: string | undefined,
    run: () => Promise<Result<T, E>>,
    objectTransfer: boolean
  ): Promise<GitExecution<T, E>> {
    this.assertActive();
    const result = await this.lane.run(() =>
      objectTransfer
        ? this.options.objectStoreMutex.runExclusive(this.identity.objectStoreId, run)
        : run()
    );
    const plan = effectPlanFor(
      operation,
      {
        repositoryId: this.identity.repositoryId,
        checkoutId: checkout?.identity.checkoutId,
        activeCheckoutIds: [...this.checkouts.keys()],
        paths,
      },
      result.success ? 'success' : 'failure'
    );
    const settled = await this.applyPlan(plan, mutationId, diffReasonFor(operation), checkout);
    return { result, settled };
  }

  private async applyPlan(
    plan: GitEffectPlan,
    mutationId: string | undefined,
    diffReason: FileDiffStalenessReason,
    invokingCheckout: CheckoutMount | undefined
  ): Promise<GitSettledState[]> {
    const settled: GitSettledState[] = [];
    for (const effect of plan.settle) {
      try {
        const cursor = await this.refreshEffect(effect, mutationId, invokingCheckout);
        if (cursor) settled.push(cursor);
      } catch (error) {
        this.onError(`settle ${effect.kind}`, error);
        this.invalidateEffect(effect, 'background', diffReason);
      }
    }
    for (const effect of plan.eager) this.invalidateEffect(effect, 'eager', diffReason);
    for (const effect of plan.background) {
      this.invalidateEffect(effect, 'background', diffReason);
    }
    return settled;
  }

  private async refreshEffect(
    effect: GitEffect,
    mutationId: string | undefined,
    invokingCheckout: CheckoutMount | undefined
  ): Promise<GitSettledState | undefined> {
    switch (effect.kind) {
      case 'repository-refs':
      case 'repository-remotes':
      case 'repository-stashes':
      case 'repository-worktrees': {
        const name = effect.kind.slice('repository-'.length) as RepositoryStateName;
        const cursor = await this.projection(name).refresh({ mutationId });
        return { name, cursor };
      }
      case 'checkout-status':
      case 'checkout-head': {
        const checkout = this.checkouts.get(effect.checkoutId) ?? invokingCheckout;
        if (!checkout || checkout.identity.checkoutId !== effect.checkoutId) return undefined;
        const name = effect.kind === 'checkout-status' ? 'status' : 'head';
        const cursor = await checkout.refresh(name, mutationId);
        return { name, cursor };
      }
      case 'file-diff':
        return undefined;
    }
  }

  private invalidateEffect(
    effect: GitEffect,
    urgency: 'eager' | 'background',
    diffReason: FileDiffStalenessReason
  ): void {
    switch (effect.kind) {
      case 'repository-refs':
      case 'repository-remotes':
      case 'repository-stashes':
      case 'repository-worktrees': {
        const name = effect.kind.slice('repository-'.length) as RepositoryStateName;
        this.invalidateProjection(this.projection(name), urgency, `refresh ${name}`);
        return;
      }
      case 'checkout-status':
      case 'checkout-head': {
        const checkout = this.checkouts.get(effect.checkoutId);
        checkout?.invalidate(effect.kind === 'checkout-status' ? 'status' : 'head', urgency);
        return;
      }
      case 'file-diff':
        this.checkouts.get(effect.checkoutId)?.bumpFileDiff(effect.paths, diffReason);
    }
  }

  private onCommonDirEvents(events: Parameters<typeof classifyGitWatchEvents>[0]): void {
    const classification = classifyGitWatchEvents(events, this.layout());
    if (classification.repo.refs) this.invalidateProjection(this.refs, 'background', 'refs watch');
    if (classification.repo.remotes) {
      this.invalidateProjection(this.remotes, 'background', 'remotes watch');
    }
    if (classification.repo.stashes) {
      this.invalidateProjection(this.stashes, 'background', 'stashes watch');
    }
    if (classification.repo.worktrees) {
      this.invalidateProjection(this.worktrees, 'background', 'worktrees watch');
    }
    for (const [id, effects] of classification.worktrees) {
      this.applyWorktreeWatchEffects(id as CheckoutId, effects);
    }
  }

  private onCommonDirResync(): void {
    this.refs.invalidate();
    this.remotes.invalidate();
    this.stashes.invalidate();
    this.worktrees.invalidate();
    for (const checkout of this.checkouts.values()) {
      checkout.applyRepositoryWatchEffects({ status: true, head: true });
    }
  }

  private applyWorktreeWatchEffects(id: CheckoutId, effects: WorktreeWatchEffects): void {
    const checkout = this.checkouts.get(id);
    if (!checkout) return;
    checkout.applyRepositoryWatchEffects(effects);
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

  private projection(name: RepositoryStateName): ComputedLiveState<unknown> {
    switch (name) {
      case 'refs':
        return this.refs as ComputedLiveState<unknown>;
      case 'remotes':
        return this.remotes as ComputedLiveState<unknown>;
      case 'stashes':
        return this.stashes as ComputedLiveState<unknown>;
      case 'worktrees':
        return this.worktrees as ComputedLiveState<unknown>;
    }
  }

  private invalidateProjection<T>(
    state: ComputedLiveState<T>,
    urgency: 'eager' | 'background',
    context: string
  ): void {
    state.invalidate();
    if (urgency === 'eager' && state.observed) {
      void state.refresh().catch((error) => this.onError(context, error));
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('RepositoryMount is disposed');
  }
}

function diffReasonFor(
  operation: RepositoryOperation | CheckoutOperation
): FileDiffStalenessReason {
  if (
    operation === 'stage' ||
    operation === 'unstage' ||
    operation === 'stageAll' ||
    operation === 'unstageAll' ||
    operation === 'stageHunk' ||
    operation === 'unstageHunk' ||
    operation === 'stashPush' ||
    operation === 'stashApply' ||
    operation === 'stashPop'
  ) {
    return 'index-changed';
  }
  if (
    operation === 'revert' ||
    operation === 'revertAll' ||
    operation === 'clean' ||
    operation === 'discardHunk'
  ) {
    return 'content-changed';
  }
  return 'ref-changed';
}
