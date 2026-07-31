import { isDeepEqual, type Unsubscribe } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { systemClock, type Clock, type TimerHandle } from '@emdash/shared/scheduling';
import {
  StateNode,
  type CommitOptions,
  type Readable,
  type Revision,
  type StateInstrumentation,
  type StateStatus,
} from './core';
import type { PokeSubscription } from './poke';

export type QueryLane = {
  run<T>(work: () => Promise<T> | T): Promise<T>;
};

export type QueryOptions<T> = {
  fetch: (context: { signal: AbortSignal }) => Promise<T>;
  pokes?: readonly PokeSubscription[];
  equals?: (left: T, right: T) => boolean;
  initial?: T;
  debounceMs?: number;
  revalidateEveryMs?: number;
  lane?: QueryLane;
  name?: string;
  onError?: (error: unknown) => void;
  clock?: Clock;
  scope?: Scope;
  instrumentation?: StateInstrumentation;
  onObservedChange?: (observed: boolean) => void;
};

export interface Query<T> extends Readable<T | undefined> {
  invalidate(): void;
  refresh(options?: { mutationIds?: readonly string[] }): Promise<Revision>;
  settle(
    update: T | ((previous: T | undefined) => T),
    options?: { mutationIds?: readonly string[] }
  ): Revision;
  dispose(): void;
}

class QueryNode<T> extends StateNode<T | undefined> implements Query<T> {
  private readonly clock: Clock;
  private readonly unsubscribePokes: Unsubscribe[] = [];
  private initialized: boolean;
  private dirty = true;
  private disposed = false;
  private debounceTimer: TimerHandle | undefined;
  private revalidateTimer: TimerHandle | undefined;
  private controller: AbortController | undefined;
  private inFlight: Promise<Revision> | undefined;
  private queued: Promise<Revision> | undefined;

  constructor(private readonly queryOptions: QueryOptions<T>) {
    super(queryOptions.initial, {
      equals: queryOptions.equals as (left: T | undefined, right: T | undefined) => boolean,
      name: queryOptions.name,
      instrumentation: queryOptions.instrumentation,
      onObservedChange: queryOptions.onObservedChange,
    });
    this.clock = queryOptions.clock ?? systemClock;
    this.initialized = queryOptions.initial !== undefined;
    this.snapshotValue = {
      ...this.snapshotValue,
      status: this.initialized ? 'live' : 'loading',
    };
    for (const poke of queryOptions.pokes ?? []) {
      this.unsubscribePokes.push(poke.subscribe(() => this.invalidate()));
    }
    queryOptions.scope?.add(() => this.dispose());
  }

  invalidate(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.initialized) this.publishStatus('stale');
    if (this.observed) this.scheduleDebounced();
  }

  refresh(options: { mutationIds?: readonly string[] } = {}): Promise<Revision> {
    this.assertActive();
    this.clearDebounce();
    if (this.inFlight) {
      this.dirty = true;
      this.queued ??= this.inFlight.then(
        () => this.runNow(options.mutationIds),
        () => this.runNow(options.mutationIds)
      );
      return this.queued;
    }
    return this.runNow(options.mutationIds);
  }

  settle(
    update: T | ((previous: T | undefined) => T),
    options: { mutationIds?: readonly string[] } = {}
  ): Revision {
    this.assertActive();
    const previous = this.peek();
    if (typeof update === 'function' && previous === undefined) return this.currentRevision();
    const next =
      typeof update === 'function' ? (update as (previous: T | undefined) => T)(previous) : update;
    this.initialized = true;
    this.dirty = false;
    return this.commit(next, {
      status: 'live',
      mutationIds: options.mutationIds,
      observedAt: this.clock.now(),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribePokes) unsubscribe();
    this.unsubscribePokes.length = 0;
    this.clearTimers();
    this.controller?.abort(new Error('Query disposed'));
  }

  protected override onObserved(): void {
    if (!this.initialized || this.dirty) this.scheduleDebounced();
    else this.armRevalidation();
  }

  protected override onUnobserved(): void {
    this.clearTimers();
  }

  private runNow(mutationIds?: readonly string[]): Promise<Revision> {
    this.queued = undefined;
    this.clearDebounce();
    const startedAtRevision = this.currentSnapshot().revision;
    const run = (async () => {
      this.dirty = false;
      const controller = new AbortController();
      this.controller = controller;
      try {
        const fresh = await this.withLane(() =>
          this.queryOptions.fetch({ signal: controller.signal })
        );
        this.assertActive();
        if (this.currentSnapshot().revision > startedAtRevision) {
          return this.currentRevision();
        }
        this.initialized = true;
        return this.commit(fresh, {
          status: 'live',
          mutationIds,
          observedAt: this.clock.now(),
        });
      } catch (error) {
        this.dirty = false;
        this.publishStatus('error', { error });
        this.queryOptions.onError?.(error);
        throw error;
      } finally {
        if (this.controller === controller) this.controller = undefined;
        this.inFlight = undefined;
        this.armRevalidation();
        if (this.dirty && this.observed && !this.queued) this.scheduleDebounced();
      }
    })();
    this.inFlight = run;
    return run;
  }

  private publishStatus(status: StateStatus, options: Pick<CommitOptions, 'error'> = {}): void {
    this.commit(this.peek(), {
      status,
      error: options.error,
    });
  }

  private scheduleDebounced(): void {
    if (this.disposed) return;
    this.clearDebounce();
    this.debounceTimer = this.clock.schedule(
      this.queryOptions.debounceMs ?? 0,
      () => {
        this.debounceTimer = undefined;
        if (!this.dirty || !this.observed || this.disposed) return;
        void this.refresh().catch(() => {});
      },
      { unref: true }
    );
  }

  private armRevalidation(): void {
    const interval = this.queryOptions.revalidateEveryMs;
    if (!interval || !this.observed || this.disposed) return;
    this.revalidateTimer?.dispose();
    this.revalidateTimer = this.clock.schedule(
      interval,
      () => {
        this.revalidateTimer = undefined;
        if (!this.observed || this.disposed) return;
        this.dirty = true;
        void this.refresh().catch(() => {});
      },
      { unref: true }
    );
  }

  private clearTimers(): void {
    this.clearDebounce();
    this.revalidateTimer?.dispose();
    this.revalidateTimer = undefined;
  }

  private clearDebounce(): void {
    this.debounceTimer?.dispose();
    this.debounceTimer = undefined;
  }

  private withLane<R>(work: () => Promise<R>): Promise<R> {
    return this.queryOptions.lane ? this.queryOptions.lane.run(work) : work();
  }

  private currentRevision(): Revision {
    return {
      nodeId: this.id,
      revision: this.currentSnapshot().revision,
      generation: this.currentSnapshot().generation,
      mutationIds: this.currentSnapshot().mutationIds,
    };
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Query is disposed');
  }
}

export function query<T>(options: QueryOptions<T>): Query<T> {
  return new QueryNode({
    ...options,
    equals: options.equals ?? isDeepEqual,
  });
}
