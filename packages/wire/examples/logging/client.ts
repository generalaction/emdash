import type { LogFields, LogLevel, Logger } from '@emdash/shared/logger';
import { z } from 'zod';
import {
  LiveModelServer,
  bindContract,
  connect,
  contractClient,
  defineContract,
  fromRegistry,
  liveModel,
  loggerInstrumentation,
  loggingTransport,
  memoryTransportPair,
  procedure,
  serve,
  withLogging,
} from '../../src/index';
import { LiveModelRegistry } from '../../src/live';

const keySchema = z.object({ id: z.string() });
const counterSchema = z.object({ count: z.number() });
const inputSchema = keySchema.extend({ token: z.string().optional() });

const api = defineContract({
  counter: liveModel({ key: keySchema, data: counterSchema }),
  increment: procedure({ input: inputSchema, output: counterSchema }),
});

const key = { id: 'demo' };
const registry = new LiveModelRegistry();
const counter = new LiveModelServer({ count: 0 }, 1000);
registry.register(api.counter, key, counter);

const controller = bindContract(api, {
  registry,
  impl: {
    counter: fromRegistry(),
    increment: () => {
      counter.produce((draft) => {
        draft.count += 1;
      });
      return counter.snapshot().data;
    },
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
  const client = contractClient(api, connection, { instrumentation });

  const observed: number[] = [];
  const binding = client.counter(key, (value, meta) => {
    observed.push(value.count);
    logger.info('counter changed', { count: value.count, change: meta.kind });
  });
  await binding.ready;

  await client.increment({ ...key, token: 'sk-test-secret-value-for-redaction' });

  counter.reseed({ count: 100 });
  await client.increment({ ...key, token: 'sk-test-secret-value-for-redaction' });
  await delay(0);

  logger.info('observed counter values', { observed });
  await binding.dispose();
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
