import type { Unsubscribe } from '@emdash/shared';
import type { WireMessage, WireTransport } from '../protocol';

export type ReconnectingTransportOptions = {
  backoffMs?: number[];
  maxQueuedMessages?: number;
};

export type ReconnectingTransport = WireTransport & {
  onReconnect(cb: () => void): Unsubscribe;
  close(): void;
};

export function reconnectingTransport(
  connectOnce: () => Promise<WireTransport>,
  options: ReconnectingTransportOptions = {}
): ReconnectingTransport {
  const messageListeners = new Set<(message: WireMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  const reconnectListeners = new Set<() => void>();
  const queue: WireMessage[] = [];
  const backoffMs = options.backoffMs ?? [100, 250, 500, 1000, 2000];
  const maxQueuedMessages = Math.max(0, options.maxQueuedMessages ?? 1000);
  let inner: WireTransport | null = null;
  let reconnecting = false;
  let closed = false;
  let hasConnected = false;
  let cleanupInner: Unsubscribe[] = [];
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveReconnectDelay: (() => void) | undefined;

  void reconnect();

  async function reconnect(): Promise<void> {
    if (reconnecting || closed) return;
    reconnecting = true;
    let attempt = 0;
    while (!closed) {
      try {
        const next = await connectOnce();
        if (closed) {
          next.close?.();
          break;
        }
        setInner(next);
        const isReconnect = hasConnected;
        hasConnected = true;
        reconnecting = false;
        flushQueue();
        if (isReconnect) notifyReconnect();
        return;
      } catch {
        if (closed) break;
        const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 1000;
        attempt += 1;
        await wait(delay);
      }
    }
    reconnecting = false;
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
        if (inner !== next) return;
        inner = null;
        for (const listener of disconnectListeners) listener();
        if (!closed) void reconnect();
      })
    );
  }

  function flushQueue(): void {
    const current = inner;
    if (!current) return;
    while (queue.length > 0) {
      const message = queue.shift();
      if (!message) return;
      try {
        current.post(message);
      } catch {
        queue.unshift(message);
        inner = null;
        void reconnect();
        return;
      }
    }
  }

  function enqueue(message: WireMessage): void {
    if (isBlobChannelMessage(message)) return;
    if (queue.length >= maxQueuedMessages) {
      throw new Error(`Wire reconnect queue is full (limit ${maxQueuedMessages})`);
    }
    queue.push(message);
  }

  function notifyReconnect(): void {
    for (const listener of reconnectListeners) listener();
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      resolveReconnectDelay = resolve;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        resolveReconnectDelay = undefined;
        resolve();
      }, ms);
    });
  }

  return {
    post(message) {
      if (closed) throw new Error('Wire transport closed');
      const current = inner;
      if (!current) {
        enqueue(message);
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
    onReconnect(cb): Unsubscribe {
      reconnectListeners.add(cb);
      return () => reconnectListeners.delete(cb);
    },
    close() {
      if (closed) return;
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      resolveReconnectDelay?.();
      resolveReconnectDelay = undefined;
      for (const cleanup of cleanupInner.splice(0)) cleanup();
      inner?.close?.();
      inner = null;
      queue.length = 0;
      messageListeners.clear();
      disconnectListeners.clear();
      reconnectListeners.clear();
    },
  };
}

function isBlobChannelMessage(message: WireMessage): boolean {
  return message.kind.startsWith('blob-');
}
