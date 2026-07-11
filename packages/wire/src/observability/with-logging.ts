import type { LogFields, Logger, LogLevel } from '@emdash/shared/logger';
import type { Controller } from '../api/controller';
import { serializeWireError } from '../api/protocol';
import type { Middleware } from '../util';
import { summarizePayload, type PayloadSummaryOptions } from './payload';

export type WithLoggingOptions = PayloadSummaryOptions & {
  level?: Extract<LogLevel, 'info' | 'debug'>;
  payloads?: boolean;
};

export function withLogging(
  controller: Controller,
  logger: Logger,
  options: WithLoggingOptions = {}
): Controller {
  const level = options.level ?? 'info';

  return {
    async call(path, input, meta) {
      const start = performanceNow();
      logAt(logger, level, 'wire api request started', withPayload(options, input, { path }));
      try {
        const result = await controller.call(path, input, meta);
        logAt(
          logger,
          level,
          'wire api request completed',
          withPayload(options, result, {
            path,
            durationMs: performanceNow() - start,
          })
        );
        return result;
      } catch (error) {
        const serialized = serializeWireError(error);
        logger.warn(
          'wire api request failed',
          withPayload(options, undefined, {
            path,
            durationMs: performanceNow() - start,
            errorCode: serialized.code,
            errorMessage: serialized.message,
            errorCause: serialized.cause,
            error,
          })
        );
        throw error;
      }
    },
    resolveLive(topic) {
      return controller.resolveLive(topic);
    },
    acquireLive(topic) {
      return controller.acquireLive(topic);
    },
    async dispose() {
      logger.debug('wire api controller disposing');
      await controller.dispose?.();
    },
  };
}

export function logging(logger: Logger, options: WithLoggingOptions = {}): Middleware<Controller> {
  return (controller) => withLogging(controller, logger, options);
}

function logAt(
  logger: Logger,
  level: Extract<LogLevel, 'info' | 'debug'>,
  message: string,
  fields: LogFields
) {
  if (level === 'debug') {
    logger.debug(message, fields);
  } else {
    logger.info(message, fields);
  }
}

function withPayload(options: WithLoggingOptions, payload: unknown, fields: LogFields): LogFields {
  if (!options.payloads) return fields;
  return { ...fields, payload: summarizePayload(payload, options) };
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
