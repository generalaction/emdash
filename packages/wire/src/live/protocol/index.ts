import type { Unsubscribe } from '@emdash/shared';
import { z } from 'zod';
import type { Patch } from '../model/immer-setup';

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
  snapshot(): LiveSnapshot<unknown>;
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
      result,
    }),
    z.object({
      status: z.literal('failed'),
      error,
    }),
    z.object({
      status: z.literal('cancelled'),
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
      result: R;
    }
  | {
      status: 'failed';
      error: E;
    }
  | {
      status: 'cancelled';
    };
