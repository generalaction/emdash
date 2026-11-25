import type { Result, Unsubscribe } from '@emdash/shared';
import { z } from 'zod';

/**
 * Generic subscription-channel vocabulary shared by every live endpoint kind.
 * These shapes are what actually travels over the wire for topics
 * (snapshot/update/cursor) and mutations (envelope/result); the concrete live
 * primitives interpret the opaque deltas. The RPC core depends only on this
 * module, never on the live layer.
 */

export const liveCursorSchema = z.object({
  generation: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
});

export type LiveCursor = z.infer<typeof liveCursorSchema>;

export const liveCursorEntrySchema = z.object({
  model: z.string(),
  key: z.unknown(),
  cursor: liveCursorSchema,
});

export type LiveCursorEntry = z.infer<typeof liveCursorEntrySchema>;

export function liveSnapshotSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    generation: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    data: data,
  });
}

export type LiveSnapshot<T> = {
  generation: number;
  sequence: number;
  timestamp: number;
  data: T;
};

export const liveUpdateSchema = z.object({
  generation: z.number().int().nonnegative(),
  baseSequence: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  /** Transport-opaque delta interpreted by the concrete live primitive. */
  delta: z.unknown(),
  /** IDs of client mutations whose effects this update contains. */
  mutationIds: z.array(z.string()).optional(),
});

export type LiveUpdate = z.infer<typeof liveUpdateSchema>;

export type LiveAttachmentErrorContext = {
  retrying: boolean;
};

export type LiveSubscribeOptions = {
  onGap?: () => void;
  onError?: (error: unknown, context: LiveAttachmentErrorContext) => void;
  signal?: AbortSignal;
  pressure?: PressureSignal;
};

export type PressureSignal = {
  readonly paused: boolean;
  onChange(cb: (paused: boolean) => void): () => void;
};

export function createPressureSignal(): PressureSignal & { set(paused: boolean): void } {
  let paused = false;
  const listeners = new Set<(paused: boolean) => void>();
  return {
    get paused() {
      return paused;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    set(next: boolean) {
      if (next === paused) return;
      paused = next;
      for (const listener of [...listeners]) listener(paused);
    },
  };
}

export function anyPressure(
  ...signals: Array<PressureSignal | undefined | null>
): PressureSignal & { dispose(): void } {
  const active = signals.filter((signal): signal is PressureSignal => signal != null);
  const combined = createPressureSignal();
  const unsubscribers: Array<() => void> = [];
  let disposed = false;
  const update = (): void => combined.set(active.some((signal) => signal.paused));
  for (const signal of active) unsubscribers.push(signal.onChange(update));
  update();
  return {
    get paused() {
      return combined.paused;
    },
    onChange(cb) {
      if (disposed) return () => {};
      return combined.onChange(cb);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      combined.set(false);
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers.length = 0;
    },
  };
}

export type SnapshotSince = {
  generation: number;
  offset: number;
};

export type SnapshotOptions = {
  since?: SnapshotSince;
};

export interface LiveSource {
  snapshot(options?: SnapshotOptions): LiveSnapshot<unknown> | Promise<LiveSnapshot<unknown>>;
  subscribe(
    cb: (update: LiveUpdate) => void,
    options?: LiveSubscribeOptions
  ): Unsubscribe | Promise<Unsubscribe>;
}

export const liveLogSnapshotDataSchema = z.object({
  baseOffset: z.number().int().nonnegative(),
  text: z.string(),
  truncated: z.boolean(),
});

export type LiveLogSnapshotData = z.infer<typeof liveLogSnapshotDataSchema>;

export const eventStreamSnapshotDataSchema = z.object({});

export type EventStreamSnapshotData = z.infer<typeof eventStreamSnapshotDataSchema>;

/** A draft-mutating function applied by live-state producers and contract mutation handlers. */
export type Mutator<T> = (draft: T) => void;

export type LiveMutationInput<I> = I & {
  mutationId?: string;
};

export type LiveMutationSuccess<D> = {
  data: D;
  cursors: LiveCursorEntry[];
};

export type LiveMutationResult<D, E> = Result<LiveMutationSuccess<D>, E>;

export function createMutationId(): string {
  return `mutation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
