import {
  Emitter,
  err,
  isDeepEqual,
  ok,
  type IDisposable,
  type Result,
  type Unsubscribe,
} from '@emdash/shared';

export type LiveValue<T> = {
  value: T;
  generation: number;
  sequence: number;
};

type LiveModelRun<T, E> = {
  result: Result<LiveValue<T>, E>;
  completed: boolean;
};

export type LiveModelOptions<T, E = unknown> = {
  /** Compute the latest value. */
  compute: () => Promise<Result<T, E>>;
  /** Debounce window for invalidation-triggered recomputes. Defaults to 0 (next tick). */
  debounceMs?: number;
  /** While subscribed, recompute at this interval even without invalidation. */
  revalidateIntervalMs?: number;
  /** Used to suppress no-op updates. */
  isEqual?: (a: T, b: T) => boolean;
  /** Receives errors returned by background recomputes. */
  onError?: (error: E) => void;
};

/**
 * A cached, invalidation-driven model.
 *
 * - Holds the latest computed value with a monotonic sequence.
 * - Recomputes are single-flight; a `refresh()` during an in-flight compute queues exactly
 *   one trailing run and resolves with its result.
 * - Demand-gated: `invalidate()` only marks dirty while there are no subscribers; the next
 *   `get()`/`subscribe()` computes lazily. With subscribers, invalidation triggers a debounced
 *   recompute whose result is pushed to all subscribers.
 * - Stale-while-revalidate: the cached value outlives subscribers; a failed recompute keeps
 *   the last-good value, leaves the model dirty, and pushes nothing.
 */
export class LiveModel<T, E = unknown> implements IDisposable {
  private static lastGeneration = 0;

  private readonly emitter = new Emitter<LiveValue<T>>();
  private readonly generation = LiveModel.nextGeneration();
  private readonly isEqual: (a: T, b: T) => boolean;

  private cached: LiveValue<T> | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = true;
  private disposed = false;
  private inFlight: Promise<Result<LiveValue<T>, E>> | null = null;
  private inFlightToken: object | null = null;
  private queued: Promise<Result<LiveValue<T>, E>> | null = null;
  private revalidateTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;

  constructor(private readonly options: LiveModelOptions<T, E>) {
    this.isEqual = options.isEqual ?? isDeepEqual;
  }

  get subscriberCount(): number {
    return this.emitter.size;
  }

  getCached(): LiveValue<T> | undefined {
    return this.cached;
  }

  async get(): Promise<LiveValue<T>> {
    this.assertNotDisposed();
    if (this.cached && !this.dirty) return this.cached;
    const result = await this.schedule();
    if (!result.success) throw result.error;
    return result.data;
  }

  subscribe(cb: (update: LiveValue<T>) => void): Unsubscribe {
    this.assertNotDisposed();
    const unsubscribe = this.emitter.subscribe(cb);
    if (this.dirty || !this.cached) {
      this.scheduleBackground();
    } else {
      this.armRevalidate();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unsubscribe();
      if (this.emitter.size === 0) this.clearTimers();
    };
  }

  async refresh(): Promise<LiveValue<T>> {
    this.assertNotDisposed();
    const result = await this.schedule();
    if (!result.success) throw result.error;
    return result.data;
  }

  invalidate(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.emitter.size === 0) return;
    this.scheduleDebounced();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.emitter.clear();
  }

  private static nextGeneration(): number {
    LiveModel.lastGeneration = Math.max(LiveModel.lastGeneration + 1, Date.now());
    return LiveModel.lastGeneration;
  }

  private schedule(): Promise<Result<LiveValue<T>, E>> {
    if (this.inFlight) {
      this.queued ??= this.inFlight.then(
        () => this.runNow(),
        () => this.runNow()
      );
      return this.queued;
    }
    return this.runNow();
  }

  private runNow(): Promise<Result<LiveValue<T>, E>> {
    this.queued = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const token = {};
    this.inFlightToken = token;
    const run = (async () => {
      this.dirty = false;
      let completed = false;
      try {
        const outcome = await this.recompute();
        completed = outcome.completed;
        if (!completed) this.dirty = true;
        return outcome.result;
      } catch (error) {
        this.dirty = true;
        throw error;
      } finally {
        if (this.inFlightToken === token) {
          this.inFlightToken = null;
          this.inFlight = null;
        }
        this.armRevalidate();
        if (completed && this.dirty && !this.queued && this.emitter.size > 0) {
          this.scheduleDebounced();
        }
      }
    })();
    this.inFlight = run;
    return run;
  }

  private async recompute(): Promise<LiveModelRun<T, E>> {
    const computed = await this.options.compute();
    if (!computed.success) {
      return { result: err(computed.error), completed: false };
    }
    const value = computed.data;
    if (this.cached && this.isEqual(value, this.cached.value)) {
      return { result: ok(this.cached), completed: true };
    }
    const update: LiveValue<T> = {
      value,
      generation: this.generation,
      sequence: ++this.sequence,
    };
    this.cached = update;
    if (!this.disposed) this.emitter.emit(update);
    return { result: ok(update), completed: true };
  }

  private scheduleDebounced(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.dirty || this.disposed) return;
      this.scheduleBackground();
    }, this.options.debounceMs ?? 0);
  }

  private scheduleBackground(): void {
    void this.schedule()
      .then((result) => {
        if (!result.success) this.options.onError?.(result.error);
      })
      .catch((error) => {
        queueMicrotask(() => {
          throw error;
        });
      });
  }

  private armRevalidate(): void {
    const interval = this.options.revalidateIntervalMs;
    if (!interval || this.disposed || this.emitter.size === 0) return;
    if (this.revalidateTimer) clearTimeout(this.revalidateTimer);
    this.revalidateTimer = setTimeout(() => {
      this.revalidateTimer = null;
      if (this.disposed || this.emitter.size === 0) return;
      this.scheduleBackground();
    }, interval);
  }

  private clearTimers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    if (this.revalidateTimer) clearTimeout(this.revalidateTimer);
    this.revalidateTimer = null;
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('LiveModel disposed');
  }
}
