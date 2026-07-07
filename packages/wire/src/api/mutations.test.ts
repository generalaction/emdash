import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveModelRegistry, LiveModelServer } from '../live';
import { bindContract, fromRegistry } from './bind';
import { contractClient } from './client';
import { connect } from './connect';
import { defineContract, liveModel, mutation } from './define';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ count: z.number() });

const contract = defineContract({
  left: liveModel({ key: keySchema, data: stateSchema }),
  right: liveModel({ key: keySchema, data: stateSchema }),
  bump: mutation({
    input: keySchema.extend({ touchRight: z.boolean() }),
    data: z.object({ touched: z.array(z.string()) }),
    error: z.string(),
  }),
});

function setup() {
  const registry = new LiveModelRegistry();
  const left = new LiveModelServer({ count: 0 }, 1000);
  const right = new LiveModelServer({ count: 10 }, 2000);
  const key = { id: 'shared' };
  registry.register(contract.left, key, left);
  registry.register(contract.right, key, right);
  const pair = memoryTransportPair();
  const controller = bindContract(contract, {
    registry,
    impl: {
      left: fromRegistry(),
      right: fromRegistry(),
      bump: (ctx, input) => {
        ctx.produce(contract.left, { id: input.id }, (draft) => {
          draft.count += 1;
        });
        const touched = ['left'];
        if (input.touchRight) {
          ctx.produce(contract.right, { id: input.id }, (draft) => {
            draft.count += 1;
          });
          touched.push('right');
        }
        return ok({ touched });
      },
    },
  });
  serve(pair.right, controller);
  return { client: contractClient(contract, connect(pair.left)), key, left, right };
}

describe('contract mutations', () => {
  it('settles only the live models actually touched by a mutation', async () => {
    const { client, key } = setup();
    const leftBinding = client.left(key, () => {});
    const rightBinding = client.right(key, () => {});
    await Promise.all([leftBinding.ready, rightBinding.ready]);

    const first = await client.bump({ ...key, touchRight: false });
    expect(first.result).toMatchObject({ success: true, data: { data: { touched: ['left'] } } });
    await first.settled;
    expect(leftBinding.client.getSnapshot()).toEqual({ count: 1 });
    expect(rightBinding.client.getSnapshot()).toEqual({ count: 10 });

    const second = await client.bump({ ...key, touchRight: true });
    await second.settled;
    expect(leftBinding.client.getSnapshot()).toEqual({ count: 2 });
    expect(rightBinding.client.getSnapshot()).toEqual({ count: 11 });
  });

  it('settles immediately for touched models that are not locally bound', async () => {
    const { client, key } = setup();
    const leftBinding = client.left(key, () => {});
    await leftBinding.ready;

    const invocation = await client.bump({ ...key, touchRight: true });
    await invocation.settled;
    expect(leftBinding.client.getSnapshot()).toEqual({ count: 1 });
  });
});
