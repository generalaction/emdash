import { z } from 'zod';
import {
  bindContract,
  client,
  connect,
  createWireSessionHub,
  defineContract,
  liveModel,
  LiveModel,
  MaterializedModel,
  memoryTransportPair,
  procedure,
} from '../../src/index';

const api = defineContract({
  increment: procedure({ input: z.void().optional(), output: z.number() }),
  counter: liveModel({ key: z.void().optional(), data: z.object({ count: z.number() }) }),
});

type CounterState = { count: number };
const counter = new LiveModel<CounterState>({ count: 0 }, 1000);
const controller = bindContract(api, {
  increment: () => {
    counter.produce((draft) => {
      draft.count += 1;
    });
    return counter.snapshot().data.count;
  },
  counter: () => counter,
});

async function main(): Promise<void> {
  const hub = createWireSessionHub(controller);
  const first = openWindow(hub, 'window-1');
  const second = openWindow(hub, 'window-2');

  const firstCounter = new MaterializedModel(first.client.counter.handle(undefined), {
    onChange: (value) => {
      console.log('window-1:', value);
    },
  });
  const secondCounter = new MaterializedModel(second.client.counter.handle(undefined), {
    onChange: (value) => {
      console.log('window-2:', value);
    },
  });

  await Promise.all([firstCounter.ready, secondCounter.ready]);
  await first.client.increment(undefined);
  await second.client.increment(undefined);
  await Promise.resolve();

  await firstCounter.dispose();
  first.close();
  await second.client.increment(undefined);
  await Promise.resolve();

  await secondCounter.dispose();
  second.close();
  hub.dispose();
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
