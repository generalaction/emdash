import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createController } from '../api/controller';
import { defineContract, procedure } from '../api/define';
import { retrySchedules } from '../scheduling';
import { createManualClock, createStubLogger, FakeWorkerProcessSpawner } from '../testing';
import { createScope } from '../util';
import { createWireWorkerHost } from './host';
import { serveWireWorker } from './serve';
import type { WorkerParentPort } from './types';

const api = defineContract({
  ping: procedure({ input: z.string(), output: z.string() }),
});

describe('WireWorkerHost and WorkerSlot', () => {
  it('lazily starts a worker and keeps a stable client', async () => {
    const spawner = new FakeWorkerProcessSpawner();
    const scope = createScope({ label: 'root' });
    const host = createWireWorkerHost({ scope, processSpawner: spawner });
    const worker = host.define({
      name: 'demo',
      contract: api,
      process: () => ({ entry: 'worker' }),
      shutdownGraceMs: 0,
    });

    const firstClient = worker.client;
    const secondClient = worker.client;

    await expect(firstClient.ping('before-ready')).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });

    const ready = worker.ready();
    await flush();
    void startChild(spawner.latest());
    await ready;

    await expect(firstClient.ping('one')).resolves.toBe('pong:one');
    expect(secondClient).toBe(firstClient);

    await host.dispose();
  });

  it('restarts failed generations without replacing the public client', async () => {
    const clock = createManualClock();
    const spawner = new FakeWorkerProcessSpawner();
    const scope = createScope({ label: 'root' });
    const host = createWireWorkerHost({ scope, processSpawner: spawner, clock });
    const worker = host.define({
      name: 'demo',
      contract: api,
      process: () => ({ entry: 'worker' }),
      shutdownGraceMs: 0,
      supervision: {
        restart: 'on-failure',
        schedule: retrySchedules.sequence([0]),
      },
    });

    const ready = worker.ready();
    await flush();
    void startChild(spawner.latest());
    await ready;
    const firstClient = worker.client;
    const previousGeneration = worker.state.kind === 'ready' ? worker.state.generation : 0;
    spawner.latest().emitExit({ code: 1 });
    await clock.runAll();
    await waitFor(() => spawner.processes.length === 2);
    void startChild(spawner.latest());
    await waitFor(
      () => worker.state.kind === 'ready' && worker.state.generation > previousGeneration
    );

    expect(worker.client).toBe(firstClient);
    await expect(firstClient.ping('two')).resolves.toBe('pong:two');
    expect(spawner.processes).toHaveLength(2);

    await host.dispose();
  });

  it('fails startup when the retry schedule is exhausted', async () => {
    const clock = createManualClock();
    const spawner = new FakeWorkerProcessSpawner();
    const scope = createScope({ label: 'root' });
    const host = createWireWorkerHost({ scope, processSpawner: spawner, clock });
    const worker = host.define({
      name: 'demo',
      contract: api,
      process: () => ({ entry: 'worker' }),
      shutdownGraceMs: 0,
      supervision: {
        restart: 'on-failure',
        schedule: retrySchedules.sequence([]),
      },
    });

    const pending = worker.ready();
    await flush();
    spawner.latest().emitExit({ code: 1 });

    await expect(pending).rejects.toThrow('Worker exited before ready');
    expect(worker.state.kind).toBe('failed');
    await host.dispose();
  });

  it('starts workers explicitly and reports structured runtime logs', async () => {
    const { logger, calls } = createStubLogger();
    const spawner = new FakeWorkerProcessSpawner();
    const scope = createScope({ label: 'root', logger });

    const worker = createWireWorkerHost({ scope, processSpawner: spawner, logger }).define({
      name: 'demo',
      contract: api,
      process: () => ({ entry: 'worker' }),
      shutdownGraceMs: 0,
    });

    scope.run('start-demo', () => worker.ready(), { onFailure: 'report' });
    await flush();
    void startChild(spawner.latest());
    await flush();
    spawner.latest().emitStdio('stderr', '{"level":"info","msg":"child ready"}\n');

    expect(calls).toContainEqual({
      level: 'info',
      message: 'child ready',
      fields: { worker: 'demo', source: 'demo-runtime' },
    });
    await scope.dispose();
  });

  it('stops back to idle and can be started again', async () => {
    const spawner = new FakeWorkerProcessSpawner();
    const scope = createScope({ label: 'root' });
    const host = createWireWorkerHost({ scope, processSpawner: spawner });
    const worker = host.define({
      name: 'demo',
      contract: api,
      process: () => ({ entry: 'worker' }),
      shutdownGraceMs: 0,
    });

    const firstReady = worker.ready();
    await flush();
    void startChild(spawner.latest());
    await firstReady;
    expect(worker.state.kind).toBe('ready');

    await worker.stop();
    expect(worker.state.kind).toBe('idle');
    await expect(worker.client.ping('stopped')).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });

    const secondReady = worker.ready();
    await waitFor(() => spawner.processes.length === 2);
    void startChild(spawner.latest());
    await secondReady;
    await expect(worker.client.ping('again')).resolves.toBe('pong:again');

    await host.dispose();
    expect(worker.state.kind).toBe('disposed');
  });
});

async function startChild(process: { childPort: WorkerParentPort }) {
  await serveWireWorker(
    () =>
      createController(api, {
        ping: async (input) => `pong:${input}`,
      }),
    { port: process.childPort, exit: () => {} }
  );
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flush();
    if (predicate()) return;
  }
  throw new Error('Timed out waiting for condition');
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
