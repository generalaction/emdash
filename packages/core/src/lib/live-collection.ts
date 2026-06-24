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
export type ScopeKey<K> = K | null;

export type CollectionSnapshot<K, V> = {
  entries: Array<[K, V]>;
  generation: number;
  sequence: number;
};

export type CollectionUpdate<K, V> =
  | ({ kind: 'snapshot' } & CollectionSnapshot<K, V>)
  | { kind: 'delta'; generation: number; ops: Array<KeyedOp<K, V>>; sequence: number };

export type LiveCollectionOptions<K, V> = {
  /** Used to suppress no-op updates. */
  isEqual?: (a: V, b: V) => boolean;
  /** Maps each value to the scope that owns it. Required for loadScope/unloadScope. */
  scopeOf?: (value: V) => ScopeKey<K>;
};

/**
 * A keyed live collection backed by an authoritative in-memory mergebox.
 *
 * Subscribers synchronously receive a current snapshot baseline before any future delta.
 */
export class LiveCollection<K, V, E = unknown> implements IDisposable {
  private static lastGeneration = 0;

  private readonly emitter = new Emitter<CollectionUpdate<K, V>>();
  private readonly isEqual: (a: V, b: V) => boolean;

  private disposed = false;
  private entries = new Map<K, V>();
  private generation = LiveCollection.nextGeneration();
  private loadedScopeKeys = new Set<ScopeKey<K>>();
  private loadingScopes = new Map<ScopeKey<K>, Promise<Result<number, E>>>();
  private sequence = 0;

  constructor(private readonly options: LiveCollectionOptions<K, V> = {}) {
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

  subscribe(cb: (update: CollectionUpdate<K, V>) => void): Unsubscribe {
    this.assertNotDisposed();
    const unsubscribe = this.emitter.subscribe(cb);
    try {
      cb({ kind: 'snapshot', ...this.snapshot() });
    } catch (error) {
      unsubscribe();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unsubscribe();
    };
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
    return this.resetInternal(entries);
  }

  resetWithNewGeneration(entries?: Iterable<readonly [K, V]>): number {
    return this.resetInternal(entries, { bumpGeneration: true });
  }

  loadScope(
    scope: ScopeKey<K>,
    load: () => Promise<Result<Iterable<readonly [K, V]>, E>>
  ): Promise<Result<number, E>> {
    this.assertNotDisposed();
    this.assertScoped();
    const existing = this.loadingScopes.get(scope);
    if (existing) return existing;

    const loading = this.loadScopeInternal(scope, load);
    this.loadingScopes.set(scope, loading);
    void loading.then(
      () => {
        if (this.loadingScopes.get(scope) === loading) this.loadingScopes.delete(scope);
      },
      () => {
        if (this.loadingScopes.get(scope) === loading) this.loadingScopes.delete(scope);
      }
    );
    return loading;
  }

  isScopeLoaded(scope: ScopeKey<K>): boolean {
    return this.loadedScopeKeys.has(scope);
  }

  loadedScopes(): Array<ScopeKey<K>> {
    return [...this.loadedScopeKeys];
  }

  unloadScope(scope: ScopeKey<K>): number {
    if (this.disposed) return this.sequence;
    this.assertScoped();
    this.loadedScopeKeys.delete(scope);
    const ops: Array<KeyedOp<K, V>> = [];
    for (const [key, value] of this.entries) {
      if (this.scopeOf(value) === scope) ops.push({ op: 'del', key });
    }
    return this.apply(ops);
  }

  private resetInternal(
    entries?: Iterable<readonly [K, V]>,
    options: { bumpGeneration?: boolean } = {}
  ): number {
    if (this.disposed) return this.sequence;
    if (options.bumpGeneration) this.generation = LiveCollection.nextGeneration();
    this.entries = new Map(entries);
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
    this.emitter.clear();
  }

  private static nextGeneration(): number {
    LiveCollection.lastGeneration = Math.max(LiveCollection.lastGeneration + 1, Date.now());
    return LiveCollection.lastGeneration;
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

  private async loadScopeInternal(
    scope: ScopeKey<K>,
    load: () => Promise<Result<Iterable<readonly [K, V]>, E>>
  ): Promise<Result<number, E>> {
    const loaded = await load();
    if (!loaded.success) return err(loaded.error);

    const nextEntries = new Map<K, V>();
    for (const [key, value] of loaded.data) {
      const actualScope = this.scopeOf(value);
      if (actualScope !== scope) {
        throw new Error('LiveCollection loadScope loaded an entry outside the requested scope');
      }
      nextEntries.set(key, value);
    }

    const currentEntries = new Map<K, V>();
    for (const [key, value] of this.entries) {
      if (this.scopeOf(value) === scope) currentEntries.set(key, value);
    }

    const ops = this.diff(currentEntries, nextEntries);
    this.loadedScopeKeys.add(scope);
    return ok(this.apply(ops));
  }

  private scopeOf(value: V): ScopeKey<K> {
    const scopeOf = this.options.scopeOf;
    if (!scopeOf)
      throw new Error('LiveCollection scopeOf option is required for scoped operations');
    return scopeOf(value);
  }

  private assertScoped(): void {
    if (!this.options.scopeOf) {
      throw new Error('LiveCollection scopeOf option is required for scoped operations');
    }
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
