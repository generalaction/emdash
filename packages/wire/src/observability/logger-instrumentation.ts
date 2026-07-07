import type { LogFields, Logger } from '@emdash/shared/logger';
import type { WireInstrumentation } from './instrumentation';
import { summarizePayload, type PayloadSummaryOptions } from './payload';

export type LoggerInstrumentationOptions = PayloadSummaryOptions & {
  payloads?: boolean;
};

export function loggerInstrumentation(
  logger: Logger,
  options: LoggerInstrumentationOptions = {}
): WireInstrumentation {
  return {
    callStart(event) {
      logger.debug(
        'wire call started',
        withPayload(options, event.input, {
          callId: event.callId,
          path: event.path,
          side: event.side,
        })
      );
    },
    callEnd(event) {
      const fields = withPayload(options, event.result, {
        callId: event.callId,
        path: event.path,
        side: event.side,
        durationMs: event.durationMs,
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
      });
      if (event.ok) {
        logger.debug('wire call completed', fields);
      } else {
        logger.warn('wire call failed', fields);
      }
    },
    snapshot(event) {
      const fields: LogFields = {
        requestId: event.requestId,
        topic: event.topic,
        durationMs: event.durationMs,
        errorCode: event.errorCode,
      };
      if (event.ok) {
        logger.debug('wire snapshot completed', fields);
      } else {
        logger.warn('wire snapshot failed', fields);
      }
    },
    topicAttach(event) {
      logger.debug('wire topic attached', {
        topic: event.topic,
        attachmentCount: event.attachmentCount,
      });
    },
    topicDetach(event) {
      logger.debug('wire topic detached', {
        topic: event.topic,
        attachmentCount: event.attachmentCount,
      });
    },
    cancel(event) {
      logger.debug('wire call cancelled', { callId: event.callId, side: event.side });
    },
    resync(event) {
      logger.warn('wire live source resyncing', {
        topic: event.topic,
        reason: event.reason,
        ...event.details,
      });
    },
    mutationDeduped(event) {
      logger.debug('wire mutation deduped', {
        mutationId: event.mutationId,
        path: event.path,
      });
    },
    batchDropped(event) {
      logger.warn('wire live model batch dropped', { error: event.error });
    },
    scopeCleanupError(event) {
      logger.warn('wire scope cleanup failed', { label: event.label, error: event.error });
    },
    transport(event) {
      logger.debug('wire transport event', { event: event.event });
    },
  };
}

function withPayload(
  options: LoggerInstrumentationOptions,
  payload: unknown,
  fields: LogFields
): LogFields {
  if (!options.payloads) return fields;
  return {
    ...fields,
    payload: summarizePayload(payload, options),
  };
}
