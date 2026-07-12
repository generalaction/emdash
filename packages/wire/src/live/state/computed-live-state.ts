import { isDeepEqual, type Unsubscribe } from '@emdash/shared';
import { systemClock, type Clock, type TimerHandle } from '../../scheduling';
import type { LiveCursor, LiveSource, LiveUpdate } from '../protocol';
import { LiveState } from './server';

export type ComputedLiveStateOptions<T> = Readonly<{
  compute: () => Promise<T>;
  debounceMs?: number;
  revalidateIntervalMs?: number;
  isEqual?: (left: T, right: T) => boolean;
  onError?: (error: unknown) => void;
  clock?: Clock;
}>;

/**
 * Lazily recomputes an authoritative value and publishes it through LiveState.
 *
 * Invalidation is demand-gated: an unobserved state stays dirty until prepare,
 * while an observed state refreshes after the configured debounce. Explicit
 * refresh calls are ordered and return the cursor containing their result.
 */
export class ComputedLiveState<T> {
  private readonly source: LiveSource;
  private readonly isEqual: (left: T, right: T) => boolean;
  private state: LiveState<T> | undefined;
  private current: T | undefined;
  private dirty = true;
  private disposed = false;
  private subscriberCount = 0;
  private inFlight: Promise<LiveCursor> | undefined;
  private queued: Promise<LiveCursor> | undefined;
  private debounceTimer: TimerHandle | undefined;
  private revalidateTimer: TimerHandle | undefined;
  private readonly clock: Clock;

  constructor(private readonly options: ComputedLiveStateOptions<T>) {
    this.isEqual = options.isEqual ?? isDeepEqual;
    this.clock = options.clock ?? systemClock;
    this.source = {
      snapshot: async () => {
        await this.prepare();
        return this.requireState().snapshot();
      },
      subscribe: (listener) => this.subscribe(listener),
    };
  }

  get initialized(): boolean {
    return this.state !== undefined;
  }

  get observed(): boolean {
    return this.subscriberCount > 0;
  }

  async prepare(): Promise<LiveSource> {
    this.assertActive();
    if (this.inFlight) {
      await (this.queued ?? this.inFlight);
      return this.source;
    }
    if (!this.state || this.dirty) await this.refresh();
    return this.source;
  }

  invalidate(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.observed) this.scheduleDebounced();
  }

  refresh(options: { mutationId?: string } = {}): Promise<LiveCursor> {
    this.assertActive();
    this.clearDebounce();
    if (this.inFlight) {
      this.dirty = true;
      this.queued ??= this.inFlight.then(
        () => this.runNow(options.mutationId),
        () => this.runNow(options.mutationId)
      );
      return this.queued;
    }
    return this.runNow(options.mutationId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.state?.dispose();
    this.subscriberCount = 0;
  }

  private subscribe(listener: (update: LiveUpdate) => void): Unsubscribe {
    this.assertActive();
    const state = this.requireState();
    this.subscriberCount += 1;
    const unsubscribe = state.subscribe(listener);
    if (this.dirty) this.scheduleDebounced();
    else this.armRevalidation();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      unsubscribe();
      this.subscriberCount = Math.max(0, this.subscriberCount - 1);
      if (!this.observed) this.clearTimers();
    };
  }

  private runNow(mutationId?: string): Promise<LiveCursor> {
    this.queued = undefined;
    const run = (async () => {
      this.dirty = false;
      let completed = false;
      try {
        const fresh = await this.options.compute();
        this.assertActive();

        if (!this.state) {
          this.current = fresh;
          this.state = new LiveState(fresh);
          completed = true;
          return this.state.cursor;
        }

        const cursor = this.isEqual(this.current as T, fresh)
          ? this.state.cursor
          : this.state.replace(fresh, {
              mutationIds: mutationId ? [mutationId] : undefined,
            });
        this.current = fresh;
        completed = true;
        return cursor;
      } catch (error) {
        this.dirty = true;
        throw error;
      } finally {
        this.inFlight = undefined;
        this.armRevalidation();
        if (completed && this.dirty && this.observed && !this.queued) this.scheduleDebounced();
      }
    })();
    this.inFlight = run;
    return run;
  }

  private scheduleDebounced(): void {
    if (this.disposed) return;
    this.clearDebounce();
    this.debounceTimer = this.clock.schedule(
      this.options.debounceMs ?? 0,
      () => {
        this.debounceTimer = undefined;
        if (!this.dirty || !this.observed || this.disposed) return;
        this.refreshInBackground();
      },
      { unref: true }
    );
  }

  private refreshInBackground(): void {
    void this.refresh().catch((error: unknown) => this.options.onError?.(error));
  }

  private armRevalidation(): void {
    const interval = this.options.revalidateIntervalMs;
    if (!interval || !this.observed || this.disposed) return;
    this.revalidateTimer?.dispose();
    this.revalidateTimer = this.clock.schedule(
      interval,
      () => {
        this.revalidateTimer = undefined;
        if (!this.observed || this.disposed) return;
        this.dirty = true;
        this.refreshInBackground();
      },
      { unref: true }
    );
  }

  private clearDebounce(): void {
    if (!this.debounceTimer) return;
    this.debounceTimer.dispose();
    this.debounceTimer = undefined;
  }

  private clearTimers(): void {
    this.clearDebounce();
    this.revalidateTimer?.dispose();
    this.revalidateTimer = undefined;
  }

  private requireState(): LiveState<T> {
    if (!this.state) throw new Error('ComputedLiveState must be prepared before subscription');
    return this.state;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('ComputedLiveState is disposed');
  }
}
