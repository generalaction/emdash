import { fileURLToPath } from 'node:url';
import { client, connect, MaterializedModel } from '../../src/index';
import { processTransport, type ManagedProcess } from '../../src/process';
import { childProcessHost } from '../../src/process/node';
import { createScope } from '../../src/util';
import { processExampleApi } from './contract';

async function main(): Promise<void> {
  const scope = createScope({ label: 'process-example' });
  const host = childProcessHost();
  const runtime = await host.spawn(
    {
      entry: fileURLToPath(new URL('./runtime.ts', import.meta.url)),
      supervision: { restart: 'on-failure', backoffMs: [50], maxRestarts: 1 },
    },
    scope
  );

  const client = makeClient(runtime);
  console.log('ping:', await client.ping('one'));
  console.log('increment:', await client.increment(undefined));

  const restarted = waitForRestart(runtime);
  await client.crash(undefined).catch(() => undefined);
  await restarted;
  await delay(75);

  const restartedClient = makeClient(runtime);
  console.log('ping after restart:', await restartedClient.ping('two'));
  const counter = new MaterializedModel(restartedClient.counter.handle(undefined), {
    onChange: (value) => {
      console.log('counter after restart:', value.count);
    },
  });
  await counter.ready;
  await counter.dispose();

  await scope.dispose();
}

function makeClient(runtime: ManagedProcess) {
  return client(processExampleApi, connect(processTransport(runtime)));
}

function waitForRestart(runtime: ManagedProcess): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = runtime.onExit((exit) => {
      if (!exit.willRestart) return;
      unsubscribe();
      resolve();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
