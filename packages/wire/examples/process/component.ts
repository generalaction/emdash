import { z } from 'zod';
import { defineWireComponent } from '../../src/component';
import { createController, createLiveModelHost } from '../../src/index';
import { processExampleApi } from './contract';

const counters = createLiveModelHost(processExampleApi.counter);
const counter = counters.create(undefined, { counter: { count: 0 } }).states.counter;

export const processExampleComponent = defineWireComponent({
  id: 'process-example',
  contract: processExampleApi,
  requirements: {},
  configSchema: z.object({}),
  create: ({ instance, scope }) =>
    instance({
      scope,
      controller: createController(processExampleApi, {
        ping: (value) => `pong:${value}`,
        increment: () => {
          counter.produce((draft) => {
            draft.count += 1;
          });
          return counter.snapshot().data.count;
        },
        crash: () => {
          setTimeout(() => process.exit(1), 0);
        },
        counter: counters,
      }),
    }),
});
