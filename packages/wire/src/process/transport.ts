import { isWireMessage, type WireTransport } from '../api/protocol';
import type { ManagedProcess } from './types';

export function processTransport(process: ManagedProcess): WireTransport {
  const cleanups = new Set<() => void>();
  return {
    post(message) {
      process.send(message);
    },
    onMessage(cb) {
      const cleanup = process.onMessage((message) => {
        if (isWireMessage(message)) cb(message);
      });
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
        cleanup();
      };
    },
    onDisconnect(cb) {
      const cleanup = process.onExit(() => cb());
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
        cleanup();
      };
    },
    close() {
      for (const cleanup of [...cleanups]) cleanup();
      cleanups.clear();
    },
  };
}
