import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LiveModelClient, type LiveChangeMeta } from './client';
import { LiveModelServer } from './server';

const stateSchema = z.object({
  count: z.number(),
  label: z.string(),
});

type State = z.infer<typeof stateSchema>;

function makeState(overrides: Partial<State> = {}): State {
  return { count: 0, label: 'initial', ...overrides };
}

function setup(initial: State = makeState(), generation = 1000) {
  const server = new LiveModelServer<State>(initial, generation);
  const onChange = vi.fn<(value: State, meta: LiveChangeMeta) => void>();
  const refetchSnapshot = vi.fn(async () => server.snapshot());
  const client = new LiveModelClient<State>(stateSchema, refetchSnapshot, onChange);
  client.seed(server.snapshot());
  server.subscribe((update) => client.applyUpdate(update));
  return { server, client, onChange, refetchSnapshot };
}

describe('LiveModelServer and LiveModelClient', () => {
  it('applies server mutations to the client', () => {
    const { server, client } = setup();
    server.produce((draft) => {
      draft.count = 42;
    });
    expect(client.getSnapshot()).toMatchObject({ count: 42 });
  });

  it('returns cursors from produce and no-op produce', () => {
    const { server } = setup();
    const noOpCursor = server.produce(() => {
      /* no change */
    });
    expect(noOpCursor).toEqual({ generation: 1000, sequence: 0 });

    const cursor = server.produce((draft) => {
      draft.count = 1;
    });
    expect(cursor).toEqual({ generation: 1000, sequence: 1 });
    expect(server.cursor).toEqual(cursor);
  });

  it('emits mutation IDs on tagged produce calls', () => {
    const server = new LiveModelServer<State>(makeState(), 1000);
    const updates: unknown[] = [];
    server.subscribe((update) => updates.push(update));

    server.produce(
      (draft) => {
        draft.count = 1;
      },
      { mutationIds: ['m1'] }
    );

    expect(updates).toMatchObject([{ mutationIds: ['m1'] }]);
  });

  it('passes seed and update metadata to onChange', () => {
    const { server, onChange } = setup();
    expect(onChange).toHaveBeenLastCalledWith(makeState(), { kind: 'seed' });

    server.produce(
      (draft) => {
        draft.count = 2;
      },
      { mutationIds: ['m1'] }
    );

    expect(onChange).toHaveBeenLastCalledWith(makeState({ count: 2 }), {
      kind: 'update',
      mutationIds: ['m1'],
    });
  });

  it('waits for cursors to catch up', async () => {
    const { server, client } = setup();
    const wait = client.waitForCursor({ generation: 1000, sequence: 1 });

    server.produce((draft) => {
      draft.count = 1;
    });

    await expect(wait).resolves.toBeUndefined();
  });

  it('resolves cursor waiters when a resync jumps to a newer generation', async () => {
    const { server, client } = setup(makeState(), 1000);
    const wait = client.waitForCursor({ generation: 1000, sequence: 3 });

    server.reseed(makeState({ count: 10 }));
    server.produce((draft) => {
      draft.count = 11;
    });

    await expect(wait).resolves.toBeUndefined();
    expect(client.cursor?.generation).toBeGreaterThan(1000);
  });

  it('waits for tagged mutations', async () => {
    const { server, client } = setup();
    const wait = client.waitForMutation('m1');

    server.produce(
      (draft) => {
        draft.count = 1;
      },
      { mutationIds: ['m1'] }
    );

    await expect(wait).resolves.toBeUndefined();
  });

  it('times out cursor waiters', async () => {
    vi.useFakeTimers();
    try {
      const { client } = setup();
      const wait = client.waitForCursor({ generation: 1000, sequence: 1 }, 10);
      vi.advanceTimersByTime(10);
      await expect(wait).rejects.toThrow('Timed out waiting for live cursor');
    } finally {
      vi.useRealTimers();
    }
  });
});
