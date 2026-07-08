import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLiveModelHost, createLiveModelReplica, type LiveModelReplicaOptions } from '../live';
import { bindContract, encodeTopic } from './bind';
import { client, type LiveModelClientHandle } from './client';
import { connect } from './connect';
import {
  defineContract,
  liveModel,
  liveState,
  mutation,
  type LiveModelKey,
  type LiveModelDef,
} from './define';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const keySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ title: z.string() });
const usageSchema = z.object({ tokens: z.number() });

const contract = defineContract({
  conversation: liveModel({
    key: keySchema,
    states: {
      state: liveState({ data: stateSchema }),
      usage: liveState({ data: usageSchema }),
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
  const host = createLiveModelHost(contract.conversation);
  const instance = host.create(key, {
    state: { title: 'Initial' },
    usage: { tokens: 0 },
  });
  const pair = memoryTransportPair();
  const controller = bindContract(contract, { conversation: host });
  serve(pair.right, controller);
  return { client: client(contract, connect(pair.left)), controller, key, instance };
}

describe('liveModel', () => {
  it('registers group member models and resolves their live topics', () => {
    const { controller, key, instance } = setup();
    expect(
      controller.resolveLive(encodeTopic(contract.conversation.states.state.id, key))?.snapshot()
    ).toMatchObject({ data: { title: 'Initial' } });
    instance.dispose();
    expect(
      controller.resolveLive(encodeTopic(contract.conversation.states.state.id, key))?.snapshot
    ).toThrow(/Unknown live topic/);
  });

  it('binds a group client and settles multi-member mutations', async () => {
    const { client, key } = setup();
    const seenTitles: string[] = [];
    const { instance: conversation, dispose } = await acquireConversation(
      client.conversation,
      key,
      {
        onChange: {
          state: (state) => seenTitles.push((state as { title: string }).title),
        },
      }
    );
    await conversation.ready;

    const invocation = await conversation.mutations.setTitle({ title: 'Updated' });
    await invocation.settled;

    expect(invocation.result.success).toBe(true);
    expect(conversation.states.state.current()).toEqual({ title: 'Updated' });
    expect(conversation.states.usage.current()).toEqual({ tokens: 7 });
    expect(seenTitles.at(-1)).toBe('Updated');
    await dispose();
  });

  it('dedupes duplicate group mutation ids', async () => {
    const { client, key } = setup();
    const { instance: conversation, dispose } = await acquireConversation(client.conversation, key);

    await conversation.mutations.setTitle({ title: 'Once' }, { mutationId: 'same-group-mutation' });
    await conversation.mutations.setTitle(
      { title: 'Twice' },
      { mutationId: 'same-group-mutation' }
    );

    expect(conversation.states.state.current()).toEqual({ title: 'Once' });
    expect(conversation.states.usage.current()).toEqual({ tokens: 4 });
    await dispose();
  });

  it('requires a matching host for groups', () => {
    const other = defineContract({
      other: liveModel({
        key: keySchema,
        states: { state: liveState({ data: stateSchema }) },
      }),
    });
    const host = createLiveModelHost(other.other);
    expect(() => bindContract(contract, { conversation: host as never })).toThrow(
      /created for 'other'/
    );
  });

  it('runs schema-only mutation handlers supplied by the host', async () => {
    const schemaOnly = defineContract({
      conversation: liveModel({
        key: keySchema,
        states: { state: liveState({ data: stateSchema }) },
        mutations: {
          setTitle: mutation({
            input: z.object({ title: z.string() }),
            data: z.void(),
            error: z.string(),
          }),
        },
      }),
    });
    const key = { conversationId: 'schema-only' };
    const host = createLiveModelHost(schemaOnly.conversation, {
      mutations: {
        setTitle: (ctx, input) => {
          expect(ctx.key).toEqual(key);
          ctx.produce('state', (draft) => {
            (draft as { title: string }).title = input.title;
          });
          return ok(undefined);
        },
      },
    });
    host.create(key, { state: { title: 'Initial' } });
    const pair = memoryTransportPair();
    serve(pair.right, bindContract(schemaOnly, { conversation: host }));
    const contractClient = client(schemaOnly, connect(pair.left));

    const { instance: conversation, dispose } = await acquireConversation(
      contractClient.conversation,
      key
    );
    const invocation = await conversation.mutations.setTitle({ title: 'Host handled' });
    await invocation.settled;

    expect(conversation.states.state.current()).toEqual({ title: 'Host handled' });
    await dispose();
  });

  it('requires handlers for schema-only mutations', () => {
    const schemaOnly = defineContract({
      conversation: liveModel({
        key: keySchema,
        states: { state: liveState({ data: stateSchema }) },
        mutations: {
          setTitle: mutation({
            input: z.object({ title: z.string() }),
            data: z.void(),
            error: z.string(),
          }),
        },
      }),
    });
    const host = createLiveModelHost(schemaOnly.conversation);

    expect(() => bindContract(schemaOnly, { conversation: host })).toThrow(/requires a handler/);
  });

  it('mounts group model ids and mutations under nested contract keys', async () => {
    const nested = defineContract({ child: contract });
    const key = { conversationId: 'nested' };
    const host = createLiveModelHost(nested.child.conversation);
    host.create(key, {
      state: { title: 'Initial' },
      usage: { tokens: 0 },
    });
    const pair = memoryTransportPair();
    const controller = bindContract(nested, { child: { conversation: host } });
    serve(pair.right, controller);
    const contractClient = client(nested, connect(pair.left));

    expect(nested.child.conversation.states.state.id).toBe('child.conversation.state');
    const { instance: conversation, dispose } = await acquireConversation(
      contractClient.child.conversation,
      key
    );
    const invocation = await conversation.mutations.setTitle({ title: 'Nested' });
    await invocation.settled;

    expect(conversation.states.state.current()).toEqual({ title: 'Nested' });
    await dispose();
  });
});

async function acquireConversation<Group extends LiveModelDef>(
  group: LiveModelClientHandle<Group>,
  key: LiveModelKey<Group>,
  options: LiveModelReplicaOptions = {}
) {
  const replica = createLiveModelReplica(group.def, group, options);
  const lease = replica.acquire(key);
  const instance = await lease.ready();
  return {
    instance,
    async dispose() {
      await lease.release();
      await replica.dispose();
    },
  };
}
