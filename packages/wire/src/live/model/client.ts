import type { Logger } from '@emdash/shared/logger';
import type z from 'zod';
import type { WireInstrumentation } from '../../observability';
import { LiveFollower, type LiveFollowerApplyResult } from '../follower';
import type { LiveCursor, LiveSnapshot, LiveUpdate } from '../protocol';
import { applyPatches, type Patch } from './immer-setup';

type CursorWaiter = {
  target: LiveCursor;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

type MutationWaiter = {
  mutationId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export type LiveChangeMeta = { kind: 'seed' } | { kind: 'update'; mutationIds: string[] };

export type LiveModelClientOptions = {
  instrumentation?: WireInstrumentation;
  logger?: Logger;
  topic?: string;
};

export class LiveModelClient<T> extends LiveFollower<T> {
  private cursorWaiters: CursorWaiter[] = [];
  private mutationWaiters: MutationWaiter[] = [];
  private readonly schema: z.ZodType<T>;
  private readonly onChange: (value: T, meta: LiveChangeMeta) => void;

  constructor(
    schema: z.ZodType<T>,
    refetchSnapshot: () => Promise<LiveSnapshot<T>>,
    onChange: (value: T, meta: LiveChangeMeta) => void,
    options: LiveModelClientOptions = {}
  ) {
    super(refetchSnapshot, { ...options, label: 'live model' });
    this.schema = schema;
    this.onChange = onChange;
  }

  /** Resolves when local state provably includes the given cursor. */
  waitForCursor(target: LiveCursor, timeoutMs = 15_000): Promise<void> {
    if (this.cursorSatisfies(target)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: CursorWaiter = {
        target,
        resolve,
        reject,
        timer:
          timeoutMs > 0
            ? setTimeout(() => {
                this.cursorWaiters = this.cursorWaiters.filter((candidate) => candidate !== waiter);
                reject(new Error(`Timed out waiting for live cursor ${formatCursor(target)}`));
              }, timeoutMs)
            : undefined,
      };
      this.cursorWaiters.push(waiter);
    });
  }

  /**
   * Resolves when an update tagged with this mutation ID is applied.
   * Any seed/resync also resolves because a fresh snapshot is authoritative.
   */
  waitForMutation(mutationId: string, timeoutMs = 15_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: MutationWaiter = {
        mutationId,
        resolve,
        reject,
        timer:
          timeoutMs > 0
            ? setTimeout(() => {
                this.mutationWaiters = this.mutationWaiters.filter(
                  (candidate) => candidate !== waiter
                );
                reject(new Error(`Timed out waiting for live mutation ${mutationId}`));
              }, timeoutMs)
            : undefined,
      };
      this.mutationWaiters.push(waiter);
    });
  }

  /**
   * Validates the patched result against the schema.
   * Skipped entirely in production — the generation + baseSequence gap guards
   * are the primary correctness mechanism; schema validation is a dev-only
   * safety net that catches shape regressions early.
   */
  protected onSeeded(data: T): void {
    this.onChange(data, { kind: 'seed' });
    this.flushCursorWaiters();
    this.flushAllMutationWaiters();
  }

  protected applyDelta(update: LiveUpdate): LiveFollowerApplyResult<T> {
    try {
      // applyPatches returns a new structurally-shared reference — untouched
      // subtrees keep identity, which allows downstream memoized selectors to
      // avoid recomputing on unchanged branches.
      const next = applyPatches(this.value as object, update.delta as Patch[]) as T;
      const validated = this.validate(next);
      return validated.ok ? { ok: true, value: next } : validated;
    } catch (error) {
      return { ok: false, reason: 'patch-failed', details: { error } };
    }
  }

  protected onApplied(value: T, update: LiveUpdate): void {
    this.onChange(value, { kind: 'update', mutationIds: update.mutationIds ?? [] });
    this.flushCursorWaiters();
    this.flushMutationWaiters(update.mutationIds ?? []);
  }

  private validate(next: unknown): { ok: true } | LiveFollowerApplyResult<T> {
    if (readNodeEnv() === 'production') return { ok: true };
    const r = this.schema.safeParse(next);
    if (!r.success) {
      return { ok: false, reason: 'validation', details: { error: r.error } };
    }
    return { ok: true };
  }

  private cursorSatisfies(target: LiveCursor): boolean {
    const cursor = this.cursor;
    if (!cursor) return false;
    if (cursor.generation > target.generation) return true;
    return cursor.generation === target.generation && cursor.sequence >= target.sequence;
  }

  private flushCursorWaiters(): void {
    const ready = this.cursorWaiters.filter((waiter) => this.cursorSatisfies(waiter.target));
    if (ready.length === 0) return;
    this.cursorWaiters = this.cursorWaiters.filter(
      (waiter) => !this.cursorSatisfies(waiter.target)
    );
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private flushMutationWaiters(mutationIds: string[]): void {
    if (mutationIds.length === 0) return;
    const ids = new Set(mutationIds);
    const ready = this.mutationWaiters.filter((waiter) => ids.has(waiter.mutationId));
    if (ready.length === 0) return;
    this.mutationWaiters = this.mutationWaiters.filter((waiter) => !ids.has(waiter.mutationId));
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private flushAllMutationWaiters(): void {
    const ready = this.mutationWaiters;
    if (ready.length === 0) return;
    this.mutationWaiters = [];
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }
}

function formatCursor(cursor: LiveCursor): string {
  return `${cursor.generation}:${cursor.sequence}`;
}

function readNodeEnv(): string | undefined {
  return typeof process !== 'undefined' ? process.env['NODE_ENV'] : undefined;
}
