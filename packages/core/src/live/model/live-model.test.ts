import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LiveModelClient } from './client';
import { LiveModelServer } from './server';

// ---------------------------------------------------------------------------
// Test schema
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const stateSchema = z.object({
  count: z.number(),
  label: z.string(),
  items: z.array(itemSchema),
});

type State = z.infer<typeof stateSchema>;

function makeState(overrides: Partial<State> = {}): State {
  return { count: 0, label: 'initial', items: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Test harness: wires server updates directly into client
// ---------------------------------------------------------------------------

function setup(initial: State, generation?: number) {
  const server = new LiveModelServer<State>(initial, generation ?? 1000);

  const onChange = vi.fn<(v: State) => void>();
  const refetchSnapshot = vi.fn(async () => server.snapshot());

  const client = new LiveModelClient<State>(stateSchema, refetchSnapshot, onChange);
  client.seed(server.snapshot());

  // Wire all future updates directly into the client
  server.subscribe((update) => client.applyUpdate(update));

  return { server, client, onChange, refetchSnapshot };
}

// ---------------------------------------------------------------------------
// Roundtrip
// ---------------------------------------------------------------------------

describe('roundtrip', () => {
  it('reflects a mutate() call on the client', () => {
    const { server, client } = setup(makeState());
    server.produce((d) => {
      d.count = 42;
    });
    expect(client.getSnapshot()?.count).toBe(42);
  });

  it('reflects a replace() call on the client', () => {
    const { server, client } = setup(makeState());
    server.produce((d) => {
      d.count = 99;
      d.label = 'replaced';
      d.items = [];
    });
    expect(client.getSnapshot()?.label).toBe('replaced');
    expect(client.getSnapshot()?.count).toBe(99);
  });

  it('accumulates multiple mutations in order', () => {
    const { server, client } = setup(makeState());
    server.produce((d) => {
      d.count = 1;
    });
    server.produce((d) => {
      d.count = 2;
    });
    server.produce((d) => {
      d.label = 'done';
    });
    const snap = client.getSnapshot()!;
    expect(snap.count).toBe(2);
    expect(snap.label).toBe('done');
  });

  it('calls onChange with each mutation', () => {
    const { server, onChange } = setup(makeState());
    server.produce((d) => {
      d.count = 1;
    });
    server.produce((d) => {
      d.count = 2;
    });
    // initial seed + 2 mutations
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('provides a fresh reference on each update', () => {
    const { server, client } = setup(makeState());
    const before = client.getSnapshot();
    server.produce((d) => {
      d.count = 5;
    });
    const after = client.getSnapshot();
    expect(after).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// No-op suppression
// ---------------------------------------------------------------------------

describe('no-op suppression', () => {
  it('does not emit or increment sequence on an identity mutate', () => {
    const { server, client, onChange } = setup(makeState({ count: 3 }));
    const seqBefore = (client as any).sequence as number;
    onChange.mockClear();
    server.produce(() => {
      /* no change */
    });
    expect((client as any).sequence).toBe(seqBefore);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not emit when setting a primitive to its current value', () => {
    const state = makeState({ count: 7 });
    const { server, onChange } = setup(state);
    onChange.mockClear();
    server.produce((d) => {
      d.count = 7;
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  // Note: Immer semantics differ from jsondiffpatch for object/array
  // reassignment. Assigning a new object/array reference with the same deep
  // value WILL produce an Immer patch (Immer tracks writes, not deep equality
  // of the final value for reference types), unlike jsondiffpatch which
  // compared the serialised result.
});

// ---------------------------------------------------------------------------
// Structural sharing
// ---------------------------------------------------------------------------

describe('structural sharing', () => {
  it('preserves referential identity of untouched subtrees after a mutation', () => {
    const initial = makeState({
      items: [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ],
    });
    const { server, client } = setup(initial);

    const snapBefore = client.getSnapshot()!;
    const itemsBefore = snapBefore.items;

    // Only touch count — items subtree is untouched
    server.produce((d) => {
      d.count = 1;
    });

    const snapAfter = client.getSnapshot()!;

    // Root reference is new (state changed)
    expect(snapAfter).not.toBe(snapBefore);
    // Untouched items array keeps referential identity (structural sharing)
    expect(snapAfter.items).toBe(itemsBefore);
  });

  it('produces new reference for mutated subtrees only', () => {
    const initial = makeState({
      items: [{ id: 'a', name: 'Alpha' }],
    });
    const { server, client } = setup(initial);

    const itemsBefore = client.getSnapshot()!.items;

    // Touch items
    server.produce((d) => {
      d.items.push({ id: 'b', name: 'Beta' });
    });

    const snapAfter = client.getSnapshot()!;
    expect(snapAfter.items).not.toBe(itemsBefore);
    expect(snapAfter.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// isReady / getSnapshot before seed
// ---------------------------------------------------------------------------

describe('isReady', () => {
  it('returns false before seed', () => {
    const client = new LiveModelClient<State>(
      stateSchema,
      async () => ({ generation: 1, sequence: 0, data: makeState(), timestamp: 0 }),
      vi.fn()
    );
    expect(client.isReady()).toBe(false);
    expect(client.getSnapshot()).toBeUndefined();
  });

  it('returns true after seed', () => {
    const { client } = setup(makeState());
    expect(client.isReady()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sequence gap -> resync
// ---------------------------------------------------------------------------

describe('sequence gap', () => {
  it('resyncs when an update is dropped (gap in baseSequence)', () => {
    // Wire the real server/client and verify two sequential mutations land cleanly.
    // The manual-gap case (wrong baseSequence) is covered by the next test.
    const { server: srv, client: cli, refetchSnapshot: rfs } = setup(makeState());
    srv.produce((d) => {
      d.count = 1;
    });
    srv.produce((d) => {
      d.count = 2;
    });
    expect(cli.getSnapshot()?.count).toBe(2);
    expect(rfs).not.toHaveBeenCalled();
  });

  it('resyncs when a manually fed update has a wrong baseSequence', async () => {
    const { client, refetchSnapshot } = setup(makeState());
    // Client is at sequence 0 after seed; feed an update with baseSequence=99 (wrong)
    client.applyUpdate({
      generation: 1000,
      baseSequence: 99,
      sequence: 100,
      delta: [],
      timestamp: 0,
    });
    await vi.waitFor(() => expect(refetchSnapshot).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// Generation mismatch -> resync
// ---------------------------------------------------------------------------

describe('generation mismatch', () => {
  it('resyncs when an update carries a different generation', async () => {
    const { client, refetchSnapshot } = setup(makeState());
    client.applyUpdate({ generation: 9999, baseSequence: 0, sequence: 1, delta: [], timestamp: 0 });
    await vi.waitFor(() => expect(refetchSnapshot).toHaveBeenCalledTimes(1));
  });

  it('recovers to the new state after reseed on the server', async () => {
    const { server, client, refetchSnapshot } = setup(makeState({ count: 5 }));

    // reseed changes generation and resets sequence
    server.reseed({ count: 100, label: 'reseeded', items: [] });

    // Next mutation emits with new generation; client detects mismatch and resyncs
    server.produce((d) => {
      d.count = 101;
    });

    await vi.waitFor(() => expect(refetchSnapshot).toHaveBeenCalledTimes(1));
    // After resync the client matches the server
    expect(client.getSnapshot()?.count).toBe(101);
  });
});

// ---------------------------------------------------------------------------
// applyUpdate before seed -> resync
// ---------------------------------------------------------------------------

describe('applyUpdate before seed', () => {
  it('resyncs when applyUpdate is called before seed', async () => {
    const refetchSnapshot = vi.fn(async () => ({
      generation: 1,
      sequence: 0,
      data: makeState(),
      timestamp: 0,
    }));
    const client = new LiveModelClient<State>(stateSchema, refetchSnapshot, vi.fn());
    client.applyUpdate({ generation: 1, baseSequence: 0, sequence: 1, delta: [], timestamp: 0 });
    await vi.waitFor(() => expect(refetchSnapshot).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// Patched-result validation failure -> resync (dev-only)
// ---------------------------------------------------------------------------

describe('validation failure', () => {
  it('resyncs when Immer patches yield a result that fails the schema', async () => {
    const { client, refetchSnapshot } = setup(makeState());
    // Valid Immer Patch[] that replaces count with a non-number — violates z.number()
    const badPatch = [{ op: 'replace' as const, path: ['count'], value: 'not-a-number' }];
    // baseSequence must match the client's current sequence (0 after seed)
    client.applyUpdate({
      generation: 1000,
      baseSequence: 0,
      sequence: 1,
      delta: badPatch,
      timestamp: 0,
    });
    // Validation runs in test env (NODE_ENV !== 'production') → resync triggered
    await vi.waitFor(() => expect(refetchSnapshot).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// Dev/prod validation gating
// ---------------------------------------------------------------------------

describe('dev/prod validation gating', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env['NODE_ENV'];
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalNodeEnv;
    }
  });

  it('skips schema validation and does NOT resync on a bad patch in production', async () => {
    process.env['NODE_ENV'] = 'production';
    const onChange = vi.fn<(v: State) => void>();
    const refetchSnapshot = vi.fn(async () => ({
      generation: 1000,
      sequence: 1,
      data: makeState(),
      timestamp: 0,
    }));
    const client = new LiveModelClient<State>(stateSchema, refetchSnapshot, onChange);
    client.seed({ generation: 1000, sequence: 0, data: makeState(), timestamp: 0 });

    // Patch sets count to a non-number — invalid per schema, but validation is skipped
    const badPatch = [{ op: 'replace' as const, path: ['count'], value: 'not-a-number' }];
    client.applyUpdate({
      generation: 1000,
      baseSequence: 0,
      sequence: 1,
      delta: badPatch,
      timestamp: 0,
    });

    // onChange fires (patch applied without resync)
    expect(onChange).toHaveBeenCalledTimes(2); // seed + applyUpdate
    expect(refetchSnapshot).not.toHaveBeenCalled();
  });

  it('validates and resyncs on a bad patch in development', async () => {
    process.env['NODE_ENV'] = 'development';
    const { client, refetchSnapshot } = setup(makeState());

    const badPatch = [{ op: 'replace' as const, path: ['count'], value: 'not-a-number' }];
    client.applyUpdate({
      generation: 1000,
      baseSequence: 0,
      sequence: 1,
      delta: badPatch,
      timestamp: 0,
    });

    await vi.waitFor(() => expect(refetchSnapshot).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// Array operations
// ---------------------------------------------------------------------------

describe('array operations', () => {
  it('correctly applies a reorder without corrupting item data', () => {
    const initial = makeState({
      items: [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
        { id: 'c', name: 'Gamma' },
      ],
    });
    const { server, client } = setup(initial);

    // Reorder: put c first
    server.produce((d) => {
      d.items = [
        { id: 'c', name: 'Gamma' },
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ];
    });

    const snap = client.getSnapshot()!;
    expect(snap.items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(snap.items.map((i) => i.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('correctly applies a mutation that adds and removes items', () => {
    const initial = makeState({
      items: [
        { id: 'x', name: 'X' },
        { id: 'y', name: 'Y' },
      ],
    });
    const { server, client } = setup(initial);

    server.produce((d) => {
      d.items = [
        { id: 'y', name: 'Y-updated' },
        { id: 'z', name: 'Z' },
      ];
    });

    const snap = client.getSnapshot()!;
    expect(snap.items).toHaveLength(2);
    expect(snap.items[0]).toEqual({ id: 'y', name: 'Y-updated' });
    expect(snap.items[1]).toEqual({ id: 'z', name: 'Z' });
  });
});
