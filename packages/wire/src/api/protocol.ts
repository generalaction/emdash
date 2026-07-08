import { toSerializedError, type SerializedError, type Unsubscribe } from '@emdash/shared';
import type { LiveUpdate } from '../live/protocol';

export type WireErrorCode =
  | 'CANCELLED'
  | 'DISCONNECTED'
  | 'UNKNOWN_PROCEDURE'
  | 'UNKNOWN_TOPIC'
  | 'NOT_FOUND'
  | 'MISSING_HANDLER'
  | 'CONTRACT_MISMATCH'
  | 'ALREADY_EXISTS'
  | 'HANDLER_ERROR';

export type WireCallMessage = {
  kind: 'call';
  id: string;
  path: string;
  input: unknown;
};

export type WireSnapshotMessage = {
  kind: 'snapshot';
  id: string;
  topic: string;
};

export type WireAttachMessage = {
  kind: 'attach';
  id: string;
  topic: string;
};

export type WireDetachMessage = {
  kind: 'detach';
  topic: string;
};

export type WireCancelMessage = {
  kind: 'cancel';
  id: string;
};

export type WireResultMessage =
  | {
      kind: 'result';
      id: string;
      ok: true;
      value: unknown;
    }
  | {
      kind: 'result';
      id: string;
      ok: false;
      code: WireErrorCode;
      message: string;
      cause?: SerializedError;
    };

export type WireUpdateMessage = {
  kind: 'update';
  topic: string;
  update: LiveUpdate;
};

export type WireMessage =
  | WireCallMessage
  | WireSnapshotMessage
  | WireAttachMessage
  | WireDetachMessage
  | WireCancelMessage
  | WireResultMessage
  | WireUpdateMessage;

export type WireTransport = {
  post(message: WireMessage): void;
  onMessage(cb: (message: WireMessage) => void): Unsubscribe;
  onDisconnect(cb: () => void): Unsubscribe;
  onReconnect?(cb: () => void): Unsubscribe;
  close?(): void;
};

export class WireError extends Error {
  constructor(
    readonly code: WireErrorCode,
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, options);
    this.name = 'WireError';
  }
}

export type SerializedWireError = {
  code: WireErrorCode;
  message: string;
  cause?: SerializedError;
};

export function serializeWireError(error: unknown): SerializedWireError {
  if (error instanceof WireError) {
    return {
      code: error.code,
      message: error.message,
      cause: serializeCause(error.cause),
    };
  }
  if (error instanceof Error) {
    return { code: 'HANDLER_ERROR', message: error.message, cause: toSerializedError(error) };
  }
  return { code: 'HANDLER_ERROR', message: String(error), cause: toSerializedError(error) };
}

export function isWireError(error: unknown, code?: WireErrorCode): error is WireError {
  return error instanceof WireError && (code === undefined || error.code === code);
}

export function isWireMessage(value: unknown): value is WireMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  switch (message.kind) {
    case 'call':
      return typeof message.id === 'string' && typeof message.path === 'string';
    case 'snapshot':
    case 'attach':
      return typeof message.id === 'string' && typeof message.topic === 'string';
    case 'detach':
      return typeof message.topic === 'string';
    case 'cancel':
      return typeof message.id === 'string';
    case 'result':
      if (typeof message.id !== 'string') return false;
      if (message.ok === true) return true;
      return (
        message.ok === false &&
        typeof message.code === 'string' &&
        typeof message.message === 'string'
      );
    case 'update':
      return typeof message.topic === 'string' && typeof message.update === 'object';
    default:
      return false;
  }
}

function serializeCause(cause: unknown): SerializedError | undefined {
  if (cause === undefined) return undefined;
  if (isSerializedError(cause)) return cause;
  return toSerializedError(cause);
}

function isSerializedError(value: unknown): value is SerializedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}
