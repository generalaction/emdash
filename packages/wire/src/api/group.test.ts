import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGroupInstance, LiveModelRegistry } from '../live';
import { bindContract, encodeTopic, fromRegistry } from './bind';
import { contractClient } from './client';
import { connect } from './connect';
import { defineContract, liveModel, liveModelGroup, mutation } from './define';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const keySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ title: z.string() });
const usageSchema = z.object({ tokens: z.number() });

const contract = defineContract({
  conversation: liveModelGroup({
    key: keySchema,
    models: {
      state: liveModel({ data: stateSchema }),
      usage: liveModel({ data: usageSchema }),
    },
    mutations: {
      setTitle: mutation(
        {
          input: z.object({ title: z.string() }),
          data: z.void(),
          error: z.string(),
        },
        (ctx, input) => {
          ctx.produce('state', (draft) => {
            (draft as { title: string }).title = input.title;
          });
          ctx.produce('usage', (draft) => {
            (draft as { tokens: number }).tokens += input.title.length;
          });
          return ok(undefined);
        }
      ),
    },
  }),
});

function setup() {
  const key = { conversationId: 'c1' };
  const registry = new LiveModelRegistry();
  const instance = createGroupInstance(contract.conversation, key, {
    state: { title: 'Initial' },
    usage: { tokens: 0 },
  });
  const unregister = registry.registerGroup(contract.conversation, key, instance);
  const pair = memoryTransportPair();
  const controller = bindContract(contract, {
    registry,
    impl: { conversation: fromRegistry() },
  });
  serve(pair.right, controller);
  return { client: contractClient(contract, connect(pair.left)), controller, key, unregister };
}

describe('liveModelGroup', () => {
  it('registers group member models and resolves their live topics', () => {
    const { controller, key, unregister } = setup();
    expect(
      controller.resolveLive(encodeTopic(contract.conversation.models.state.id, key))?.snapshot()
    ).toMatchObject({ data: { title: 'Initial' } });
    unregister();
    expect(
      controller.resolveLive(encodeTopic(contract.conversation.models.state.id, key))?.snapshot
    ).toThrow(/Unknown live topic/);
  });

  it('binds a group client and settles multi-member mutations', async () => {
    const { client, key } = setup();
    const seenTitles: string[] = [];
    const conversation = client.conversation(key, {
      state: (state) => seenTitles.push(state.title),
    });
    await conversation.ready;

    const invocation = await conversation.setTitle({ title: 'Updated' });
    await invocation.settled;

    expect(invocation.result.success).toBe(true);
    expect(conversation.state.client.getSnapshot()).toEqual({ title: 'Updated' });
    expect(conversation.usage.client.getSnapshot()).toEqual({ tokens: 7 });
    expect(seenTitles.at(-1)).toBe('Updated');
    await conversation.dispose();
  });

  it('requires a registry for groups', () => {
    expect(() => bindContract(contract, { impl: { conversation: fromRegistry() } })).toThrow(
      /requires a registry/
    );
  });

  it('mounts group model ids and mutations under nested contract keys', async () => {
    const nested = defineContract({ child: contract });
    const key = { conversationId: 'nested' };
    const registry = new LiveModelRegistry();
    const instance = createGroupInstance(nested.child.conversation, key, {
      state: { title: 'Initial' },
      usage: { tokens: 0 },
    });
    registry.registerGroup(nested.child.conversation, key, instance);
    const pair = memoryTransportPair();
    const controller = bindContract(nested, {
      registry,
      impl: { child: { conversation: fromRegistry() } },
    });
    serve(pair.right, controller);
    const client = contractClient(nested, connect(pair.left));

    expect(nested.child.conversation.models.state.id).toBe('child.conversation.state');
    const conversation = client.child.conversation(key);
    await conversation.ready;
    const invocation = await conversation.setTitle({ title: 'Nested' });
    await invocation.settled;

    expect(conversation.state.client.getSnapshot()).toEqual({ title: 'Nested' });
    await conversation.dispose();
  });
});
