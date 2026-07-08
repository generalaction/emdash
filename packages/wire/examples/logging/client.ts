import type { LogFields, LogLevel, Logger } from '@emdash/shared/logger';
import { z } from 'zod';
import {
  bindContract,
  client,
  connect,
  createLiveModelReplica,
  createLiveModelHost,
  defineContract,
  defineLiveModelContract,
  loggerInstrumentation,
  loggingTransport,
  memoryTransportPair,
  procedure,
  serve,
  withLogging,
} from '../../src/index';

const keySchema = z.object({ id: z.string() });
const counterSchema = z.object({ count: z.number() });
const inputSchema = keySchema.extend({ token: z.string().optional() });

const api = defineContract({
  counter: defineLiveModelContract({ key: keySchema, models: { state: counterSchema } }),
  increment: procedure({ input: inputSchema, output: counterSchema }),
});

const key = { id: 'demo' };
const counters = createLiveModelHost(api.counter, { generation: 1000 });
const counter = counters.create(key, { state: { count: 0 } }).models.state;

const controller = bindContract(api, {
  counter: counters,
  increment: () => {
    counter.produce((draft) => {
      draft.count += 1;
    });
    return counter.snapshot().data;
  },
});

async function main(): Promise<void> {
  const logger = createConsoleLogger({ component: 'wire-example' });
  const instrumentation = loggerInstrumentation(logger, {
    payloads: true,
    maxPayloadLength: 240,
  });
  const loggedController = withLogging(controller, logger, {
    level: 'debug',
    payloads: true,
    maxPayloadLength: 240,
  });

  const pair = memoryTransportPair();
  const stopServer = serve(
    loggingTransport(pair.right, logger.child({ side: 'server-transport' }), {
      payloads: true,
      maxPayloadLength: 240,
    }),
    loggedController,
    { logger, instrumentation }
  );
  const connection = connect(
    loggingTransport(pair.left, logger.child({ side: 'client-transport' }), {
      payloads: true,
      maxPayloadLength: 240,
    }),
    { instrumentation }
  );
  const thin = client(api, connection);

  const observed: number[] = [];
  const replica = createLiveModelReplica(api.counter, thin.counter, {
    instrumentation,
    onChange: {
      state: (value, meta) => {
        const state = value as { count: number };
        observed.push(state.count);
        logger.info('counter changed', { count: state.count, change: meta.kind });
      },
    },
  });
  const lease = replica.acquire(key);
  await lease.ready();

  await thin.increment({ ...key, token: 'sk-test-secret-value-for-redaction' });

  counter.reseed({ count: 100 });
  await thin.increment({ ...key, token: 'sk-test-secret-value-for-redaction' });
  await delay(0);

  logger.info('observed counter values', { observed });
  await lease.release();
  await replica.dispose();
  stopServer();
}

function createConsoleLogger(bindings: LogFields = {}): Logger {
  const logger: Logger = {
    level: 'debug',
    debug: (message, fields) => write('debug', message, bindings, fields),
    info: (message, fields) => write('info', message, bindings, fields),
    warn: (message, fields) => write('warn', message, bindings, fields),
    error: (message, fields) => write('error', message, bindings, fields),
    child: (childBindings) => createConsoleLogger({ ...bindings, ...childBindings }),
  };
  return logger;
}

function write(
  level: LogLevel,
  message: string,
  bindings: LogFields,
  fields: LogFields | undefined
): void {
  console.log(`[${level}] ${message}`, { ...bindings, ...fields });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
