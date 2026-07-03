import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import type { Patch } from './immer-setup';

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
  /** Immer Patch[] — applied via immer.applyPatches() on the client. */
  delta: z.unknown(),
});

export type LiveUpdate = z.infer<typeof liveUpdateSchema>;

/**
 * Creates a live-model contract for a host-global model (no key required).
 * Snapshot/subscribe/unsubscribe all accept no input.
 */
export function createLiveModelContract<T extends z.ZodTypeAny>(
  data: T,
  {
    snapshotInput = z.void().optional(),
    subscribeInput = z.void().optional(),
    unsubscribeInput = z.void().optional(),
  }: {
    snapshotInput?: z.ZodTypeAny;
    subscribeInput?: z.ZodTypeAny;
    unsubscribeInput?: z.ZodTypeAny;
  } = {}
) {
  return {
    snapshot: oc.input(snapshotInput).output(liveSnapshotSchema(data)),
    subscribe: oc.input(subscribeInput).output(eventIterator(liveUpdateSchema)),
    unsubscribe: oc.input(unsubscribeInput).output(z.void()),
  };
}
