import {
  Emitter,
  err,
  isDeepEqual,
  ok,
  type IDisposable,
  type Result,
  type Unsubscribe,
} from '@emdash/shared';
import { LiveScheduler, type LiveSchedulerRun } from './live-scheduler';

export type LiveValue<T> = {
  value: T;
  generation: number;
  sequence: number;
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
  private readonly scheduler: LiveScheduler<Result<LiveValue<T>, E>>;

  private cached: LiveValue<T> | undefined;
  private disposed = false;
  private sequence = 0;

  constructor(private readonly options: LiveModelOptions<T, E>) {
    this.isEqual = options.isEqual ?? isDeepEqual;
    this.scheduler = new LiveScheduler<Result<LiveValue<T>, E>>({
      run: () => this.recompute(),
      hasDemand: () => this.emitter.size > 0,
      initialDirty: true,
      debounceMs: options.debounceMs,
      revalidateIntervalMs: options.revalidateIntervalMs,
      onBackgroundResult: (result) => {
        if (!result.success) options.onError?.(result.error);
      },
    });
  }

  get subscriberCount(): number {
    return this.emitter.size;
  }

  getCached(): LiveValue<T> | undefined {
    return this.cached;
  }

  async get(): Promise<Result<LiveValue<T>, E>> {
    this.assertNotDisposed();
    if (this.cached && !this.scheduler.dirty) return ok(this.cached);
    return this.scheduler.runDirect();
  }

  subscribe(cb: (update: LiveValue<T>) => void): Unsubscribe {
    this.assertNotDisposed();
    const unsubscribe = this.emitter.subscribe(cb);
    this.scheduler.onDemandAvailable();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unsubscribe();
      this.scheduler.onDemandUnavailable();
    };
  }

  async refresh(): Promise<Result<LiveValue<T>, E>> {
    this.assertNotDisposed();
    return this.scheduler.runDirect();
  }

  invalidate(): void {
    if (this.disposed) return;
    this.scheduler.markDirty();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.dispose();
    this.emitter.clear();
  }

  private static nextGeneration(): number {
    LiveModel.lastGeneration = Math.max(LiveModel.lastGeneration + 1, Date.now());
    return LiveModel.lastGeneration;
  }

  private async recompute(): Promise<LiveSchedulerRun<Result<LiveValue<T>, E>>> {
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

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('LiveModel disposed');
  }
}
