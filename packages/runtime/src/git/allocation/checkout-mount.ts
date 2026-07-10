import path from 'node:path';
import type {
  BoundFileDiffKey,
  CheckoutHeadState,
  CheckoutStatusState,
  FileDiffStalenessReason,
} from '@emdash/core/git';
import type { IWatchService, WatchHandle } from '@emdash/core/services/fs-watch/api';
import type { PendingLease, Result, Unsubscribe } from '@emdash/shared';
import { ComputedLiveState, type LiveCursor, type LiveSource } from '@emdash/wire';
import type { GitCheckout } from '../checkout/git-checkout';
import type { CheckoutOperation } from './effect-plan';
import { FileDiffRegistry } from './file-diff-registry';
import type { CheckoutIdentity } from './identity';
import type { GitExecution } from './repository-mount';
import type { RepositoryMount } from './repository-mount';
import type { WorktreeWatchEffects } from './watch-classifier';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

export type CheckoutStateName = 'status' | 'head';

export type CheckoutMountOptions = Readonly<{
  identity: CheckoutIdentity;
  checkout: GitCheckout;
  repository: RepositoryMount;
  watcher: IWatchService;
  onError?: (context: string, error: unknown) => void;
  maxFileDiffStates?: number;
}>;

/** Live orchestration for one checkout, retained together with its parent repository mount. */
export class CheckoutMount {
  readonly identity: CheckoutIdentity;
  readonly checkout: GitCheckout;
  readonly repository: RepositoryMount;

  private readonly status: ComputedLiveState<CheckoutStatusState>;
  private readonly head: ComputedLiveState<CheckoutHeadState>;
  private readonly fileDiffs: FileDiffRegistry;
  private readonly worktreeWatch: WatchHandle;
  private readonly unregister: Unsubscribe;
  private readonly onError: (context: string, error: unknown) => void;
  private disposed = false;

  static async create(options: CheckoutMountOptions): Promise<CheckoutMount> {
    const mount = new CheckoutMount(options);
    try {
      await mount.worktreeWatch.ready();
      return mount;
    } catch (error) {
      await mount.dispose();
      throw error;
    }
  }

  private constructor(options: CheckoutMountOptions) {
    this.identity = options.identity;
    this.checkout = options.checkout;
    this.repository = options.repository;
    this.onError = options.onError ?? (() => {});
    this.status = this.computed('status', () => this.checkout.getStatus());
    this.head = this.computed('head', () => this.checkout.getHead());
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
    return this.projection(name).prepare();
  }

  acquireFileDiffStaleness(key: BoundFileDiffKey): PendingLease<LiveSource> {
    this.assertActive();
    return this.fileDiffs.acquire(key);
  }

  query<T>(read: (checkout: GitCheckout) => Promise<T>): Promise<T> {
    this.assertActive();
    return read(this.checkout);
  }

  mutate<T, E>(
    operation: CheckoutOperation,
    paths: 'all' | readonly string[],
    mutationId: string | undefined,
    run: (checkout: GitCheckout) => Promise<Result<T, E>>,
    options: { objectTransfer?: boolean } = {}
  ): Promise<GitExecution<T, E>> {
    this.assertActive();
    return this.repository.executeCheckout(
      this,
      operation,
      paths,
      mutationId,
      () => run(this.checkout),
      options
    );
  }

  runJob<T, E>(
    operation: CheckoutOperation,
    run: (checkout: GitCheckout) => Promise<Result<T, E>>,
    options: { objectTransfer?: boolean } = {}
  ): Promise<Result<T, E>> {
    return this.mutate(operation, 'all', undefined, run, options).then(
      (execution) => execution.result
    );
  }

  refresh(name: CheckoutStateName, mutationId?: string): Promise<LiveCursor> {
    return this.projection(name).refresh({ mutationId });
  }

  invalidate(name: CheckoutStateName, urgency: 'eager' | 'background'): void {
    const state = this.projection(name);
    state.invalidate();
    if (urgency === 'eager' && state.observed) {
      void state.refresh().catch((error) => this.onError(`refresh ${name}`, error));
    }
  }

  bumpFileDiff(paths: 'all' | readonly string[], reason: FileDiffStalenessReason): void {
    this.fileDiffs.bump(paths, reason);
  }

  applyRepositoryWatchEffects(effects: WorktreeWatchEffects): void {
    if (effects.status) this.invalidate('status', 'background');
    if (effects.head) this.invalidate('head', 'background');
    if (effects.head) this.fileDiffs.bump('all', 'ref-changed');
    else if (effects.status) this.fileDiffs.bump('all', 'index-changed');
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unregister();
    await this.worktreeWatch.release();
    this.status.dispose();
    this.head.dispose();
    this.fileDiffs.dispose();
  }

  private onWorktreeEvents(events: { path: string }[]): void {
    this.invalidate('status', 'background');
    const paths = events.map((event) => this.toRelativePath(event.path));
    this.fileDiffs.bump(paths, 'content-changed');
  }

  private onWorktreeResync(): void {
    this.status.invalidate();
    this.head.invalidate();
    this.fileDiffs.bump('all', 'content-changed');
  }

  private computed<T>(name: string, compute: () => Promise<T>): ComputedLiveState<T> {
    return new ComputedLiveState({
      compute: () => this.repository.compute(compute),
      debounceMs: WATCH_DEBOUNCE_MS,
      revalidateIntervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => this.onError(`${name} ${this.identity.checkoutRoot}`, error),
    });
  }

  private projection(name: CheckoutStateName): ComputedLiveState<unknown> {
    return name === 'status'
      ? (this.status as ComputedLiveState<unknown>)
      : (this.head as ComputedLiveState<unknown>);
  }

  private toRelativePath(filePath: string): string {
    return path.relative(this.identity.checkoutRoot, filePath).replace(/\\/g, '/');
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('CheckoutMount is disposed');
  }
}
