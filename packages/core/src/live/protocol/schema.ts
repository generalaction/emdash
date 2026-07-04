import type { Unsubscribe } from '@emdash/shared';
import { z } from 'zod';
import type { Patch } from '../model/immer-setup';

export type { Patch };

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
