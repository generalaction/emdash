import type { Unsubscribe } from '@emdash/shared';
import type { LiveUpdate } from '../live/protocol';

export const PROTOCOL_VERSION = 1;
export const WIRE_CANCELLED_CODE = 'CANCELLED';

export type WireHelloMessage = {
  kind: 'hello';
  protocol: number;
};

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
      code: string;
      message: string;
    };

export type WireUpdateMessage = {
  kind: 'update';
  topic: string;
  update: LiveUpdate;
};

export type WireMessage =
  | WireHelloMessage
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
};

export class WireError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'WireError';
  }
}

export type SerializedWireError = {
  code: string;
  message: string;
};

export function serializeWireError(error: unknown): SerializedWireError {
  if (error instanceof WireError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'ERROR', message: error.message };
  }
  return { code: 'ERROR', message: String(error) };
}

export function isWireMessage(value: unknown): value is WireMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  switch (message.kind) {
    case 'hello':
      return typeof message.protocol === 'number';
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
      return typeof message.id === 'string' && typeof message.ok === 'boolean';
    case 'update':
      return typeof message.topic === 'string' && typeof message.update === 'object';
    default:
      return false;
  }
}
