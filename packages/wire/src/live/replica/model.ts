import { Emitter, type Unsubscribe } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { z } from 'zod';
import type { ThinLiveHandle } from '../../api/client';
import type { WireInstrumentation } from '../../observability';
import { LiveFollower, type LiveFollowerApplyResult } from '../follower';
import type { LiveChangeMeta } from '../model';
import { LiveModelWaiters } from '../model/waiters';
import type { LiveCursor, LiveSnapshot, LiveSource, LiveUpdate, Patch } from '../protocol';
import { createPlainStore, type StateStore } from './store';

export type ReplicaModelOptions<T> = {
  store?: StateStore<T>;
  schema?: z.ZodType<T>;
  onChange?: (value: T, meta: LiveChangeMeta) => void;
  instrumentation?: WireInstrumentation;
  logger?: Logger;
};

export class ReplicaModel<T> extends LiveFollower<T> implements LiveSource {
  readonly ready: Promise<void>;

  private readonly emitter = new Emitter<LiveUpdate>();
  private readonly store: StateStore<T>;
  private readonly schema: z.ZodType<T> | undefined;
  private readonly waiters = new LiveModelWaiters(() => this.cursor);
  private readonly localWaiters = new LiveModelWaiters(() => this.localCursor());
  private readonly detachPromise: Promise<Unsubscribe>;
  private localGeneration = nextGeneration();
  private localSequence = 0;
  private upstreamBase: LiveCursor | undefined;
  private disposed = false;

  constructor(
    private readonly handle: ThinLiveHandle<T>,
    private readonly deps: ReplicaModelOptions<T> = {}
  ) {
    super(() => handle.snapshot(), {
      instrumentation: deps.instrumentation,
      logger: deps.logger,
      topic: handle.topic,
      label: 'replica model',
    });
    this.store = deps.store ?? createPlainStore<T>();
    this.schema = deps.schema;
    this.ready = handle.snapshot().then((snapshot) => this.seed(snapshot));
    this.detachPromise = handle.attach((update) => this.applyUpdate(update), {
      onReattach: () => void this.refresh(),
    });
  }

  current(): T {
    return this.store.current();
  }

  async snapshot(): Promise<LiveSnapshot<unknown>> {
    await this.ready;
    return {
      generation: this.localGeneration,
      sequence: this.localSequence,
      timestamp: Date.now(),
      data: structuredClone(this.store.current()),
    };
  }

  subscribe(cb: (update: LiveUpdate) => void): Unsubscribe {
    return this.emitter.subscribe(cb);
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

  override seed(snapshot: LiveSnapshot<T>): void {
    this.upstreamBase = {
      generation: snapshot.generation,
      sequence: snapshot.sequence,
    };
    super.seed(snapshot);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.waiters.rejectAll(new Error('ReplicaModel disposed'));
    this.localWaiters.rejectAll(new Error('ReplicaModel disposed'));
    this.emitter.clear();
    (await this.detachPromise)();
  }

  protected onSeeded(data: T): void {
    this.store.reset(data);
    this.localGeneration = nextGeneration(this.localGeneration);
    this.localSequence = 0;
    this.deps.onChange?.(this.store.current(), { kind: 'seed' });
    this.waiters.flushCursorWaiters();
    this.waiters.flushAllMutationWaiters();
    this.localWaiters.flushCursorWaiters();
  }

  protected applyDelta(update: LiveUpdate): LiveFollowerApplyResult<T> {
    try {
      const next = this.store.apply(update.delta as Patch[]);
      if (!this.schema || readNodeEnv() === 'production') return { ok: true, value: next };
      const parsed = this.schema.safeParse(next);
      return parsed.success
        ? { ok: true, value: next }
        : { ok: false, reason: 'validation', details: { error: parsed.error } };
    } catch (error) {
      return { ok: false, reason: 'patch-failed', details: { error } };
    }
  }

  protected onApplied(_value: T, update: LiveUpdate): void {
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
    this.deps.onChange?.(this.store.current(), {
      kind: 'update',
      mutationIds: update.mutationIds ?? [],
    });
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
}

function nextGeneration(previous = 0): number {
  return Math.max(Date.now(), previous + 1);
}

function readNodeEnv(): string | undefined {
  return typeof process !== 'undefined' ? process.env['NODE_ENV'] : undefined;
}
