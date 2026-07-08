import type { LogFields, LogLevel, Logger } from '@emdash/shared/logger';
import { describe, expect, it } from 'vitest';
import type { Controller } from '../api/bind';
import { loggingTransport, memoryTransportPair } from '../api/transports';
import { loggerInstrumentation } from './logger-instrumentation';
import { withLogging } from './with-logging';

type LogCall = {
  level: LogLevel;
  message: string;
  fields?: LogFields;
};

function createStubLogger(
  bindings: LogFields = {},
  calls: LogCall[] = []
): {
  logger: Logger;
  calls: LogCall[];
} {
  const logger: Logger = {
    level: 'debug',
    debug: (message, fields) => calls.push({ level: 'debug', message, fields: merge(fields) }),
    info: (message, fields) => calls.push({ level: 'info', message, fields: merge(fields) }),
    warn: (message, fields) => calls.push({ level: 'warn', message, fields: merge(fields) }),
    error: (message, fields) => calls.push({ level: 'error', message, fields: merge(fields) }),
    child: (childBindings) => createStubLogger({ ...bindings, ...childBindings }, calls).logger,
  };

  function merge(fields: LogFields | undefined): LogFields | undefined {
    const merged = { ...bindings, ...fields };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  return { logger, calls };
}

describe('loggerInstrumentation', () => {
  it('logs call lifecycle events with redacted payloads', () => {
    const { logger, calls } = createStubLogger();
    const instrumentation = loggerInstrumentation(logger, { payloads: true });

    instrumentation.callStart?.({
      callId: 'c1',
      path: 'secret.echo',
      input: { token: 'sk-abcdefghijklmnopqrstuvwxyz' },
    });
    instrumentation.callEnd?.({
      callId: 'c1',
      path: 'secret.echo',
      durationMs: 1,
      ok: true,
      result: { ok: true },
    });

    expect(calls.map((call) => call.message)).toEqual(['wire call started', 'wire call completed']);
    expect(String(calls[0].fields?.payload)).toContain('[REDACTED]');
  });
});

describe('withLogging', () => {
  it('wraps controller calls with request and response logs', async () => {
    const { logger, calls } = createStubLogger();
    const controller: Controller = {
      call: async (_path, input) => input,
      resolveLive: () => null,
      liveRefIds: () => [],
    };
    const logged = withLogging(controller, logger, { level: 'debug', payloads: true });

    await logged.call('echo', { token: 'sk-abcdefghijklmnopqrstuvwxyz' });

    expect(calls.map((call) => call.message)).toEqual([
      'wire api request started',
      'wire api request completed',
    ]);
    expect(String(calls[0].fields?.payload)).toContain('[REDACTED]');
    expect(String(calls[1].fields?.payload)).toContain('[REDACTED]');
  });
});

describe('loggingTransport', () => {
  it('logs sent and received protocol messages', async () => {
    const { logger, calls } = createStubLogger();
    const pair = memoryTransportPair();
    const left = loggingTransport(pair.left, logger);
    const right = loggingTransport(pair.right, logger);
    const received = new Promise<void>((resolve) => {
      right.onMessage(() => resolve());
    });

    left.post({ kind: 'cancel', id: 'call-1' });
    await received;

    expect(calls.map((call) => call.message)).toEqual([
      'wire protocol send',
      'wire protocol receive',
    ]);
    expect(calls[0].fields).toMatchObject({ kind: 'cancel', id: 'call-1' });
  });
});
