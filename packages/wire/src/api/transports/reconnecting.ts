import type { Unsubscribe } from '@emdash/shared';
import { retrySchedules, systemClock, type Clock, type RetrySchedule } from '../../scheduling';
import { createScope, type Scope } from '../../util';
import { createBoundedBuffer } from '../../util/bounded-buffer';
import type { WireMessage, WireTransport } from '../protocol';

export type ReconnectingTransportOptions = {
  backoffMs?: number[];
  clock?: Clock;
  retrySchedule?: RetrySchedule;
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
  const clock = options.clock ?? systemClock;
  const scope: Scope = createScope({ label: 'reconnecting-transport', clock });
  const messageListeners = new Set<(message: WireMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  const reconnectListeners = new Set<() => void>();
  const backoffMs = options.backoffMs ?? [100, 250, 500, 1000, 2000];
  const retrySchedule =
    options.retrySchedule ?? retrySchedules.sequence(backoffMs, { repeatLast: true });
  const maxQueuedMessages = Math.max(0, options.maxQueuedMessages ?? 1000);
  const queue = createBoundedBuffer<WireMessage>({
    capacity: maxQueuedMessages,
    overflow: 'drop-oldest',
  });
  let inner: WireTransport | null = null;
  let reconnecting = false;
  let closed = false;
  let hasConnected = false;
  let cleanupInner: Unsubscribe[] = [];
  let activeReconnect: symbol | undefined;

  void reconnect();

  async function reconnect(): Promise<void> {
    if (reconnecting || closed) return;
    reconnecting = true;
    const reconnectToken = Symbol('reconnect');
    activeReconnect = reconnectToken;
    let nextAttempt: Promise<WireTransport> | undefined = startConnectAttempt();
    nextAttempt.then(
      (next) => {
        if (closed) next.close?.();
      },
      () => {}
    );
    const run = scope.run('reconnect', async (signal) => {
      let attempt = 0;
      while (!closed && !signal.aborted) {
        try {
          const pending = nextAttempt ?? startConnectAttempt();
          nextAttempt = undefined;
          const next = await pending;
          if (closed || signal.aborted) {
            next.close?.();
            break;
          }
          setInner(next);
          const isReconnect = hasConnected;
          hasConnected = true;
          reconnecting = false;
          activeReconnect = undefined;
          flushQueue();
          if (isReconnect && inner === next && !closed) notifyReconnect();
          return;
        } catch (error) {
          if (closed || signal.aborted) break;
          const delay = retrySchedule.delayFor(attempt);
          if (delay === undefined) throw error;
          attempt += 1;
          await clock.sleep(delay, { signal, unref: true });
        }
      }
    });
    await run.exit;
    if (activeReconnect === reconnectToken) {
      reconnecting = false;
      activeReconnect = undefined;
    }
  }

  function startConnectAttempt(): Promise<WireTransport> {
    try {
      return Promise.resolve(connectOnce());
    } catch (error) {
      return Promise.reject(error);
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
    while (queue.size > 0) {
      const message = queue.take();
      if (!message) return;
      try {
        current.post(message);
      } catch {
        queue.requeueFront(message);
        inner = null;
        void reconnect();
        return;
      }
    }
  }

  function enqueue(message: WireMessage): void {
    if (isBlobChannelMessage(message)) return;
    queue.offer(message);
  }

  function notifyReconnect(): void {
    for (const listener of reconnectListeners) listener();
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
      void scope.dispose(new Error('Reconnecting transport closed'));
      for (const cleanup of cleanupInner.splice(0)) cleanup();
      inner?.close?.();
      inner = null;
      queue.clear();
      messageListeners.clear();
      disconnectListeners.clear();
      reconnectListeners.clear();
    },
  };
}

function isBlobChannelMessage(message: WireMessage): boolean {
  return message.kind.startsWith('blob-');
}
