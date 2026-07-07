import type { Unsubscribe } from '@emdash/shared';
import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import type { LiveSource, LiveUpdate } from '../protocol';
import {
  liveJobStateSchema,
  liveLogSnapshotDataSchema,
  liveSnapshotSchema,
  liveUpdateSchema,
} from '../protocol';

const voidInput = z.void().optional();
type VoidInput = typeof voidInput;

/**
 * Creates a live-model contract for a host-global model (no key required).
 * Snapshot/subscribe/unsubscribe all accept no input unless input schemas are supplied.
 */
export function createLiveModelContract<
  T extends z.ZodTypeAny,
  SnapIn extends z.ZodTypeAny = VoidInput,
  SubIn extends z.ZodTypeAny = VoidInput,
  UnsubIn extends z.ZodTypeAny = VoidInput,
>(
  data: T,
  {
    snapshotInput = voidInput as unknown as SnapIn,
    subscribeInput = voidInput as unknown as SubIn,
    unsubscribeInput = voidInput as unknown as UnsubIn,
  }: {
    snapshotInput?: SnapIn;
    subscribeInput?: SubIn;
    unsubscribeInput?: UnsubIn;
  } = {}
) {
  return {
    snapshot: oc.input(snapshotInput).output(liveSnapshotSchema(data)),
    subscribe: oc.input(subscribeInput).output(eventIterator(liveUpdateSchema)),
    unsubscribe: oc.input(unsubscribeInput).output(z.void()),
  };
}

export const createGlobalLiveModelContract = createLiveModelContract;

/**
 * Creates a live-log contract using the same live update envelope as LiveModel,
 * with a log-specific bounded-tail snapshot.
 */
export function createLiveLogContract({
  snapshotInput = z.void().optional(),
  subscribeInput = z.void().optional(),
  unsubscribeInput = z.void().optional(),
}: {
  snapshotInput?: z.ZodTypeAny;
  subscribeInput?: z.ZodTypeAny;
  unsubscribeInput?: z.ZodTypeAny;
} = {}) {
  return {
    snapshot: oc.input(snapshotInput).output(liveSnapshotSchema(liveLogSnapshotDataSchema)),
    subscribe: oc.input(subscribeInput).output(eventIterator(liveUpdateSchema)),
    unsubscribe: oc.input(unsubscribeInput).output(z.void()),
  };
}

export function createLiveJobContract<
  I extends z.ZodTypeAny,
  P extends z.ZodTypeAny,
  R extends z.ZodTypeAny,
  E extends z.ZodTypeAny,
>({ input, progress, result, error }: { input: I; progress: P; result: R; error: E }) {
  const jobInput = z.object({ jobId: z.string() });
  const state = liveJobStateSchema(progress, result, error);
  return {
    start: oc.input(input).output(z.object({ jobId: z.string() })),
    cancel: oc.input(jobInput).output(z.void()),
    snapshot: oc.input(jobInput).output(liveSnapshotSchema(state)),
    subscribe: oc.input(jobInput).output(eventIterator(liveUpdateSchema)),
    unsubscribe: oc.input(jobInput).output(z.void()),
  };
}

/**
 * Bridges a callback-style subscription into an async generator suitable for
 * oRPC eventIterator handlers. Events arriving while the consumer is slow are
 * buffered; cleanup (unsubscribe) runs on abort, consumer return, and throw.
 *
 * Note: async generators are lazy — the subscription is established on the
 * first `next()` pull, not when the generator is created.
 */
export async function* streamEvents<T>(
  subscribe: (cb: (event: T) => void) => Unsubscribe,
  signal?: AbortSignal
): AsyncGenerator<T> {
  const buffer: T[] = [];
  let wakeup: (() => void) | null = null;
  const unsub = subscribe((event) => {
    buffer.push(event);
    wakeup?.();
  });
  const onAbort = (): void => {
    unsub();
    wakeup?.();
  };
  signal?.addEventListener('abort', onAbort);
  try {
    while (!signal?.aborted) {
      if (buffer.length === 0) {
        await new Promise<void>((resolve) => {
          wakeup = resolve;
        });
        wakeup = null;
      }
      while (buffer.length > 0) {
        yield buffer.shift()!;
      }
    }
  } finally {
    unsub();
    signal?.removeEventListener('abort', onAbort);
  }
}

export function streamLiveUpdates(
  source: Pick<LiveSource, 'subscribe'>,
  signal?: AbortSignal
): AsyncGenerator<LiveUpdate> {
  return streamEvents((cb) => source.subscribe(cb), signal);
}
