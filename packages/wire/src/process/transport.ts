import { isWireMessage, type WireTransport } from '../api/protocol';
import type { ManagedProcess } from './types';

export function processTransport(process: ManagedProcess): WireTransport {
  return {
    post(message) {
      process.send(message);
    },
    onMessage(cb) {
      return process.onMessage((message) => {
        if (isWireMessage(message)) cb(message);
      });
    },
    onDisconnect(cb) {
      return process.onExit(() => cb());
    },
  };
}
