import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BatchedLiveModel, type FlushScheduler } from './batched-live-model';
import { LiveModelServer } from './server';

// ---------------------------------------------------------------------------
// Shared schema and helpers
// ---------------------------------------------------------------------------

const dirSchema = z.object({ files: z.record(z.string(), z.string()) });

const treeSchema = z.object({
  count: z.number(),
  root: z.record(z.string(), dirSchema),
});

type Tree = z.infer<typeof treeSchema>;

function makeTree(overrides: Partial<Tree> = {}): Tree {
  return { count: 0, root: {}, ...overrides };
}

/**
 * A synchronous scheduler for tests: instead of scheduling asynchronously,
 * it captures the flush callback and exposes it for manual invocation.
 */
function makeSyncScheduler() {
  let captured: (() => void) | null = null;
  const schedule = (flush: () => void) => {
    captured = flush;
  };
  const trigger = () => {
    if (captured) {
      const fn = captured;
      captured = null;
      fn();
    }
  };
  const isPending = () => captured !== null;
  return { schedule, trigger, isPending };
}

function setup(initial: Tree = makeTree()) {
  const server = new LiveModelServer<Tree>(initial, 1000);
  const { schedule, trigger, isPending } = makeSyncScheduler();
  const batched = new BatchedLiveModel<Tree>(server, schedule);

  const updates: unknown[] = [];
  server.subscribe((u) => updates.push(u));

  return { server, batched, trigger, isPending, updates };
}

// ---------------------------------------------------------------------------
// Coalescing: N enqueues -> one produce -> one emission
// ---------------------------------------------------------------------------

describe('coalescing', () => {
  it('batches multiple enqueues into a single LiveUpdate', () => {
    const { batched, trigger, updates } = setup();

    batched.enqueue((d) => {
      d.count = 1;
    });
    batched.enqueue((d) => {
      d.count = 2;
    });
    batched.enqueue((d) => {
      d.count = 3;
    });

    expect(updates).toHaveLength(0); // not flushed yet

    trigger();

    expect(updates).toHaveLength(1);
  });

  it('sequence advances by exactly 1 regardless of enqueue count', () => {
    const { batched, trigger, server } = setup();

    batched.enqueue((d) => {
      d.count = 10;
    });
    batched.enqueue((d) => {
      d.count = 20;
    });
    batched.enqueue((d) => {
      d.count = 30;
    });
    trigger();

    // sequence goes from 0 → 1 (one produce() = one increment)
    const snap = server.snapshot();
    expect(snap.sequence).toBe(1);
    expect(snap.data.count).toBe(30);
  });

  it('repeated writes to the same field collapse to last-write-wins', () => {
    const { batched, trigger, server, updates } = setup();

    batched.enqueue((d) => {
      d.count = 1;
    });
    batched.enqueue((d) => {
      d.count = 2;
    });
    batched.enqueue((d) => {
      d.count = 99;
    });
    trigger();

    expect(updates).toHaveLength(1);
    expect(server.snapshot().data.count).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Collapse: rename then delete-parent = net remove of parent only
// ---------------------------------------------------------------------------

describe('structural collapse', () => {
  it('rename then parent delete collapses to a single patch removing the parent', () => {
    const initial = makeTree({
      root: {
        src: { files: { 'old.ts': 'content' } },
      },
    });
    const { batched, trigger, updates } = setup(initial);

    // Step 1: "rename" old.ts -> new.ts inside src/
    batched.enqueue((d) => {
      const content = d.root['src']!.files['old.ts']!;
      delete d.root['src']!.files['old.ts'];
      d.root['src']!.files['new.ts'] = content;
    });

    // Step 2: delete the whole src/ folder
    batched.enqueue((d) => {
      delete d.root['src'];
    });

    trigger();

    // Only one LiveUpdate
    expect(updates).toHaveLength(1);
    // The rename's intermediate writes are subsumed; net state has no src/
    const snap = updates[0] as { delta: unknown };
    const patches = snap.delta as Array<{ op: string; path: string[] }>;

    // The net patch only describes the removal of src/ (or equivalent); it
    // must NOT include a 'replace'/'add' on old.ts -> new.ts.
    const touchesOldTs = patches.some((p) => p.path.includes('old.ts'));
    const touchesNewTs = patches.some((p) => p.path.includes('new.ts'));
    expect(touchesOldTs).toBe(false);
    expect(touchesNewTs).toBe(false);
  });

  it('no emission when all enqueued mutations are net no-ops', () => {
    const { batched, trigger, updates } = setup(makeTree({ count: 5 }));

    // Enqueue two ops that cancel each other out
    batched.enqueue((d) => {
      d.count = 99;
    });
    batched.enqueue((d) => {
      d.count = 5;
    }); // back to original

    trigger();

    // Immer suppresses because final state equals base state
    expect(updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// snapshot() flushes pending mutations first
// ---------------------------------------------------------------------------

describe('snapshot ordering', () => {
  it('flush-on-snapshot returns state that includes queued mutations', () => {
    const { batched } = setup();

    batched.enqueue((d) => {
      d.count = 42;
    });

    // snapshot() must flush first
    const snap = batched.snapshot();
    expect(snap.data.count).toBe(42);
  });

  it('snapshot sequence matches what a subscriber would see next', () => {
    const { batched, server } = setup();
    batched.enqueue((d) => {
      d.count = 7;
    });

    const snap = batched.snapshot();
    // After the flush inside snapshot(), server sequence is 1
    expect(snap.sequence).toBe(server.snapshot().sequence);
  });

  it('a new enqueue after snapshot() re-schedules exactly once', () => {
    // After snapshot() flushes, this.scheduled is false.
    // The next enqueue must be able to schedule a new flush.
    const scheduleFn = vi.fn<FlushScheduler>(() => {
      /* deferred, do nothing */
    });
    const server = new LiveModelServer<Tree>(makeTree(), 1000);
    const batched = new BatchedLiveModel<Tree>(server, scheduleFn);

    batched.enqueue((d) => {
      d.count = 1;
    }); // schedules once
    batched.snapshot(); // flushes, resets scheduled flag

    batched.enqueue((d) => {
      d.count = 2;
    }); // should schedule again (once)

    // First enqueue: 1 schedule call; second enqueue after snapshot: 1 more = 2 total
    expect(scheduleFn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('flushes pending mutations before marking disposed', () => {
    const { batched, server } = setup();

    batched.enqueue((d) => {
      d.count = 55;
    });
    batched.dispose();

    expect(server.snapshot().data.count).toBe(55);
  });

  it('ignores enqueue after dispose', () => {
    const { batched, trigger, server } = setup();

    batched.dispose();
    batched.enqueue((d) => {
      d.count = 999;
    });
    trigger(); // should be a no-op (nothing was scheduled)

    expect(server.snapshot().data.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Error isolation: throwing mutator drops the batch, server state unchanged
// ---------------------------------------------------------------------------

describe('error isolation', () => {
  it('drops the batch and emits nothing if a mutator throws', () => {
    const { batched, trigger, updates, server } = setup(makeTree({ count: 3 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    batched.enqueue(() => {
      throw new Error('boom');
    });

    trigger();

    expect(updates).toHaveLength(0);
    expect(server.snapshot().data.count).toBe(3); // unchanged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[BatchedLiveModel]'),
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });

  it('accepts new mutations after a dropped batch', () => {
    const { batched, trigger, server } = setup();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    batched.enqueue(() => {
      throw new Error('first batch fails');
    });
    trigger();

    batched.enqueue((d) => {
      d.count = 7;
    });
    trigger();

    expect(server.snapshot().data.count).toBe(7);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scheduling: only one flush is scheduled per window
// ---------------------------------------------------------------------------

describe('scheduler deduplication', () => {
  it('calls the scheduler exactly once per flush window regardless of enqueue count', () => {
    // Use a deferred scheduler so flush is not called immediately.
    const scheduleFn = vi.fn<FlushScheduler>(() => {
      /* deferred */
    });
    const server = new LiveModelServer<Tree>(makeTree(), 1000);
    const batched = new BatchedLiveModel<Tree>(server, scheduleFn);

    batched.enqueue((d) => {
      d.count = 1;
    });
    batched.enqueue((d) => {
      d.count = 2;
    });
    batched.enqueue((d) => {
      d.count = 3;
    });

    // All three enqueues happen before a flush fires, so only one schedule call.
    expect(scheduleFn).toHaveBeenCalledTimes(1);
  });
});
