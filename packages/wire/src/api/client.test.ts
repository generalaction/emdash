import { ok } from '@emdash/shared';
import { waitFor } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveLog } from '../live/log';
import { createLiveModelHost } from '../live/mutations';
import { createLiveModelReplica, ReplicaState } from '../live/replica';
import { createTestWire } from '../testing';
import { defineContract, liveModel, liveState, liveLog, mutation, procedure } from './define';

const stateSchema = z.object({ count: z.number() });
const keySchema = z.object({ id: z.string() });

const contract = defineContract({
  increment: procedure({ input: keySchema, output: stateSchema }),
  state: liveModel({ key: keySchema, states: { state: liveState({ data: stateSchema }) } }),
  output: liveLog({ key: keySchema }),
});

describe('client', () => {
  it('calls typed procedures and exposes live client handles', async () => {
    const host = createLiveModelHost(contract.state);
    const instance = host.create({ id: 'task' }, { state: { count: 0 } });
    const log = new LiveLog({ generation: 2000 });
    const { client: contractClient } = createTestWire(contract, {
      increment: () => {
        instance.states.state.produce((draft) => {
          draft.count += 1;
        });
        log.append('incremented\n');
        return instance.states.state.snapshot().data;
      },
      state: host,
      output: () => log,
    });

    const seenStates: Array<{ count: number }> = [];
    const state = new ReplicaState(contractClient.state.state({ id: 'task' }, 'state'), {
      schema: stateSchema,
      onChange: (value) => seenStates.push(value),
    });
    const appended: string[] = [];
    const resets: string[] = [];
    const output = contractClient.output.handle({ id: 'task' });

    await state.ready;
    resets.push((await output.snapshot()).data.text);
    const detachLog = await output.attach((update) => {
      const delta = update.delta as { chunk: string };
      appended.push(delta.chunk);
    });
    await expect(contractClient.increment({ id: 'task' })).resolves.toEqual({ count: 1 });
    await waitFor(() => state.current().count === 1 && appended.length === 1);

    expect(seenStates.at(-1)).toEqual({ count: 1 });
    expect(appended).toEqual(['incremented\n']);
    expect(resets).toEqual(['']);

    await state.dispose();
    detachLog();
  });

  it('builds nested clients using object keys as call paths', async () => {
    const nested = defineContract({ child: contract });
    const host = createLiveModelHost(nested.child.state);
    const instance = host.create({ id: 'task' }, { state: { count: 0 } });
    const log = new LiveLog({ generation: 2000 });
    const { client: contractClient } = createTestWire(nested, {
      child: {
        increment: () => {
          instance.states.state.produce((draft) => {
            draft.count += 1;
          });
          log.append('incremented\n');
          return instance.states.state.snapshot().data;
        },
        state: host,
        output: () => log,
      },
    });

    const state = new ReplicaState(contractClient.child.state.state({ id: 'task' }, 'state'), {
      schema: stateSchema,
    });
    await state.ready;
    await expect(contractClient.child.increment({ id: 'task' })).resolves.toEqual({ count: 1 });
    await waitFor(() => state.current().count === 1);
    await state.dispose();
  });

  it('uses caller-supplied mutation IDs for group mutations', async () => {
    const groupContract = defineContract({
      conversation: liveModel({
        key: keySchema,
        states: {
          state: liveState({ data: stateSchema }),
        },
        mutations: {
          bump: mutation({ input: z.object({}), data: z.void(), error: z.string() }, (ctx) => {
            ctx.produce('state', (draft) => {
              (draft as { count: number }).count += 1;
            });
            return ok(undefined);
          }),
        },
      }),
    });
    const key = { id: 'task' };
    const host = createLiveModelHost(groupContract.conversation);
    const instance = host.create(key, {
      state: { count: 0 },
    });
    const updates: unknown[] = [];
    instance.states.state.subscribe((update) => updates.push(update));

    const { client: contractClient } = createTestWire(groupContract, { conversation: host });
    const replica = createLiveModelReplica(
      contractClient.conversation.def,
      contractClient.conversation
    );
    const lease = replica.acquire(key);
    const binding = await lease.ready();

    await binding.ready;
    const invocation = await binding.mutations.bump({}, { mutationId: 'custom-mutation' });
    await invocation.settled;

    expect(updates).toMatchObject([{ mutationIds: ['custom-mutation'] }]);
    await lease.release();
    await replica.dispose();
  });
});
