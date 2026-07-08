import {
  bindContract,
  createLiveModelHost,
  isWireMessage,
  serve,
  type WireTransport,
} from '../../src/index';
import { processExampleApi } from './contract';

const counters = createLiveModelHost(processExampleApi.counter);
const counter = counters.create(undefined, { counter: { count: 0 } }).models.counter;

const controller = bindContract(processExampleApi, {
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
});

serve(currentProcessTransport(), controller);

function currentProcessTransport(): WireTransport {
  return {
    post(message) {
      process.send?.(message);
    },
    onMessage(cb) {
      const listener = (message: unknown): void => {
        if (isWireMessage(message)) cb(message);
      };
      process.on('message', listener);
      return () => process.off('message', listener);
    },
    onDisconnect(cb) {
      process.on('disconnect', cb);
      return () => process.off('disconnect', cb);
    },
  };
}
