import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveLogServer } from '../live/log';
import { LiveModelServer } from '../live/model';
import { createGroupInstance, LiveModelRegistry } from '../live/mutations';
import { bindContract } from './bind';
import { fromRegistry } from './bind';
import { contractClient } from './client';
import { connect } from './connect';
import { defineContract, liveLog, liveModel, liveModelGroup, mutation, procedure } from './define';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const stateSchema = z.object({ count: z.number() });
const keySchema = z.object({ id: z.string() });

const contract = defineContract({
  increment: procedure({ input: keySchema, output: stateSchema }),
  state: liveModel({ key: keySchema, data: stateSchema }),
  output: liveLog({ key: keySchema }),
});

describe('contractClient', () => {
  it('calls typed procedures and wires model/log clients', async () => {
    const pair = memoryTransportPair();
    const model = new LiveModelServer({ count: 0 }, 1000);
    const log = new LiveLogServer({ generation: 2000 });
    const controller = bindContract(contract, {
      impl: {
        increment: () => {
          model.produce((draft) => {
            draft.count += 1;
          });
          log.append('incremented\n');
          return model.snapshot().data;
        },
        state: () => model,
        output: () => log,
      },
    });
    serve(pair.right, controller);
    const client = contractClient(contract, connect(pair.left));

    const seenStates: Array<{ count: number }> = [];
    const modelBinding = client.state({ id: 'task' }, (value) => seenStates.push(value));
    const appended: string[] = [];
    const resets: string[] = [];
    const logBinding = client.output(
      { id: 'task' },
      {
        onAppend: (chunk) => appended.push(chunk),
        onReset: (data) => resets.push(data.text),
      }
    );

    await modelBinding.ready;
    await logBinding.ready;
    await expect(client.increment({ id: 'task' })).resolves.toEqual({ count: 1 });
    await waitFor(() => modelBinding.client.getSnapshot()?.count === 1 && appended.length === 1);

    expect(seenStates.at(-1)).toEqual({ count: 1 });
    expect(appended).toEqual(['incremented\n']);
    expect(resets).toEqual(['']);

    await modelBinding.dispose();
    await logBinding.dispose();
  });

  it('builds nested clients using object keys as call paths', async () => {
    const nested = defineContract({ child: contract });
    const pair = memoryTransportPair();
    const model = new LiveModelServer({ count: 0 }, 1000);
    const log = new LiveLogServer({ generation: 2000 });
    const controller = bindContract(nested, {
      impl: {
        child: {
          increment: () => {
            model.produce((draft) => {
              draft.count += 1;
            });
            log.append('incremented\n');
            return model.snapshot().data;
          },
          state: () => model,
          output: () => log,
        },
      },
    });
    serve(pair.right, controller);
    const client = contractClient(nested, connect(pair.left));

    const binding = client.child.state({ id: 'task' }, () => {});
    await binding.ready;
    await expect(client.child.increment({ id: 'task' })).resolves.toEqual({ count: 1 });
    await waitFor(() => binding.client.getSnapshot()?.count === 1);
    await binding.dispose();
  });

  it('uses caller-supplied mutation IDs for group mutations', async () => {
    const groupContract = defineContract({
      conversation: liveModelGroup({
        key: keySchema,
        models: {
          state: liveModel({ data: stateSchema }),
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
    const registry = new LiveModelRegistry();
    const instance = createGroupInstance(groupContract.conversation, key, {
      state: { count: 0 },
    });
    const updates: unknown[] = [];
    instance.models.state.subscribe((update) => updates.push(update));
    registry.registerGroup(groupContract.conversation, key, instance);

    const pair = memoryTransportPair();
    const controller = bindContract(groupContract, {
      registry,
      impl: { conversation: fromRegistry() },
    });
    serve(pair.right, controller);
    const client = contractClient(groupContract, connect(pair.left));
    const binding = client.conversation(key, { state: () => {} });

    await binding.ready;
    const invocation = await binding.bump({}, { mutationId: 'custom-mutation' });
    await invocation.settled;

    expect(updates).toMatchObject([{ mutationIds: ['custom-mutation'] }]);
    await binding.dispose();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}
