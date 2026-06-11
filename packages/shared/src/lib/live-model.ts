import { Emitter } from './emitter';
import type { IDisposable, Unsubscribe } from './lifecycle';

export type LiveValue<T> = {
  value: T;
  seq: number;
};

export type LiveModelOptions<T> = {
  /** Compute the latest value. */
  compute: () => Promise<T>;
  /** Debounce window for invalidation-triggered recomputes. Defaults to 0 (next tick). */
  debounceMs?: number;
  /** While subscribed, recompute at this interval even without invalidation. */
  revalidateIntervalMs?: number;
  /** Receives errors from background recomputes (invalidation, revalidation). */
  onError?: (error: unknown) => void;
};

/**
 * A cached, invalidation-driven model.
 *
 * - Holds the latest computed value with a monotonic seq.
 * - Recomputes are single-flight; a `refresh()` during an in-flight compute queues exactly
 *   one trailing run and resolves with its result.
 * - Demand-gated: `invalidate()` only marks dirty while there are no subscribers; the next
 *   `get()`/`subscribe()` computes lazily. With subscribers, invalidation triggers a debounced
 *   recompute whose result is pushed to all subscribers.
 * - Stale-while-revalidate: the cached value outlives subscribers; a failed recompute keeps
 *   the last-good value, leaves the model dirty, and pushes nothing.
 */
export class LiveModel<T> implements IDisposable {
  private cached: LiveValue<T> | undefined;
  private seq = 0;
  private dirty = true;
  private disposed = false;
  private inFlight: Promise<LiveValue<T>> | null = null;
  private inFlightToken: object | null = null;
  private queued: Promise<LiveValue<T>> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private revalidateTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly emitter = new Emitter<LiveValue<T>>();

  constructor(private readonly options: LiveModelOptions<T>) {}

  get subscriberCount(): number {
    return this.emitter.size;
  }

  getCached(): LiveValue<T> | undefined {
    return this.cached;
  }

  async get(): Promise<LiveValue<T>> {
    this.assertNotDisposed();
    if (this.cached && !this.dirty) return this.cached;
    if (this.inFlight) return this.inFlight;
    return this.schedule();
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
    return this.schedule();
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

  private schedule(): Promise<LiveValue<T>> {
    if (this.inFlight) {
      this.queued ??= this.inFlight.then(
        () => this.runNow(),
        () => this.runNow()
      );
      return this.queued;
    }
    return this.runNow();
  }

  private runNow(): Promise<LiveValue<T>> {
    this.queued = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const token = {};
    this.inFlightToken = token;
    const run = (async () => {
      this.dirty = false;
      let succeeded = false;
      try {
        const value = await this.options.compute();
        succeeded = true;
        const update: LiveValue<T> = { value, seq: ++this.seq };
        this.cached = update;
        if (!this.disposed) this.emitter.emit(update);
        return update;
      } catch (error) {
        this.dirty = true;
        throw error;
      } finally {
        if (this.inFlightToken === token) {
          this.inFlightToken = null;
          this.inFlight = null;
        }
        this.armRevalidate();
        if (succeeded && this.dirty && !this.queued && this.emitter.size > 0) {
          this.scheduleDebounced();
        }
      }
    })();
    this.inFlight = run;
    return run;
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
    void this.schedule().catch((error) => this.options.onError?.(error));
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
