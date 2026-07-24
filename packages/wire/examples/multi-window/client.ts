import { z } from 'zod';
import {
  createController,
  client,
  connect,
  createLiveModelHost,
  createLiveModelReplica,
  createWireSessionHub,
  defineContract,
  liveModel,
  liveState,
  memoryTransportPair,
  procedure,
} from '../../src/index';

const api = defineContract({
  increment: procedure({ input: z.void().optional(), output: z.number() }),
  counter: liveModel({
    key: z.void().optional(),
    states: { counter: liveState({ data: z.object({ count: z.number() }) }) },
  }),
});

type CounterState = { count: number };
const counters = createLiveModelHost(api.counter);
const counter = counters.create(undefined, {
  counter: { count: 0 } satisfies CounterState,
}).states.counter;
const controller = createController(api, {
  increment: () => {
    counter.produce((draft) => {
      draft.count += 1;
    });
    return counter.snapshot().data.count;
  },
  counter: counters,
});

async function main(): Promise<void> {
  const hub = createWireSessionHub(controller);
  const first = openWindow(hub, 'window-1');
  const second = openWindow(hub, 'window-2');

  const firstReplica = createLiveModelReplica(api.counter, first.client.counter, {
    onChange: {
      counter: (value) => {
        console.log('window-1:', value);
      },
    },
  });
  const firstLease = firstReplica.acquire(undefined);
  const firstCounter = await firstLease.ready();
  const secondReplica = createLiveModelReplica(api.counter, second.client.counter, {
    onChange: {
      counter: (value) => {
        console.log('window-2:', value);
      },
    },
  });
  const secondLease = secondReplica.acquire(undefined);
  const secondCounter = await secondLease.ready();

  await Promise.all([firstCounter.ready, secondCounter.ready]);
  await first.client.increment(undefined);
  await second.client.increment(undefined);
  await Promise.resolve();

  await firstLease.release();
  await firstReplica.dispose();
  first.close();
  await second.client.increment(undefined);
  await Promise.resolve();

  await secondLease.release();
  await secondReplica.dispose();
  second.close();
  await hub.dispose();
}

function openWindow(hub: ReturnType<typeof createWireSessionHub>, id: string) {
  const pair = memoryTransportPair();
  hub.open(id, pair.right);
  return {
    client: client(api, connect(pair.left)),
    close: pair.disconnect,
  };
}

void main();
