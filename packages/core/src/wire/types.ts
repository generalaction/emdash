import type { Unsubscribe } from '@emdash/shared';
import type { LiveSnapshot, LiveSource, LiveUpdate } from '../live/protocol';

export type { LiveSnapshot, LiveSource, LiveUpdate, Unsubscribe };

export type ProcedureMap = Record<string, (input: never) => unknown>;

export type ProcedureTarget = {
  call(path: string, input: unknown): Promise<unknown>;
};

export type LiveTarget = {
  snapshot(topic: string): Promise<LiveSnapshot<unknown>>;
  attach(topic: string, push: (update: LiveUpdate) => void): Promise<Unsubscribe>;
};

export type Wire = {
  procedures: ProcedureTarget;
  live: LiveTarget;
  onDisconnect(cb: () => void): Unsubscribe;
};

export type WireTransport = {
  post(message: unknown): void;
  onMessage(cb: (message: unknown) => void): Unsubscribe;
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
