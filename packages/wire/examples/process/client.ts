import { fileURLToPath } from 'node:url';
import { ReplicaState } from '../../src/index';
import { childProcessHost } from '../../src/process/node';
import { createScope } from '../../src/util';
import { spawnRuntime } from '../../src/util/process-runtime';
import { processExampleApi } from './contract';

async function main(): Promise<void> {
  const scope = createScope({ label: 'process-example' });
  const runtime = await spawnRuntime({
    host: childProcessHost(),
    contract: processExampleApi,
    spec: {
      entry: fileURLToPath(new URL('./runtime.ts', import.meta.url)),
      supervision: { restart: 'on-failure', backoffMs: [50], maxRestarts: 1 },
    },
    scope,
  });

  const counter = new ReplicaState(runtime.client.counter.state(undefined, 'counter'), {
    onChange: (value) => {
      console.log('counter:', value.count);
    },
  });
  await counter.ready;

  console.log('ping:', await runtime.client.ping('one'));
  console.log('increment:', await runtime.client.increment(undefined));
  const restarted = waitForRestart(runtime);
  await runtime.client.crash(undefined).catch(() => undefined);
  await restarted;

  console.log('ping after restart:', await runtime.client.ping('two'));
  await waitFor(() => counter.current().count === 0);
  console.log('counter after restart:', counter.current().count);
  await counter.dispose();

  await scope.dispose();
}

function waitForRestart(runtime: { onRestarted(cb: () => void): () => void }): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = runtime.onRestarted(() => {
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
