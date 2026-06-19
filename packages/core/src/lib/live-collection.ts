import {
  Emitter,
  err,
  isDeepEqual,
  ok,
  type IDisposable,
  type Result,
  type Unsubscribe,
} from '@emdash/shared';

export type KeyedOp<K, V> = { op: 'put'; key: K; value: V } | { op: 'del'; key: K };

export type CollectionSnapshot<K, V> = {
  entries: Array<[K, V]>;
  generation: number;
  sequence: number;
};

export type CollectionUpdate<K, V> =
  | ({ kind: 'snapshot' } & CollectionSnapshot<K, V>)
  | { kind: 'delta'; generation: number; ops: Array<KeyedOp<K, V>>; sequence: number };

export type LiveCollectionOptions<K, V, E = unknown> = {
  /** Compute the full current collection. Omit for driven mode. */
  compute?: () => Promise<Result<Iterable<readonly [K, V]>, E>>;
  /** Debounce window for invalidation-triggered recomputes. Defaults to 0 (next tick). */
  debounceMs?: number;
  /** Used to suppress no-op puts and no-op recompute diffs. */
  isEqual?: (a: V, b: V) => boolean;
  /** Receives errors from background recomputes (invalidation, revalidation, subscribe). */
  onError?: (error: E) => void;
  /** While subscribed, recompute at this interval even without invalidation. */
  revalidateIntervalMs?: number;
};

/**
 * A keyed live collection backed by an authoritative in-memory mergebox.
 *
 * Subscribers synchronously receive a current snapshot baseline before any future delta.
 * Recomputes are demand-gated and single-flight, following the same lifecycle as LiveModel.
 */
export class LiveCollection<K, V, E = unknown> implements IDisposable {
  private static lastGeneration = 0;

  private readonly emitter = new Emitter<CollectionUpdate<K, V>>();
  private readonly generation = LiveCollection.nextGeneration();
  private readonly isEqual: (a: V, b: V) => boolean;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty: boolean;
  private disposed = false;
  private entries = new Map<K, V>();
  private inFlight: Promise<Result<CollectionSnapshot<K, V>, E>> | null = null;
  private inFlightToken: object | null = null;
  private queued: Promise<Result<CollectionSnapshot<K, V>, E>> | null = null;
  private revalidateTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;

  constructor(private readonly options: LiveCollectionOptions<K, V, E> = {}) {
    this.dirty = Boolean(options.compute);
    this.isEqual = options.isEqual ?? isDeepEqual;
  }

  get size(): number {
    return this.entries.size;
  }

  get subscriberCount(): number {
    return this.emitter.size;
  }

  getCached(): CollectionSnapshot<K, V> {
    return this.snapshot();
  }

  async get(): Promise<Result<CollectionSnapshot<K, V>, E>> {
    this.assertNotDisposed();
    if (!this.options.compute || !this.dirty) return ok(this.snapshot());
    if (this.inFlight) return this.inFlight;
    return this.schedule();
  }

  async refresh(): Promise<Result<CollectionSnapshot<K, V>, E>> {
    this.assertNotDisposed();
    if (!this.options.compute) return ok(this.snapshot());
    return this.schedule();
  }

  subscribe(cb: (update: CollectionUpdate<K, V>) => void): Unsubscribe {
    this.assertNotDisposed();
    const unsubscribe = this.emitter.subscribe(cb);
    try {
      cb({ kind: 'snapshot', ...this.snapshot() });
    } catch (error) {
      unsubscribe();
      throw error;
    }
    if (this.options.compute && this.dirty) {
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

  invalidate(): void {
    if (this.disposed || !this.options.compute) return;
    this.dirty = true;
    if (this.emitter.size === 0) return;
    this.scheduleDebounced();
  }

  apply(ops: Array<KeyedOp<K, V>>): number {
    if (this.disposed) return this.sequence;
    if (ops.length === 0) return this.sequence;

    const originals = new Map<K, { had: boolean; value: V | undefined }>();
    for (const op of ops) {
      if (!originals.has(op.key)) {
        originals.set(op.key, { had: this.entries.has(op.key), value: this.entries.get(op.key) });
      }
      if (op.op === 'put') {
        this.entries.set(op.key, op.value);
      } else {
        this.entries.delete(op.key);
      }
    }

    const effectiveOps: Array<KeyedOp<K, V>> = [];
    for (const [key, original] of originals) {
      const has = this.entries.has(key);
      const value = this.entries.get(key);
      if (!has) {
        if (original.had) effectiveOps.push({ op: 'del', key });
        continue;
      }
      if (!original.had || !this.isEqual(value as V, original.value as V)) {
        effectiveOps.push({ op: 'put', key, value: value as V });
        continue;
      }
      this.entries.set(key, original.value as V);
    }

    if (effectiveOps.length === 0) return this.sequence;

    const update: CollectionUpdate<K, V> = {
      kind: 'delta',
      generation: this.generation,
      ops: effectiveOps,
      sequence: ++this.sequence,
    };
    this.emitter.emit(update);
    return update.sequence;
  }

  put(key: K, value: V): number {
    return this.apply([{ op: 'put', key, value }]);
  }

  delete(key: K): number {
    return this.apply([{ op: 'del', key }]);
  }

  reset(entries?: Iterable<readonly [K, V]>): number {
    if (this.disposed) return this.sequence;
    this.entries = new Map(entries);
    this.dirty = false;
    const update: CollectionUpdate<K, V> = {
      kind: 'snapshot',
      ...this.snapshot(++this.sequence),
    };
    this.emitter.emit(update);
    return update.sequence;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.emitter.clear();
  }

  private static nextGeneration(): number {
    LiveCollection.lastGeneration = Math.max(LiveCollection.lastGeneration + 1, Date.now());
    return LiveCollection.lastGeneration;
  }

  private schedule(): Promise<Result<CollectionSnapshot<K, V>, E>> {
    if (!this.options.compute) return Promise.resolve(ok(this.snapshot()));
    if (this.inFlight) {
      this.queued ??= this.inFlight.then(
        () => this.runNow(),
        () => this.runNow()
      );
      return this.queued;
    }
    return this.runNow();
  }

  private runNow(): Promise<Result<CollectionSnapshot<K, V>, E>> {
    const compute = this.options.compute;
    if (!compute) return Promise.resolve(ok(this.snapshot()));

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
        const computed = await compute();
        if (!computed.success) {
          this.dirty = true;
          return err(computed.error);
        }

        const computedEntries = new Map(computed.data);
        succeeded = true;
        const effectiveOps = this.diff(this.entries, computedEntries);
        if (effectiveOps.length === 0) return ok(this.snapshot());

        this.entries = computedEntries;
        const update: CollectionUpdate<K, V> = {
          kind: 'delta',
          generation: this.generation,
          ops: effectiveOps,
          sequence: ++this.sequence,
        };
        if (!this.disposed) this.emitter.emit(update);
        return ok(this.snapshot());
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

  private diff(from: Map<K, V>, to: Map<K, V>): Array<KeyedOp<K, V>> {
    const ops: Array<KeyedOp<K, V>> = [];
    for (const key of from.keys()) {
      if (!to.has(key)) ops.push({ op: 'del', key });
    }
    for (const [key, value] of to) {
      const current = from.get(key);
      if (!from.has(key) || !this.isEqual(value, current as V)) {
        ops.push({ op: 'put', key, value });
      }
    }
    return ops;
  }

  private snapshot(sequence = this.sequence): CollectionSnapshot<K, V> {
    return {
      entries: [...this.entries],
      generation: this.generation,
      sequence,
    };
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
    if (!interval || !this.options.compute || this.disposed || this.emitter.size === 0) return;
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
    if (this.disposed) throw new Error('LiveCollection disposed');
  }
}
