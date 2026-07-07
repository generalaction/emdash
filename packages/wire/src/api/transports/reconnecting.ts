import type { Unsubscribe } from '@emdash/shared';
import type { WireMessage, WireTransport } from '../protocol';

export type ReconnectingTransportOptions = {
  backoffMs?: number[];
};

export function reconnectingTransport(
  connectOnce: () => Promise<WireTransport>,
  options: ReconnectingTransportOptions = {}
): WireTransport {
  const messageListeners = new Set<(message: WireMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  const queue: WireMessage[] = [];
  const backoffMs = options.backoffMs ?? [100, 250, 500, 1000, 2000];
  let inner: WireTransport | null = null;
  let reconnecting = false;
  let cleanupInner: Unsubscribe[] = [];

  void reconnect();

  async function reconnect(): Promise<void> {
    if (reconnecting) return;
    reconnecting = true;
    let attempt = 0;
    while (true) {
      try {
        const next = await connectOnce();
        setInner(next);
        reconnecting = false;
        flushQueue();
        return;
      } catch {
        const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 1000;
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  function setInner(next: WireTransport): void {
    for (const cleanup of cleanupInner) cleanup();
    cleanupInner = [];
    inner = next;
    cleanupInner.push(
      next.onMessage((message) => {
        for (const listener of messageListeners) listener(message);
      })
    );
    cleanupInner.push(
      next.onDisconnect(() => {
        inner = null;
        for (const listener of disconnectListeners) listener();
        void reconnect();
      })
    );
  }

  function flushQueue(): void {
    const current = inner;
    if (!current) return;
    while (queue.length > 0) {
      const message = queue.shift();
      if (!message) return;
      current.post(message);
    }
  }

  return {
    post(message) {
      const current = inner;
      if (!current) {
        queue.push(message);
        void reconnect();
        return;
      }
      current.post(message);
    },
    onMessage(cb): Unsubscribe {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onDisconnect(cb): Unsubscribe {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
  };
}
