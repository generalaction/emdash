import { fileURLToPath } from 'node:url';
import { createScope } from '@emdash/shared/concurrency';
import { retrySchedules } from '@emdash/shared/scheduling';
import { ReplicaState } from '../../src/index';
import type { WireWorker } from '../../src/worker';
import { createWireWorkerHost } from '../../src/worker';
import { childProcessSpawner } from '../../src/worker/node';
import { processExampleComponent } from './component';
import type { processExampleApi } from './contract';

async function main(): Promise<void> {
  const scope = createScope({ label: 'process-example' });
  const host = createWireWorkerHost({
    scope,
    processSpawner: childProcessSpawner(),
  });
  const worker = host.create(processExampleComponent, {
    name: 'process-example',
    executable: fileURLToPath(new URL('./runtime.ts', import.meta.url)),
    dependencies: {},
    config: {},
    supervision: {
      restart: 'on-failure',
      schedule: retrySchedules.sequence([50]),
    },
  });
  const api = await worker.ready();

  const counter = new ReplicaState(api.counter.state(undefined, 'counter'), {
    onChange: (value) => {
      console.log('counter:', value.count);
    },
  });
  await counter.ready;

  console.log('ping:', await api.ping('one'));
  console.log('increment:', await api.increment(undefined));
  const restarted = waitForRestart(worker);
  await api.crash(undefined).catch(() => undefined);
  await restarted;

  console.log('ping after restart:', await api.ping('two'));
  await waitFor(() => counter.current().count === 0);
  console.log('counter after restart:', counter.current().count);
  await counter.dispose();

  await scope.dispose();
}

function waitForRestart(worker: WireWorker<typeof processExampleApi>): Promise<void> {
  const previousGeneration = worker.state.kind === 'ready' ? worker.state.generation : 0;
  return new Promise((resolve) => {
    const unsubscribe = worker.onStateChanged((state) => {
      if (state.kind !== 'ready' || state.generation <= previousGeneration) return;
      unsubscribe();
      resolve();
    });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

void main();
