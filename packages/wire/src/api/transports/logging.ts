import type { Logger } from '@emdash/shared/logger';
import { summarizePayload, type PayloadSummaryOptions } from '../../observability';
import type { WireMessage, WireTransport } from '../protocol';

export type LoggingTransportOptions = PayloadSummaryOptions & {
  payloads?: boolean;
};

export function loggingTransport(
  transport: WireTransport,
  logger: Logger,
  options: LoggingTransportOptions = {}
): WireTransport {
  const wrapped: WireTransport = {
    post(message) {
      logger.debug('wire protocol send', describeMessage(message, options));
      transport.post(message);
    },
    onMessage(cb) {
      return transport.onMessage((message) => {
        logger.debug('wire protocol receive', describeMessage(message, options));
        cb(message);
      });
    },
    onDisconnect(cb) {
      return transport.onDisconnect(() => {
        logger.debug('wire protocol disconnected');
        cb();
      });
    },
    close() {
      logger.debug('wire protocol closing');
      transport.close?.();
    },
  };
  // Only mirror the optional capabilities the inner transport actually has;
  // connections sniff `onReconnect` to decide hold-until-deadline behavior.
  const innerOnReconnect = transport.onReconnect?.bind(transport);
  if (innerOnReconnect) {
    wrapped.onReconnect = (cb) =>
      innerOnReconnect(() => {
        logger.debug('wire protocol reconnected');
        cb();
      });
  }
  const innerOnTerminalFailure = transport.onTerminalFailure?.bind(transport);
  if (innerOnTerminalFailure) {
    wrapped.onTerminalFailure = (cb) =>
      innerOnTerminalFailure((error) => {
        logger.debug('wire protocol failed permanently');
        cb(error);
      });
  }
  return wrapped;
}

function describeMessage(
  message: WireMessage,
  options: LoggingTransportOptions
): Record<string, unknown> {
  const fields: Record<string, unknown> = { kind: message.kind };
  switch (message.kind) {
    case 'call':
      fields.id = message.id;
      fields.path = message.path;
      if (options.payloads) fields.payload = summarizePayload(message.input, options);
      break;
    case 'snapshot':
    case 'attach':
      fields.id = message.id;
      fields.topic = message.topic;
      break;
    case 'detach':
      fields.topic = message.topic;
      break;
    case 'cancel':
      fields.id = message.id;
      break;
    case 'result':
      fields.id = message.id;
      fields.ok = message.ok;
      if (message.ok) {
        if (options.payloads) fields.payload = summarizePayload(message.value, options);
      } else {
        fields.errorCode = message.code;
        fields.errorMessage = message.message;
      }
      break;
    case 'update':
      fields.topic = message.topic;
      fields.generation = message.update.generation;
      fields.sequence = message.update.sequence;
      fields.baseSequence = message.update.baseSequence;
      if (options.payloads) fields.payload = summarizePayload(message.update, options);
      break;
  }
  return fields;
}
