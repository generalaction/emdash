import type { LiveUpdate } from '../live/protocol';
import type { SerializedWireError } from './types';

export type WireCallMessage = {
  kind: 'wire-call';
  id: string;
  path: string;
  input: unknown;
};

export type WireSnapshotMessage = {
  kind: 'wire-snapshot';
  id: string;
  topic: string;
};

export type WireResultMessage =
  | {
      kind: 'wire-result';
      id: string;
      ok: true;
      value: unknown;
    }
  | ({
      kind: 'wire-result';
      id: string;
      ok: false;
    } & SerializedWireError);

export type WireAttachMessage = {
  kind: 'wire-attach';
  topic: string;
};

export type WireDetachMessage = {
  kind: 'wire-detach';
  topic: string;
};

export type WireUpdateMessage = {
  kind: 'wire-update';
  topic: string;
  update: LiveUpdate;
};

export type WireMessage =
  | WireCallMessage
  | WireSnapshotMessage
  | WireResultMessage
  | WireAttachMessage
  | WireDetachMessage
  | WireUpdateMessage;

export type PortLikeMessageEvent = {
  data: unknown;
};

export type PortLike = {
  postMessage(message: unknown): void;
  on(event: 'message', cb: (event: PortLikeMessageEvent) => void): void;
};

export function isWireMessage(value: unknown): value is WireMessage {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  switch (kind) {
    case 'wire-call':
      return (
        typeof (value as { id?: unknown }).id === 'string' &&
        typeof (value as { path?: unknown }).path === 'string'
      );
    case 'wire-snapshot':
      return (
        typeof (value as { id?: unknown }).id === 'string' &&
        typeof (value as { topic?: unknown }).topic === 'string'
      );
    case 'wire-result':
      return (
        typeof (value as { id?: unknown }).id === 'string' &&
        typeof (value as { ok?: unknown }).ok === 'boolean'
      );
    case 'wire-attach':
    case 'wire-detach':
      return typeof (value as { topic?: unknown }).topic === 'string';
    case 'wire-update':
      return typeof (value as { topic?: unknown }).topic === 'string';
    default:
      return false;
  }
}
