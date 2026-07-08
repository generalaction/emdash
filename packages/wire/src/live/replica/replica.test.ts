import { ok } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { bindContract } from '../../api/bind';
import { client } from '../../api/client';
import { connect } from '../../api/connect';
import { defineContract, liveModel, liveState, mutation } from '../../api/define';
import { serve } from '../../api/serve';
import { memoryTransportPair } from '../../api/transports';
import { createLiveModelHost } from '../mutations';
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
      bump: mutation(
        {
          input: z.object({}),
          data: stateSchema,
          error: z.string(),
        },
        (ctx) => {
          let count = 0;
          ctx.produce('state', (draft) => {
            const state = draft as { count: number };
            state.count += 1;
            count = state.count;
          });
          return ok({ count });
        }
      ),
    },
  }),
});

describe('createLiveModelReplica', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes local replica state through acquired leases', async () => {
    const key = { id: 'local' };
    const host = createLiveModelHost(api.counter);
    host.create(key, { state: { count: 0 } });
    const upstreamPair = memoryTransportPair();
    serve(upstreamPair.right, bindContract(api, { counter: host }));

    const upstream = client(api, connect(upstreamPair.left));
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
    const host = createLiveModelHost(api.counter);
    const authoritative = host.create(key, { state: { count: 0 } });
    const upstreamPair = memoryTransportPair();
    serve(upstreamPair.right, bindContract(api, { counter: host }));

    const upstream = client(api, connect(upstreamPair.left));
    const replica = createLiveModelReplica(api.counter, upstream.counter, { retentionMs: 100 });
    const downstreamPair = memoryTransportPair();
    serve(downstreamPair.right, bindContract(api, { counter: replica }));

    const downstream = client(api, connect(downstreamPair.left));
    const downstreamReplica = createLiveModelReplica(api.counter, downstream.counter);
    const downstreamLease = downstreamReplica.acquire(key);
    const counter = await downstreamLease.ready();

    const invocation = await counter.mutations.bump({});
    await invocation.settled;

    expect(counter.states.state.current()).toEqual({ count: 1 });
    expect(authoritative.states.state.snapshot().data).toEqual({ count: 1 });

    await downstreamLease.release();
    await downstreamReplica.dispose();
    await replica.dispose();
  });

  it('keeps warm instances visible through peek during retention', async () => {
    vi.useFakeTimers();
    const key = { id: 'retained' };
    const host = createLiveModelHost(api.counter);
    host.create(key, { state: { count: 0 } });
    const upstreamPair = memoryTransportPair();
    serve(upstreamPair.right, bindContract(api, { counter: host }));

    const upstream = client(api, connect(upstreamPair.left));
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
