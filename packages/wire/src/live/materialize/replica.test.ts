import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
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
