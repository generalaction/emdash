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
  /** While subscribed, recompute at this interval even without invalidation. */
  revalidateIntervalMs?: number;
  /** Used to suppress no-op updates. */
  isEqual?: (a: V, b: V) => boolean;
  /** Receives errors returned by background recomputes. */
  onError?: (error: E) => void;
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
  private readonly scheduler: LiveScheduler<Result<CollectionSnapshot<K, V>, E>> | null;

  private disposed = false;
  private entries = new Map<K, V>();
  private sequence = 0;

  constructor(private readonly options: LiveCollectionOptions<K, V, E> = {}) {
    const compute = options.compute;
    this.isEqual = options.isEqual ?? isDeepEqual;
    this.scheduler = compute
      ? new LiveScheduler<Result<CollectionSnapshot<K, V>, E>>({
          run: () => this.recompute(compute),
          hasDemand: () => this.emitter.size > 0,
          initialDirty: true,
          debounceMs: options.debounceMs,
          revalidateIntervalMs: options.revalidateIntervalMs,
          onBackgroundResult: (result) => {
            if (!result.success) options.onError?.(result.error);
          },
        })
      : null;
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
    if (!this.scheduler || !this.scheduler.dirty) return ok(this.snapshot());
    return this.scheduler.runDirect();
  }

  async refresh(): Promise<Result<CollectionSnapshot<K, V>, E>> {
    this.assertNotDisposed();
    if (!this.scheduler) return ok(this.snapshot());
    return this.scheduler.runDirect();
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
    this.scheduler?.onDemandAvailable();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unsubscribe();
      this.scheduler?.onDemandUnavailable();
    };
  }

  invalidate(): void {
    if (this.disposed) return;
    this.scheduler?.markDirty();
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
    this.scheduler?.markClean();
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
    this.scheduler?.dispose();
    this.emitter.clear();
  }

  private static nextGeneration(): number {
    LiveCollection.lastGeneration = Math.max(LiveCollection.lastGeneration + 1, Date.now());
    return LiveCollection.lastGeneration;
  }

  private async recompute(
    compute: () => Promise<Result<Iterable<readonly [K, V]>, E>>
  ): Promise<LiveSchedulerRun<Result<CollectionSnapshot<K, V>, E>>> {
    const computed = await compute();
    if (!computed.success) {
      return { result: err(computed.error), completed: false };
    }

    const computedEntries = new Map(computed.data);
    const effectiveOps = this.diff(this.entries, computedEntries);
    if (effectiveOps.length === 0) {
      return { result: ok(this.snapshot()), completed: true };
    }

    this.entries = computedEntries;
    const update: CollectionUpdate<K, V> = {
      kind: 'delta',
      generation: this.generation,
      ops: effectiveOps,
      sequence: ++this.sequence,
    };
    if (!this.disposed) this.emitter.emit(update);
    return { result: ok(this.snapshot()), completed: true };
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

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('LiveCollection disposed');
  }
}
