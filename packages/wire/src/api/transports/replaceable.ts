import type { Unsubscribe } from '@emdash/shared';
import { WireError, type WireMessage, type WireTransport } from '../protocol';

export type ReplaceableTransport = WireTransport & {
  readonly connected: boolean;
  readonly generation: number;
  readonly current: WireTransport | undefined;
  install(transport: WireTransport): void;
  detach(): void;
  onReconnect(listener: () => void): Unsubscribe;
  close(): void;
};

/** Stable transport identity; its owner alone decides when and how to reconnect. */
export function replaceableTransport(): ReplaceableTransport {
  let current: WireTransport | undefined;
  let generation = 0;
  let closed = false;
  let cleanups: Unsubscribe[] = [];
  const messages = new Set<(message: WireMessage) => void>();
  const disconnects = new Set<() => void>();
  const reconnects = new Set<() => void>();
  const terminal = new Set<(error: unknown) => void>();

  function detach(): void {
    const previous = current;
    current = undefined;
    generation += 1;
    for (const cleanup of cleanups.splice(0)) cleanup();
    if (!previous) return;
    // Revoke the old generation before its close callbacks can run.
    previous.close?.();
    for (const listener of disconnects) listener();
  }

  return {
    get connected() {
      return current !== undefined;
    },
    get generation() {
      return generation;
    },
    get current() {
      return current;
    },
    install(next) {
      detach();
      if (closed) {
        next.close?.();
        throw new WireError('DISCONNECTED', 'Replaceable transport closed');
      }
      current = next;
      const installedGeneration = ++generation;
      const isCurrent = () => current === next && generation === installedGeneration;
      cleanups = [
        next.onMessage((message) => {
          if (isCurrent()) for (const listener of messages) listener(message);
        }),
        next.onDisconnect(() => {
          if (isCurrent()) detach();
        }),
      ];
      for (const listener of reconnects) {
        if (!isCurrent()) break;
        listener();
      }
    },
    detach,
    post(message) {
      const target = current;
      if (!target) throw new WireError('DISCONNECTED', 'Host transport is unavailable');
      try {
        target.post(message);
      } catch (error) {
        if (current === target) detach();
        throw error;
      }
    },
    onMessage(listener) {
      messages.add(listener);
      return () => {
        messages.delete(listener);
      };
    },
    onDisconnect(listener) {
      disconnects.add(listener);
      return () => {
        disconnects.delete(listener);
      };
    },
    onReconnect(listener) {
      reconnects.add(listener);
      return () => {
        reconnects.delete(listener);
      };
    },
    onTerminalFailure(listener) {
      if (closed) listener(new WireError('DISCONNECTED', 'Replaceable transport closed'));
      else terminal.add(listener);
      return () => {
        terminal.delete(listener);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      detach();
      const error = new WireError('DISCONNECTED', 'Replaceable transport closed');
      for (const listener of terminal) listener(error);
      messages.clear();
      disconnects.clear();
      reconnects.clear();
      terminal.clear();
    },
  };
}
