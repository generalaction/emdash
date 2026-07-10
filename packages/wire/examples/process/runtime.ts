import { createController, createLiveModelHost } from '../../src/index';
import { serveWorkerProcess } from '../../src/util/process-runtime';
import { processExampleApi } from './contract';

const counters = createLiveModelHost(processExampleApi.counter);
const counter = counters.create(undefined, { counter: { count: 0 } }).states.counter;

void serveWorkerProcess(() =>
  createController(processExampleApi, {
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
  })
);
