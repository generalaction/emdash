import type { Logger } from '@emdash/shared/logger';
import type z from 'zod';
import type { WireInstrumentation } from '../../observability';
import { LiveFollower, type LiveFollowerApplyResult } from '../follower';
import type { LiveCursor, LiveSnapshot, LiveUpdate } from '../protocol';
import { applyPatches, type Patch } from './immer-setup';
import { LiveStateWaiters } from './waiters';

export type LiveChangeMeta = { kind: 'seed' } | { kind: 'update'; mutationIds: string[] };

export type LiveStateClientOptions = {
  instrumentation?: WireInstrumentation;
  logger?: Logger;
  topic?: string;
};

export class LiveStateClient<T> extends LiveFollower<T> {
  private readonly waiters = new LiveStateWaiters(() => this.cursor);
  private readonly schema: z.ZodType<T>;
  private readonly onChange: (value: T, meta: LiveChangeMeta) => void;

  constructor(
    schema: z.ZodType<T>,
    refetchSnapshot: () => Promise<LiveSnapshot<T>>,
    onChange: (value: T, meta: LiveChangeMeta) => void,
    options: LiveStateClientOptions = {}
  ) {
    super(refetchSnapshot, { ...options, label: 'live model' });
    this.schema = schema;
    this.onChange = onChange;
  }

  /** Resolves when local state provably includes the given cursor. */
  waitForCursor(target: LiveCursor, timeoutMs = 15_000): Promise<void> {
    return this.waiters.waitForCursor(target, timeoutMs);
  }

  /**
   * Resolves when an update tagged with this mutation ID is applied.
   * Any seed/resync also resolves because a fresh snapshot is authoritative.
   */
  waitForMutation(mutationId: string, timeoutMs = 15_000): Promise<void> {
    return this.waiters.waitForMutation(mutationId, timeoutMs);
  }

  /**
   * Validates the patched result against the schema.
   * Skipped entirely in production — the generation + baseSequence gap guards
   * are the primary correctness mechanism; schema validation is a dev-only
   * safety net that catches shape regressions early.
   */
  protected onSeeded(data: T): void {
    this.onChange(data, { kind: 'seed' });
    this.waiters.flushCursorWaiters();
    this.waiters.flushAllMutationWaiters();
  }

  protected applyDelta(update: LiveUpdate): LiveFollowerApplyResult<T> {
    try {
      // applyPatches returns a new structurally-shared reference — untouched
      // subtrees keep identity, which allows downstream memoized selectors to
      // avoid recomputing on unchanged branches.
      const next = applyPatches(this.value as object, update.delta as Patch[]) as T;
      const validated = validateSchema(this.schema, next);
      return validated.ok ? { ok: true, value: next } : validated;
    } catch (error) {
      return { ok: false, reason: 'patch-failed', details: { error } };
    }
  }

  protected onApplied(value: T, update: LiveUpdate): void {
    this.onChange(value, { kind: 'update', mutationIds: update.mutationIds ?? [] });
    this.waiters.flushCursorWaiters();
    this.waiters.flushMutationWaiters(update.mutationIds ?? []);
  }
}

function validateSchema<T>(
  schema: z.ZodType<T>,
  next: unknown
): { ok: true } | LiveFollowerApplyResult<T> {
  if (readNodeEnv() === 'production') return { ok: true };
  const r = schema.safeParse(next);
  if (!r.success) {
    return { ok: false, reason: 'validation', details: { error: r.error } };
  }
  return { ok: true };
}

function readNodeEnv(): string | undefined {
  return typeof process !== 'undefined' ? process.env['NODE_ENV'] : undefined;
}
