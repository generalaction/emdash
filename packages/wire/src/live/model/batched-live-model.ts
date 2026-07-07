import type { Unsubscribe } from '@emdash/shared';
import type { LiveCursor, LiveSnapshot, LiveUpdate } from '../protocol';
import type { LiveModelProduceOptions, LiveModelServer } from './server';

export type Mutator<T> = (draft: T) => void;

export type FlushScheduler = (flush: () => void) => void;

type PendingMutation<T> = {
  mutator: Mutator<T>;
  mutationIds: string[];
};

/** Coalesces within the current microtask checkpoint (next-tick batching). */
export const microtaskScheduler: FlushScheduler = (flush) => queueMicrotask(flush);

/**
 * Trailing-debounce scheduler: accumulates mutations over `ms` milliseconds
 * then flushes once at the end of the window.
 */
export function timerScheduler(ms: number): FlushScheduler {
  return (flush) => void setTimeout(flush, ms);
}

/**
 * Wraps a LiveModelServer with a mutation queue so that multiple calls to
 * `enqueue()` within one scheduler window are coalesced into a single
 * `server.produce()`. Immer then emits one minimal patch for the net effect:
 *
 * - Rename followed by parent-folder-delete → one patch removing the parent
 *   (the rename's writes are subsumed and never appear in the output patch).
 * - N writes to the same field → last-write-wins, one patch.
 * - N completely independent field writes → one combined patch with N ops.
 *
 * The default scheduler is `microtaskScheduler` (coalesces within a tick).
 * Pass `timerScheduler(ms)` for time-windowed coalescing, or a custom
 * synchronous scheduler in tests.
 */
export class BatchedLiveModel<T> {
  private pending: PendingMutation<T>[] = [];
  private scheduled = false;
  private disposed = false;

  constructor(
    private readonly model: LiveModelServer<T>,
    private readonly schedule: FlushScheduler = microtaskScheduler
  ) {}

  /**
   * Enqueues a mutation for the next flush. Schedules a flush automatically if
   * one is not already scheduled. Silently ignored after `dispose()`.
   */
  enqueue(mutator: Mutator<T>, options: LiveModelProduceOptions = {}): void {
    if (this.disposed) return;
    this.pending.push({ mutator, mutationIds: options.mutationIds ?? [] });
    if (!this.scheduled) {
      this.scheduled = true;
      this.schedule(() => this.flush());
    }
  }

  /**
   * Immediately applies all queued mutators inside a single `server.produce()`
   * so Immer emits exactly one minimal LiveUpdate (or none if all mutations
   * are no-ops). Safe to call manually before taking a snapshot or on dispose.
   *
   * If the combined mutator throws, Immer aborts atomically — server state is
   * unchanged and no patch is emitted. The batch is logged and dropped.
   */
  flush(): LiveCursor | undefined {
    this.scheduled = false;
    if (this.pending.length === 0) return undefined;
    const pending = this.pending;
    this.pending = [];
    try {
      return this.model.produce(
        (draft) => {
          for (const entry of pending) entry.mutator(draft);
        },
        { mutationIds: uniqueMutationIds(pending) }
      );
    } catch (err) {
      console.warn('[BatchedLiveModel] mutation batch threw — batch dropped', err);
      return undefined;
    }
  }

  /**
   * Flushes any pending mutations then returns a snapshot from the underlying
   * server. Ensures snapshot + subsequent patches are strictly ordered: a
   * client that seeds from this snapshot and then subscribes will never see a
   * patch whose baseSequence is behind the snapshot's sequence.
   */
  snapshot(): LiveSnapshot<T> {
    this.flush();
    return this.model.snapshot();
  }

  subscribe(cb: (update: LiveUpdate) => void): Unsubscribe {
    return this.model.subscribe(cb);
  }

  reseed(next?: T): void {
    this.pending = [];
    this.scheduled = false;
    this.model.reseed(next);
  }

  /**
   * Flushes remaining mutations and marks the instance as disposed. Further
   * `enqueue()` calls are silently ignored. Call on session/resource teardown.
   */
  dispose(): void {
    this.flush();
    this.disposed = true;
    this.pending = [];
  }
}

function uniqueMutationIds<T>(pending: PendingMutation<T>[]): string[] | undefined {
  const ids = new Set<string>();
  for (const entry of pending) {
    for (const id of entry.mutationIds) ids.add(id);
  }
  return ids.size > 0 ? [...ids] : undefined;
}
