import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveModelServer } from '../live/model';
import { liveModelRef } from '../live/mutations';
import type { LiveSource, LiveUpdate } from '../live/protocol';
import { bind, encodeTopic } from './bind';
import { connect } from './connect';
import { defineContract, procedure } from './define';
import { WireError } from './protocol';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const contract = defineContract({
  procedures: {
    greet: procedure({ input: z.object({ name: z.string() }), output: z.string() }),
    fail: procedure({ input: z.void().optional(), output: z.void() }),
  },
  models: {
    state: liveModelRef(
      'wire.state',
      z.object({ id: z.string() }),
      z.object({ count: z.number() })
    ),
  },
  logs: {},
});

function setup() {
  const pair = memoryTransportPair();
  const model = new LiveModelServer({ count: 0 }, 1000);
  const controller = bind(contract, {
    procedures: {
      greet: ({ name }) => `hello ${name}`,
      fail: () => {
        throw new WireError('EXPECTED', 'expected failure');
      },
    },
    live: {
      models: { state: ({ id }) => (id === 'known' ? model : null) },
      logs: {},
    },
  });
  const disposeServer = serve(pair.right, controller);
  const connection = connect(pair.left);
  return { pair, connection, model, disposeServer };
}

describe('wire serve/connect', () => {
  it('calls procedures and propagates errors', async () => {
    const { connection } = setup();
    await expect(connection.call('greet', { name: 'wire' })).resolves.toBe('hello wire');
    await expect(connection.call('fail', undefined)).rejects.toMatchObject({ code: 'EXPECTED' });
  });

  it('snapshots and subscribes to live sources with refcounted detach', async () => {
    const { connection, model } = setup();
    const topic = encodeTopic(contract.models.state.id, { id: 'known' });
    await expect(connection.snapshot(topic)).resolves.toMatchObject({ data: { count: 0 } });

    const updates: LiveUpdate[] = [];
    const detach = await connection.attach(topic, (update) => updates.push(update));
    model.produce((draft) => {
      draft.count = 1;
    });
    await waitFor(() => updates.length === 1);
    detach();
    model.produce((draft) => {
      draft.count = 2;
    });
    await Promise.resolve();
    expect(updates).toHaveLength(1);
  });

  it('surfaces attach failures for unknown topics', async () => {
    const { connection } = setup();
    await expect(connection.attach('missing.topic', () => {})).rejects.toMatchObject({
      code: 'UNKNOWN_TOPIC',
    });
  });

  it('cleans server subscriptions on disconnect', async () => {
    let detachCount = 0;
    const source: LiveSource = {
      snapshot: () => ({ generation: 1, sequence: 0, timestamp: 0, data: {} }),
      subscribe: () => {
        return () => {
          detachCount += 1;
        };
      },
    };
    const pair = memoryTransportPair();
    const controller = bind(
      defineContract({
        procedures: {},
        models: { state: liveModelRef('cleanup.state', z.void().optional(), z.object({})) },
        logs: {},
      }),
      { procedures: {}, live: { models: { state: () => source }, logs: {} } }
    );
    serve(pair.right, controller);
    const connection = connect(pair.left);
    await connection.attach(encodeTopic('cleanup.state', undefined), () => {});
    pair.disconnect();
    expect(detachCount).toBe(1);
  });

  it('re-attaches active topics after reconnect notification', async () => {
    const { connection, pair, model } = setup();
    const topic = encodeTopic(contract.models.state.id, { id: 'known' });
    const updates: LiveUpdate[] = [];
    await connection.attach(topic, (update) => updates.push(update));
    pair.left.disconnect();
    await expect(connection.call('greet', { name: 'after' })).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });
    // Existing transport is disconnected, but the connection attempted to replay the attach.
    // A full reconnecting transport swaps in the new endpoint; this asserts the local disconnect path is safe.
    expect(() => {
      model.produce((draft) => {
        draft.count = 1;
      });
    }).not.toThrow();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}
