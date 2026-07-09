import { Emitter, type Unsubscribe } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { z } from 'zod';
import type { LiveClientHandle } from '../../api/client';
import type { WireInstrumentation } from '../../observability';
import { LiveFollower } from '../follower';
import type { LiveCursor, LiveSnapshot, LiveSource, LiveUpdate } from '../protocol';
import type { LiveChangeMeta } from '../state';
import { LiveStateWaiters } from '../state/waiters';
import { createPlainStore, createStateMaterializer, type StateStore } from './store';

export type ReplicaStateOptions<T> = {
  store?: StateStore<T>;
  schema?: z.ZodType<T>;
  onChange?: (value: T, meta: LiveChangeMeta) => void;
  instrumentation?: WireInstrumentation;
  logger?: Logger;
};

type ReplicaStateChange<T> = {
  value: T;
  meta: LiveChangeMeta;
};

export class ReplicaState<T> implements LiveSource {
  readonly ready: Promise<void>;

  private readonly emitter = new Emitter<LiveUpdate>();
  private readonly changeEmitter = new Emitter<ReplicaStateChange<T>>();
  private readonly follower: LiveFollower<T>;
  private readonly store: StateStore<T>;
  private readonly waiters = new LiveStateWaiters(() => this.cursor);
  private readonly localWaiters = new LiveStateWaiters(() => this.localCursor());
  private readonly detachPromise: Promise<Unsubscribe>;
  private localGeneration = nextGeneration();
  private localSequence = 0;
  private upstreamBase: LiveCursor | undefined;
  private disposed = false;

  constructor(
    private readonly handle: LiveClientHandle<T>,
    private readonly deps: ReplicaStateOptions<T> = {}
  ) {
    this.store = deps.store ?? createPlainStore<T>();
    this.follower = new LiveFollower(
      () => handle.snapshot(),
      createStateMaterializer(this.store, deps.schema),
      {
        instrumentation: deps.instrumentation,
        logger: deps.logger,
        topic: handle.topic,
        label: 'replica model',
        onSeeded: () => this.handleSeeded(),
        onApplied: (update) => this.handleApplied(update),
      }
    );
    this.ready = handle.snapshot().then((snapshot) => this.seed(snapshot));
    this.detachPromise = handle.attach((update) => this.applyUpdate(update), {
      onReattach: () => void this.refresh(),
    });
  }

  current(): T {
    return this.store.current();
  }

  get cursor(): LiveCursor | undefined {
    return this.follower.cursor;
  }

  seed(snapshot: LiveSnapshot<T>): void {
    this.upstreamBase = {
      generation: snapshot.generation,
      sequence: snapshot.sequence,
    };
    this.follower.seed(snapshot);
  }

  applyUpdate(update: LiveUpdate): void {
    this.follower.applyUpdate(update);
  }

  refresh(): Promise<void> {
    return this.follower.refresh();
  }

  async snapshot(): Promise<LiveSnapshot<unknown>> {
    await this.ready;
    return {
      generation: this.localGeneration,
      sequence: this.localSequence,
      timestamp: Date.now(),
      data: structuredClone(this.store.serialize()),
    };
  }

  subscribe(cb: (update: LiveUpdate) => void): Unsubscribe {
    return this.emitter.subscribe(cb);
  }

  onChange(cb: (value: T, meta: LiveChangeMeta) => void): Unsubscribe {
    return this.changeEmitter.subscribe(({ value, meta }) => cb(value, meta));
  }

  waitForCursor(target: LiveCursor, timeoutMs = 15_000): Promise<void> {
    return this.waiters.waitForCursor(target, timeoutMs);
  }

  waitForLocalCursor(target: LiveCursor, timeoutMs = 15_000): Promise<void> {
    return this.localWaiters.waitForCursor(target, timeoutMs);
  }

  waitForMutation(mutationId: string, timeoutMs = 15_000): Promise<void> {
    return this.waiters.waitForMutation(mutationId, timeoutMs);
  }

  localCursorFor(upstream: LiveCursor): LiveCursor {
    const current = this.cursor;
    if (
      !current ||
      !this.upstreamBase ||
      current.generation !== upstream.generation ||
      this.upstreamBase.generation !== upstream.generation
    ) {
      return this.localCursor();
    }

    return {
      generation: this.localGeneration,
      sequence: Math.max(0, upstream.sequence - this.upstreamBase.sequence),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.waiters.rejectAll(new Error('ReplicaState disposed'));
    this.localWaiters.rejectAll(new Error('ReplicaState disposed'));
    this.emitter.clear();
    this.changeEmitter.clear();
    (await this.detachPromise)();
  }

  private handleSeeded(): void {
    this.localGeneration = nextGeneration(this.localGeneration);
    this.localSequence = 0;
    this.emitChange({ kind: 'seed' });
    this.waiters.flushCursorWaiters();
    this.waiters.flushAllMutationWaiters();
    this.localWaiters.flushCursorWaiters();
  }

  private handleApplied(update: LiveUpdate): void {
    const baseSequence = this.localSequence;
    this.localSequence += 1;
    this.emitter.emit({
      generation: this.localGeneration,
      baseSequence,
      sequence: this.localSequence,
      timestamp: update.timestamp,
      delta: update.delta,
      mutationIds: update.mutationIds,
    });
    this.emitChange({ kind: 'update', mutationIds: update.mutationIds ?? [] });
    this.waiters.flushCursorWaiters();
    this.waiters.flushMutationWaiters(update.mutationIds ?? []);
    this.localWaiters.flushCursorWaiters();
  }

  private localCursor(): LiveCursor {
    return {
      generation: this.localGeneration,
      sequence: this.localSequence,
    };
  }

  private emitChange(meta: LiveChangeMeta): void {
    const value = this.store.current();
    this.deps.onChange?.(value, meta);
    this.changeEmitter.emit({ value, meta });
  }
}

function nextGeneration(previous = 0): number {
  return Math.max(Date.now(), previous + 1);
}
