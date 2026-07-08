import type { SerializedError, Unsubscribe } from '@emdash/shared';
import { z } from 'zod';
import type { Patch } from '../state/immer-setup';

export type { Patch };

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

export interface LiveSource {
  snapshot(): LiveSnapshot<unknown> | Promise<LiveSnapshot<unknown>>;
  subscribe(cb: (update: LiveUpdate) => void): Unsubscribe;
}

export const liveLogSnapshotDataSchema = z.object({
  baseOffset: z.number().int().nonnegative(),
  text: z.string(),
  truncated: z.boolean(),
});

export type LiveLogSnapshotData = z.infer<typeof liveLogSnapshotDataSchema>;

export const liveLogDeltaSchema = z.object({
  chunk: z.string(),
});

export type LiveLogDelta = z.infer<typeof liveLogDeltaSchema>;

export const serializedErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
});

export function liveJobStateSchema<
  P extends z.ZodTypeAny,
  R extends z.ZodTypeAny,
  E extends z.ZodTypeAny,
>(progress: P, result: R, error: E) {
  return z.discriminatedUnion('status', [
    z.object({
      status: z.literal('running'),
      startedAt: z.number().int().nonnegative(),
      progress: z.array(progress),
      progressCount: z.number().int().nonnegative(),
    }),
    z.object({
      status: z.literal('succeeded'),
      startedAt: z.number().int().nonnegative(),
      finishedAt: z.number().int().nonnegative(),
      progress: z.array(progress),
      result,
    }),
    z.object({
      status: z.literal('failed'),
      startedAt: z.number().int().nonnegative(),
      finishedAt: z.number().int().nonnegative(),
      progress: z.array(progress),
      error: error.optional(),
      cause: serializedErrorSchema.optional(),
    }),
    z.object({
      status: z.literal('cancelled'),
      startedAt: z.number().int().nonnegative(),
      finishedAt: z.number().int().nonnegative(),
      progress: z.array(progress),
    }),
  ]);
}

export type LiveJobState<P, R, E> =
  | {
      status: 'running';
      startedAt: number;
      progress: P[];
      progressCount: number;
    }
  | {
      status: 'succeeded';
      startedAt: number;
      finishedAt: number;
      progress: P[];
      result: R;
    }
  | {
      status: 'failed';
      startedAt: number;
      finishedAt: number;
      progress: P[];
      error?: E;
      cause?: SerializedError;
    }
  | {
      status: 'cancelled';
      startedAt: number;
      finishedAt: number;
      progress: P[];
    };
