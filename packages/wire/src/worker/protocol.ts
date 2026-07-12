import { isWireMessage, type WireTransport } from '../api/protocol';
import type { WorkerParentPort } from './types';

const WORKER_SIGNAL_KIND = 'wire-runtime-signal';

export type WorkerSignal = {
  kind: typeof WORKER_SIGNAL_KIND;
  event: 'ready' | 'shutdown';
};

export const WORKER_READY_SIGNAL: WorkerSignal = {
  kind: WORKER_SIGNAL_KIND,
  event: 'ready',
};

export const WORKER_SHUTDOWN_SIGNAL: WorkerSignal = {
  kind: WORKER_SIGNAL_KIND,
  event: 'shutdown',
};

export const RUNTIME_SHUTDOWN_SIGNAL = WORKER_SHUTDOWN_SIGNAL;

export function isWorkerSignal(
  message: unknown,
  event?: WorkerSignal['event']
): message is WorkerSignal {
  if (typeof message !== 'object' || message === null) return false;
  const record = message as Record<string, unknown>;
  if (record.kind !== WORKER_SIGNAL_KIND) return false;
  return event === undefined || record.event === event;
}

export function parentPortTransport(
  port: WorkerParentPort,
  options: Pick<WireTransport, 'onReconnect'> = {}
): WireTransport {
  return {
    post(message) {
      port.send(message);
    },
    onMessage(cb) {
      return port.onMessage((message) => {
        if (isWireMessage(message)) cb(message);
      });
    },
    onDisconnect(cb) {
      return port.onDisconnect(cb);
    },
    onReconnect: options.onReconnect,
  };
}
