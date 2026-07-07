import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveLogServer } from '../live/log';
import { LiveModelServer } from '../live/model';
import { liveModelRef } from '../live/mutations';
import { bind } from './bind';
import { contractClient } from './client';
import { connect } from './connect';
import { defineContract, liveLogRef, procedure } from './define';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const stateSchema = z.object({ count: z.number() });
const keySchema = z.object({ id: z.string() });

const contract = defineContract({
  procedures: {
    increment: procedure({ input: keySchema, output: stateSchema }),
  },
  models: {
    state: liveModelRef('client.state', keySchema, stateSchema),
  },
  logs: {
    output: liveLogRef('client.output', keySchema),
  },
});

describe('contractClient', () => {
  it('calls typed procedures and wires model/log clients', async () => {
    const pair = memoryTransportPair();
    const model = new LiveModelServer({ count: 0 }, 1000);
    const log = new LiveLogServer({ generation: 2000 });
    const controller = bind(contract, {
      procedures: {
        increment: () => {
          model.produce((draft) => {
            draft.count += 1;
          });
          log.append('incremented\n');
          return model.snapshot().data;
        },
      },
      live: {
        models: { state: () => model },
        logs: { output: () => log },
      },
    });
    serve(pair.right, controller);
    const client = contractClient(contract, connect(pair.left));

    const seenStates: Array<{ count: number }> = [];
    const modelBinding = client.model('state', { id: 'task' }, (value) => seenStates.push(value));
    const appended: string[] = [];
    const resets: string[] = [];
    const logBinding = client.log(
      'output',
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
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}
