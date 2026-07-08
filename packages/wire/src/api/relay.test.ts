import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LiveSource, LiveUpdate } from '../live/protocol';
import { mergeControllers, type Controller } from './bind';
import { connect } from './connect';
import { defineContract, liveModel, procedure } from './define';
import { relayController } from './relay';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const contract = defineContract({
  greet: procedure({ input: z.object({ name: z.string() }), output: z.string() }),
  state: liveModel({ key: z.object({ id: z.string() }), data: z.object({ count: z.number() }) }),
});

describe('relayController', () => {
  it('forwards calls and async snapshots', async () => {
    const upstreamPair = memoryTransportPair();
    const source: LiveSource = {
      snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data: { count: 1 } }),
      subscribe: () => () => {},
    };
    serve(upstreamPair.right, makeController(source));
    const relay = relayController(connect(upstreamPair.left));

    await expect(relay.call('greet', { name: 'relay' })).resolves.toBe('hello relay');
    await expect(relay.resolveLive('state|{"id":"x"}')?.snapshot()).resolves.toMatchObject({
      data: { count: 1 },
    });
  });

  it('dedupes multiple downstream subscribers through one upstream connection', async () => {
    const updates = new Set<(update: LiveUpdate) => void>();
    let subscribeCount = 0;
    let unsubscribeCount = 0;
    const source: LiveSource = {
      snapshot: () => ({ generation: 1, sequence: 0, timestamp: 0, data: { count: 0 } }),
      subscribe: (cb) => {
        subscribeCount += 1;
        updates.add(cb);
        return () => {
          unsubscribeCount += 1;
          updates.delete(cb);
        };
      },
    };
    const upstreamPair = memoryTransportPair();
    serve(upstreamPair.right, makeController(source));
    const relay = relayController(connect(upstreamPair.left));
    const first = memoryTransportPair();
    const second = memoryTransportPair();
    serve(first.right, relay);
    serve(second.right, relay);
    const topic = 'state|{"id":"x"}';

    const firstDetach = await connect(first.left).attach(topic, () => {});
    const secondDetach = await connect(second.left).attach(topic, () => {});
    expect(subscribeCount).toBe(1);

    firstDetach();
    await Promise.resolve();
    expect(unsubscribeCount).toBe(0);
    secondDetach();
    await waitFor(() => unsubscribeCount === 1);
  });

  it('falls back to dynamic controllers in merged live resolution', () => {
    const relay = relayController({
      call: async () => null,
      snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data: 'ok' }),
      attach: async () => () => {},
      onDisconnect: () => () => {},
    });
    const staticController: Controller = {
      call: async () => null,
      resolveLive: () => null,
      liveRefIds: () => [],
    };
    const merged = mergeControllers({ static: staticController, dynamic: relay });
    expect(merged.resolveLive('anything')).not.toBeNull();
    expect(merged.liveRefIds()).toBe('dynamic');
  });

  it('propagates cancellation to upstream calls', async () => {
    let aborted = false;
    let started = false;
    const upstreamPair = memoryTransportPair();
    const controller: Controller = {
      call: async (_path, _input, meta = {}) =>
        new Promise<string>((resolve, reject) => {
          started = true;
          if (meta.signal?.aborted) {
            aborted = true;
            reject(new Error('aborted'));
            return;
          }
          meta.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
          setTimeout(() => resolve('late'), 10);
        }),
      resolveLive: () => null,
      liveRefIds: () => [],
    };
    serve(upstreamPair.right, controller);
    const relay = relayController(connect(upstreamPair.left));
    const abort = new AbortController();

    const result = relay.call('slow', undefined, { signal: abort.signal });
    await waitFor(() => started);
    abort.abort();

    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    await waitFor(() => aborted);
  });
});

function makeController(source: LiveSource): Controller {
  return {
    call: async (path, input) => {
      if (path !== 'greet') throw new Error('unexpected path');
      return `hello ${(input as { name: string }).name}`;
    },
    resolveLive: () => source,
    liveRefIds: () => [contract.state.id],
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}
