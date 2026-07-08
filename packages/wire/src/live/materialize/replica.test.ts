import { ok } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { bindContract } from '../../api/bind';
import { client } from '../../api/client';
import { connect } from '../../api/connect';
import { defineContract, defineLiveModelContract, mutation } from '../../api/define';
import { serve } from '../../api/serve';
import { memoryTransportPair } from '../../api/transports';
import { createLiveModelHost } from '../mutations';
import { materializeInstance } from './instance';
import { createLiveModelReplica } from './replica';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ count: z.number() });

const api = defineContract({
  counter: defineLiveModelContract({
    key: keySchema,
    models: {
      state: stateSchema,
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

  it('exposes local materialized state through acquired leases', async () => {
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
    expect(instance.models.state.current()).toEqual({ count: 0 });
    expect(replica.peek(key)).toBe(instance);

    await lease.release();
    await replica.dispose();
  });

  it('serves cached materialized state and re-anchors mutation cursors', async () => {
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
    const counter = materializeInstance(downstream.counter, key);
    await counter.ready;

    const invocation = await counter.mutations.bump({});
    await invocation.settled;

    expect(counter.models.state.current()).toEqual({ count: 1 });
    expect(authoritative.models.state.snapshot().data).toEqual({ count: 1 });

    await counter.dispose();
    await replica.dispose();
  });

  it('lets local readers observe mutations triggered by downstream clients', async () => {
    const key = { id: 'observed' };
    const host = createLiveModelHost(api.counter);
    host.create(key, { state: { count: 0 } });
    const upstreamPair = memoryTransportPair();
    serve(upstreamPair.right, bindContract(api, { counter: host }));

    const upstream = client(api, connect(upstreamPair.left));
    const replica = createLiveModelReplica(api.counter, upstream.counter);
    const appLease = replica.acquire(key);
    const appInstance = await appLease.ready();
    const downstreamPair = memoryTransportPair();
    serve(downstreamPair.right, bindContract(api, { counter: replica }));

    const downstream = client(api, connect(downstreamPair.left));
    const counter = materializeInstance(downstream.counter, key);
    await counter.ready;

    const invocation = await counter.mutations.bump({});
    await invocation.settled;

    expect(appInstance.models.state.current()).toEqual({ count: 1 });

    await counter.dispose();
    await appLease.release();
    await replica.dispose();
  });

  it('settles local mutation helpers against replica-local cursors', async () => {
    const key = { id: 'local-mutation' };
    const host = createLiveModelHost(api.counter);
    const authoritative = host.create(key, { state: { count: 0 } });
    const upstreamPair = memoryTransportPair();
    serve(upstreamPair.right, bindContract(api, { counter: host }));

    const upstream = client(api, connect(upstreamPair.left));
    const replica = createLiveModelReplica(api.counter, upstream.counter);
    const lease = replica.acquire(key);
    const instance = await lease.ready();

    const invocation = await instance.mutations.bump({});
    await invocation.settled;

    expect(invocation.result).toEqual(ok({ data: { count: 1 }, cursors: expect.any(Array) }));
    expect(instance.models.state.current()).toEqual({ count: 1 });
    expect(authoritative.models.state.snapshot().data).toEqual({ count: 1 });

    await lease.release();
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

  it('keeps upstream materialization active while an app lease is held', async () => {
    const key = { id: 'app-held' };
    const host = createLiveModelHost(api.counter);
    const authoritative = host.create(key, { state: { count: 0 } });
    const upstreamPair = memoryTransportPair();
    serve(upstreamPair.right, bindContract(api, { counter: host }));

    const upstream = client(api, connect(upstreamPair.left));
    const replica = createLiveModelReplica(api.counter, upstream.counter);
    const appLease = replica.acquire(key);
    const appInstance = await appLease.ready();
    const downstreamPair = memoryTransportPair();
    serve(downstreamPair.right, bindContract(api, { counter: replica }));

    const downstream = client(api, connect(downstreamPair.left));
    const counter = materializeInstance(downstream.counter, key);
    await counter.ready;
    await counter.dispose();

    authoritative.models.state.produce(
      (draft) => {
        (draft as { count: number }).count = 10;
      },
      { mutationIds: ['external-update'] }
    );
    await appInstance.models.state.waitForMutation('external-update');

    expect(appInstance.models.state.current()).toEqual({ count: 10 });

    await appLease.release();
    await replica.dispose();
  });

  it('forwards thin groups through bindContract without materializing at the hop', async () => {
    const key = { id: 'forwarded' };
    const host = createLiveModelHost(api.counter);
    host.create(key, { state: { count: 0 } });
    const upstreamPair = memoryTransportPair();
    serve(upstreamPair.right, bindContract(api, { counter: host }));

    const upstream = client(api, connect(upstreamPair.left));
    const hopPair = memoryTransportPair();
    serve(hopPair.right, bindContract(api, { counter: upstream.counter }));

    const downstream = client(api, connect(hopPair.left));
    const counter = materializeInstance(downstream.counter, key);
    await counter.ready;

    const invocation = await counter.mutations.bump({});
    await invocation.settled;

    expect(counter.models.state.current()).toEqual({ count: 1 });
    await counter.dispose();
  });
});
