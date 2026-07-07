import {
  LiveModelServer,
  bindContract,
  isWireMessage,
  serve,
  type WireTransport,
} from '../../src/index';
import { processExampleApi } from './contract';

const counter = new LiveModelServer({ count: 0 }, Date.now());

const controller = bindContract(processExampleApi, {
  impl: {
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
    counter: () => counter,
  },
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
