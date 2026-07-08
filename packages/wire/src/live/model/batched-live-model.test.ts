import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BatchedLiveModel, type FlushScheduler } from './batched-live-model';
import { LiveModel } from './server';

const treeSchema = z.object({
  count: z.number(),
});

type Tree = z.infer<typeof treeSchema>;

function makeTree(overrides: Partial<Tree> = {}): Tree {
  return { count: 0, ...overrides };
}

function makeSyncScheduler() {
  let captured: (() => void) | null = null;
  const schedule: FlushScheduler = (flush) => {
    captured = flush;
  };
  const trigger = () => {
    const fn = captured;
    captured = null;
    fn?.();
  };
  return { schedule, trigger };
}

function setup(initial: Tree = makeTree()) {
  const server = new LiveModel<Tree>(initial, 1000);
  const { schedule, trigger } = makeSyncScheduler();
  const batched = new BatchedLiveModel<Tree>(server, schedule);
  const updates: unknown[] = [];
  server.subscribe((update) => updates.push(update));
  return { server, batched, trigger, updates };
}

describe('BatchedLiveModel', () => {
  it('batches multiple enqueues into one update', () => {
    const { server, batched, trigger, updates } = setup();
    batched.enqueue((draft) => {
      draft.count = 1;
    });
    batched.enqueue((draft) => {
      draft.count = 2;
    });

    trigger();

    expect(updates).toHaveLength(1);
    expect(server.snapshot().data.count).toBe(2);
  });

  it('forwards unique mutation IDs into the emitted batch', () => {
    const { batched, trigger, updates } = setup();
    batched.enqueue(
      (draft) => {
        draft.count = 1;
      },
      { mutationIds: ['m1'] }
    );
    batched.enqueue(
      (draft) => {
        draft.count = 2;
      },
      { mutationIds: ['m1', 'm2'] }
    );

    trigger();

    expect(updates).toMatchObject([{ mutationIds: ['m1', 'm2'] }]);
  });

  it('flushes pending work before snapshot', () => {
    const { batched } = setup();
    batched.enqueue((draft) => {
      draft.count = 42;
    });
    expect(batched.snapshot().data.count).toBe(42);
  });

  it('drops a throwing batch and allows later mutations', () => {
    const server = new LiveModel<Tree>(makeTree({ count: 3 }), 1000);
    const { schedule, trigger } = makeSyncScheduler();
    const dropped: unknown[] = [];
    const batched = new BatchedLiveModel<Tree>(server, schedule, {
      instrumentation: {
        batchDropped: (event) => dropped.push(event),
      },
    });

    batched.enqueue(() => {
      throw new Error('boom');
    });
    trigger();
    batched.enqueue((draft) => {
      draft.count = 4;
    });
    trigger();

    expect(server.snapshot().data.count).toBe(4);
    expect(dropped).toHaveLength(1);
  });
});
