import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveLogServer } from '../live/log';
import { MaterializedModel, materializeInstance } from '../live/materialize';
import { LiveModel } from '../live/model';
import { createLiveModelHost } from '../live/mutations';
import { bindContract } from './bind';
import { client } from './client';
import { connect } from './connect';
import {
  defineContract,
  defineLiveModelContract,
  liveLog,
  liveModel,
  mutation,
  procedure,
} from './define';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const stateSchema = z.object({ count: z.number() });
const keySchema = z.object({ id: z.string() });

const contract = defineContract({
  increment: procedure({ input: keySchema, output: stateSchema }),
  state: liveModel({ key: keySchema, data: stateSchema }),
  output: liveLog({ key: keySchema }),
});

describe('client', () => {
  it('calls typed procedures and exposes thin model/log handles', async () => {
    const pair = memoryTransportPair();
    const model = new LiveModel({ count: 0 }, 1000);
    const log = new LiveLogServer({ generation: 2000 });
    const controller = bindContract(contract, {
      increment: () => {
        model.produce((draft) => {
          draft.count += 1;
        });
        log.append('incremented\n');
        return model.snapshot().data;
      },
      state: () => model,
      output: () => log,
    });
    serve(pair.right, controller);
    const thin = client(contract, connect(pair.left));

    const seenStates: Array<{ count: number }> = [];
    const state = new MaterializedModel(thin.state.handle({ id: 'task' }), {
      schema: stateSchema,
      onChange: (value) => seenStates.push(value),
    });
    const appended: string[] = [];
    const resets: string[] = [];
    const output = thin.output.handle({ id: 'task' });

    await state.ready;
    resets.push((await output.snapshot()).data.text);
    const detachLog = await output.attach((update) => {
      const delta = update.delta as { chunk: string };
      appended.push(delta.chunk);
    });
    await expect(thin.increment({ id: 'task' })).resolves.toEqual({ count: 1 });
    await waitFor(() => state.current().count === 1 && appended.length === 1);

    expect(seenStates.at(-1)).toEqual({ count: 1 });
    expect(appended).toEqual(['incremented\n']);
    expect(resets).toEqual(['']);

    await state.dispose();
    detachLog();
  });

  it('builds nested clients using object keys as call paths', async () => {
    const nested = defineContract({ child: contract });
    const pair = memoryTransportPair();
    const model = new LiveModel({ count: 0 }, 1000);
    const log = new LiveLogServer({ generation: 2000 });
    const controller = bindContract(nested, {
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
    });
    serve(pair.right, controller);
    const thin = client(nested, connect(pair.left));

    const state = new MaterializedModel(thin.child.state.handle({ id: 'task' }), {
      schema: stateSchema,
    });
    await state.ready;
    await expect(thin.child.increment({ id: 'task' })).resolves.toEqual({ count: 1 });
    await waitFor(() => state.current().count === 1);
    await state.dispose();
  });

  it('uses caller-supplied mutation IDs for group mutations', async () => {
    const groupContract = defineContract({
      conversation: defineLiveModelContract({
        key: keySchema,
        models: {
          state: stateSchema,
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
    instance.models.state.subscribe((update) => updates.push(update));

    const pair = memoryTransportPair();
    const controller = bindContract(groupContract, { conversation: host });
    serve(pair.right, controller);
    const thin = client(groupContract, connect(pair.left));
    const binding = materializeInstance(thin.conversation, key);

    await binding.ready;
    const invocation = await binding.mutations.bump({}, { mutationId: 'custom-mutation' });
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
