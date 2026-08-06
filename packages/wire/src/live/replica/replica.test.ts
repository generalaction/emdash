import { ok } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineContract, liveModel, liveState, mutation } from '../../api/define';
import { expose } from '../../state/bridge/expose';
import { cell, snapshot } from '../../state/core';
import { createTestWire } from '../../testing';
import { createLiveModelReplica } from './replica';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ count: z.number() });

const api = defineContract({
  counter: liveModel({
    key: keySchema,
    states: {
      state: liveState({ data: stateSchema }),
    },
    mutations: {
      bump: mutation({
        input: z.object({}),
        data: stateSchema,
        error: z.string(),
      }),
    },
  }),
});

function counterSource(initial: { count: number }) {
  const state = cell(initial);
  const provider = expose(
    api.counter,
    { state: () => state },
    {
      mutations: {
        async bump(context) {
          let count = 0;
          const revision = state.update(
            (previous) => {
              count = previous.count + 1;
              return { count };
            },
            { mutationIds: [context.mutationId] }
          );
          await context.observed('state', revision);
          return ok({ count });
        },
      },
    }
  );
  return { state, provider };
}

describe('createLiveModelReplica', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes local replica state through acquired leases', async () => {
    const key = { id: 'local' };
    const { provider } = counterSource({ count: 0 });
    const upstream = createTestWire(api, { counter: provider }).client;
    const replica = createLiveModelReplica(api.counter, upstream.counter);

    expect(replica.peek(key)).toBeUndefined();
    const lease = replica.acquire(key);
    const instance = await lease.ready();

    expect(instance.key).toEqual(key);
    expect(instance.states.state.current()).toEqual({ count: 0 });
    expect(replica.peek(key)).toBe(instance);

    await lease.release();
    await replica.dispose();
  });

  it('serves cached replica state and re-anchors mutation cursors', async () => {
    const key = { id: 'demo' };
    const { state, provider } = counterSource({ count: 0 });
    const upstream = createTestWire(api, { counter: provider }).client;
    const replica = createLiveModelReplica(api.counter, upstream.counter, { retentionMs: 100 });
    const downstream = createTestWire(api, { counter: replica }).client;
    const downstreamReplica = createLiveModelReplica(api.counter, downstream.counter);
    const downstreamLease = downstreamReplica.acquire(key);
    const counter = await downstreamLease.ready();

    const invocation = await counter.mutations.bump({});
    await invocation.settled;

    expect(counter.states.state.current()).toEqual({ count: 1 });
    expect(snapshot(state).value).toEqual({ count: 1 });

    await downstreamLease.release();
    await downstreamReplica.dispose();
    await replica.dispose();
  });

  it('keeps warm instances visible through peek during retention', async () => {
    vi.useFakeTimers();
    const key = { id: 'retained' };
    const { provider } = counterSource({ count: 0 });
    const upstream = createTestWire(api, { counter: provider }).client;
    const replica = createLiveModelReplica(api.counter, upstream.counter, { retentionMs: 50 });
    const lease = replica.acquire(key);
    const instance = await lease.ready();

    await lease.release();
    await vi.advanceTimersByTimeAsync(49);
    expect(replica.peek(key)).toBe(instance);

    await vi.advanceTimersByTimeAsync(1);
    expect(replica.peek(key)).toBeUndefined();

    await replica.dispose();
  });
});
