import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { client, connect } from '../api';
import { createController } from '../api/controller';
import { defineContract, procedure } from '../api/define';
import type { WireTransport } from '../api/protocol';
import { FakeWorkerProcess } from '../testing';
import { WORKER_READY_SIGNAL, WORKER_SHUTDOWN_SIGNAL } from './protocol';
import { serveWireWorker } from './serve';

const api = defineContract({
  ping: procedure({ input: z.string(), output: z.string() }),
});

describe('serveWireWorker', () => {
  it('signals readiness and serves calls', async () => {
    const process = new FakeWorkerProcess({ entry: 'worker' });

    await serveWireWorker(
      () =>
        createController(api, {
          ping: async (input) => `pong:${input}`,
        }),
      { port: process.childPort, exit: () => {} }
    );

    expect(process.childMessages).toContainEqual(WORKER_READY_SIGNAL);
    const transport: WireTransport = {
      post: (message) => process.send(message),
      onMessage: (cb) => process.onMessage((message) => cb(message as never)),
      onDisconnect: () => () => {},
    };
    const apiClient = client(api, connect(transport));
    await expect(apiClient.ping('one')).resolves.toBe('pong:one');
  });

  it('disposes the child scope on shutdown', async () => {
    const process = new FakeWorkerProcess({ entry: 'worker' });
    let disposed = false;

    await serveWireWorker(
      ({ scope }) => {
        scope.add(() => {
          disposed = true;
        });
        return createController(api, {
          ping: async (input) => `pong:${input}`,
        });
      },
      { port: process.childPort, exit: () => {} }
    );

    process.send(WORKER_SHUTDOWN_SIGNAL);
    await waitFor(() => disposed);
    expect(disposed).toBe(true);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flush();
    if (predicate()) return;
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
