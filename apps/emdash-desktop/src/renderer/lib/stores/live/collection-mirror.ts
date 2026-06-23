import type { CollectionSnapshot, CollectionUpdate } from '@emdash/core/lib';
import { makeObservable, observable, runInAction } from 'mobx';
import { MirrorVersion } from './mirror-version';

type CollectionDelta<K, V> = Extract<CollectionUpdate<K, V>, { kind: 'delta' }>;

const DEFAULT_MAX_BUFFERED_DELTAS = 1_000;

export type CollectionMirrorOptions = {
  maxBufferedDeltas?: number;
};

export class CollectionMirror<K, V> {
  private revision = 0;
  private readonly version = new MirrorVersion('live collection', 'CollectionMirror');
  private readonly maxBufferedDeltas: number;
  private entriesByKey = new Map<K, V>();
  private readonly droppedBufferedDeltaGenerations = new Set<number>();
  private pendingDeltas: Array<CollectionDelta<K, V>> = [];

  constructor(options: CollectionMirrorOptions = {}) {
    this.maxBufferedDeltas = options.maxBufferedDeltas ?? DEFAULT_MAX_BUFFERED_DELTAS;
    makeObservable<this, 'revision'>(this, {
      revision: observable,
    });
  }

  get current(): CollectionSnapshot<K, V> | null {
    if (!this.hasSnapshot) return null;
    return this.snapshot();
  }

  get hasSnapshot(): boolean {
    return this.version.hasBaseline;
  }

  get sequence(): number {
    return this.version.sequence;
  }

  get generation(): number {
    return this.version.generation;
  }

  get size(): number {
    void this.revision;
    return this.entriesByKey.size;
  }

  entries(): Array<[K, V]> {
    void this.revision;
    return [...this.entriesByKey.entries()];
  }

  keys(): K[] {
    void this.revision;
    return [...this.entriesByKey.keys()];
  }

  values(): V[] {
    void this.revision;
    return [...this.entriesByKey.values()];
  }

  get(key: K): V | undefined {
    void this.revision;
    return this.entriesByKey.get(key);
  }

  has(key: K): boolean {
    void this.revision;
    return this.entriesByKey.has(key);
  }

  setSnapshot(snapshot: CollectionSnapshot<K, V>): void {
    this.applySnapshot(snapshot);
  }

  applyUpdate(update: CollectionUpdate<K, V>): void {
    if (update.kind === 'snapshot') {
      this.applySnapshot(update);
      return;
    }
    this.applyDelta(update);
  }

  waitForSequence(target: number, timeoutMs = 15_000): Promise<void> {
    return this.version.waitForSequence(target, timeoutMs);
  }

  dispose(): void {
    this.pendingDeltas = [];
    this.droppedBufferedDeltaGenerations.clear();
    this.version.dispose();
  }

  private applySnapshot(snapshot: CollectionSnapshot<K, V>): void {
    if (!this.version.shouldApply(snapshot.generation, snapshot.sequence)) return;
    const generationChanged = this.version.willChangeGeneration(snapshot.generation);
    runInAction(() => {
      this.entriesByKey = new Map(snapshot.entries);
      this.version.accept(snapshot.generation, snapshot.sequence);
      this.revision += 1;
    });
    this.version.flushAfterApply(generationChanged);
    if (this.droppedBufferedDeltaGenerations.delete(snapshot.generation)) {
      this.pendingDeltas = this.pendingDeltas.filter(
        (update) => update.generation !== snapshot.generation
      );
    }
    this.flushPendingDeltas();
  }

  private applyDelta(update: CollectionDelta<K, V>): void {
    if (!this.hasSnapshot || update.generation > this.generation) {
      this.bufferDelta(update);
      return;
    }
    if (!this.version.shouldApply(update.generation, update.sequence)) return;

    const generationChanged = this.version.willChangeGeneration(update.generation);
    runInAction(() => {
      for (const op of update.ops) {
        if (op.op === 'put') {
          this.entriesByKey.set(op.key, op.value);
        } else {
          this.entriesByKey.delete(op.key);
        }
      }
      this.version.accept(update.generation, update.sequence);
      this.revision += 1;
    });
    this.version.flushAfterApply(generationChanged);
  }

  private bufferDelta(update: CollectionDelta<K, V>): void {
    if (update.generation < this.generation) return;
    if (this.droppedBufferedDeltaGenerations.has(update.generation)) return;
    if (this.pendingDeltas.length >= this.maxBufferedDeltas) {
      for (const pending of this.pendingDeltas) {
        this.droppedBufferedDeltaGenerations.add(pending.generation);
      }
      this.droppedBufferedDeltaGenerations.add(update.generation);
      this.pendingDeltas = [];
      return;
    }
    this.pendingDeltas.push(update);
  }

  private flushPendingDeltas(): void {
    if (this.pendingDeltas.length === 0) return;
    const pending = this.pendingDeltas.sort(
      (a, b) => a.generation - b.generation || a.sequence - b.sequence
    );
    this.pendingDeltas = [];
    for (const update of pending) this.applyDelta(update);
  }

  private snapshot(): CollectionSnapshot<K, V> {
    void this.revision;
    return {
      entries: [...this.entriesByKey.entries()],
      generation: this.generation,
      sequence: this.sequence,
    };
  }
}
