import { nodeWebSocketTransport, serve, type NodeWebSocketLike } from '@emdash/wire';
import type {
  AuthenticatedMobileAccessConnection,
  MobileAccessMessage,
} from '@main/core/mobile-access/mobile-access-service';
import { log } from '@main/lib/logger';
import { createMobileDomainSession } from './controller';

const OPEN = 1;
const CLOSED = 3;
const RECONNECT_LEASE_GRACE_MS = 15_000;

/**
 * Attach the authenticated gateway socket to a connection-scoped Mobile Access domain.
 * Authentication, origin checks, and connection limits have already run in the gateway.
 */
export function attachMobileDomainConnection(
  connection: AuthenticatedMobileAccessConnection
): void {
  const domain = createMobileDomainSession(connection.id, connection.clientId);
  const socket = connectionSocket(connection);
  const transport = nodeWebSocketTransport(socket);
  const stopServing = serve(transport, domain.controller);
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    stopServing();
    // Keep runtime leases briefly across Wi-Fi changes. The replacement
    // authenticated socket acquires its own leases before these are released,
    // preventing a transient disconnect from detaching an active agent.
    const timer = setTimeout(() => {
      void domain.dispose().catch((error: unknown) => {
        log.warn('Failed to release a mobile domain session', { error });
      });
    }, RECONNECT_LEASE_GRACE_MS);
    timer.unref();
  };

  connection.onClose(dispose);
}

function connectionSocket(connection: AuthenticatedMobileAccessConnection): NodeWebSocketLike {
  type Listener = (...args: unknown[]) => void;
  const subscriptions = new Map<Listener, () => void>();
  let closed = false;

  connection.onClose(() => {
    closed = true;
  });

  const socket: NodeWebSocketLike = {
    get readyState() {
      return closed ? CLOSED : OPEN;
    },
    send(data) {
      if (!connection.send(data)) throw new Error('Mobile WebSocket is not open');
    },
    close(code, reason) {
      connection.close(code, reason);
    },
    on(event, listener) {
      let unsubscribe = (): void => undefined;
      if (event === 'message') {
        unsubscribe = connection.onMessage((message: MobileAccessMessage) => {
          listener(message.data, message.binary);
        });
      } else if (event === 'close' || event === 'error') {
        unsubscribe = connection.onClose(() => listener());
      } else if (event === 'open') {
        queueMicrotask(() => {
          if (!closed) listener();
        });
      }
      subscriptions.set(listener, unsubscribe);
      return socket;
    },
    off(_event, listener) {
      subscriptions.get(listener)?.();
      subscriptions.delete(listener);
      return socket;
    },
    removeListener(_event, listener) {
      subscriptions.get(listener)?.();
      subscriptions.delete(listener);
      return socket;
    },
  };
  return socket;
}
