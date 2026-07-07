import type { Unsubscribe } from '@emdash/shared';
import type { LiveSnapshot, LiveUpdate } from '../live/protocol';
import {
  PROTOCOL_VERSION,
  WireError,
  WIRE_CANCELLED_CODE,
  type WireMessage,
  type WireTransport,
} from './protocol';

export type CallOptions = {
  signal?: AbortSignal;
};

type PendingCall = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
};

export type Connection = {
  call(path: string, input: unknown, options?: CallOptions): Promise<unknown>;
  snapshot(topic: string): Promise<LiveSnapshot<unknown>>;
  attach(topic: string, push: (update: LiveUpdate) => void): Promise<Unsubscribe>;
  onDisconnect(cb: () => void): Unsubscribe;
  hello(): Promise<void>;
};

export function connect(transport: WireTransport): Connection {
  const pending = new Map<string, PendingCall>();
  const attachments = new Map<string, Set<(update: LiveUpdate) => void>>();
  const disconnectListeners = new Set<() => void>();

  transport.onMessage((message) => {
    if (message.kind === 'result') {
      const pendingCall = pending.get(message.id);
      if (!pendingCall) return;
      pending.delete(message.id);
      pendingCall.cleanup();
      if (message.ok) {
        pendingCall.resolve(message.value);
      } else {
        pendingCall.reject(new WireError(message.code, message.message));
      }
      return;
    }

    if (message.kind === 'update') {
      for (const push of attachments.get(message.topic) ?? []) push(message.update);
    }
  });

  transport.onDisconnect(() => {
    for (const pendingCall of pending.values()) {
      pendingCall.cleanup();
      pendingCall.reject(new WireError('DISCONNECTED', 'Wire transport disconnected'));
    }
    pending.clear();

    for (const listener of disconnectListeners) listener();
    for (const topic of attachments.keys()) {
      request({ kind: 'attach', id: createRequestId(), topic }).catch(() => {});
    }
  });

  function request(
    message: WireMessage & { id: string },
    options: CallOptions = {}
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new WireError(WIRE_CANCELLED_CODE, 'Wire call cancelled'));
        return;
      }

      const onAbort = (): void => {
        const pendingCall = pending.get(message.id);
        if (!pendingCall) return;
        pending.delete(message.id);
        pendingCall.cleanup();
        try {
          transport.post({ kind: 'cancel', id: message.id });
        } catch {
          // The peer may already be gone; the local call is still cancelled.
        }
        reject(new WireError(WIRE_CANCELLED_CODE, 'Wire call cancelled'));
      };
      const cleanup = (): void => options.signal?.removeEventListener('abort', onAbort);
      options.signal?.addEventListener('abort', onAbort, { once: true });

      pending.set(message.id, { resolve, reject, cleanup });
      try {
        transport.post(message);
      } catch (error) {
        pending.delete(message.id);
        cleanup();
        reject(
          new WireError(
            'DISCONNECTED',
            error instanceof Error ? error.message : 'Wire transport disconnected'
          )
        );
      }
    });
  }

  return {
    call(path, input, options) {
      return request({ kind: 'call', id: createRequestId(), path, input }, options);
    },
    snapshot(topic) {
      return request({ kind: 'snapshot', id: createRequestId(), topic }) as Promise<
        LiveSnapshot<unknown>
      >;
    },
    async attach(topic, push) {
      let pushes = attachments.get(topic);
      if (!pushes) {
        pushes = new Set();
        attachments.set(topic, pushes);
        await request({ kind: 'attach', id: createRequestId(), topic });
      }
      pushes.add(push);

      return () => {
        const current = attachments.get(topic);
        current?.delete(push);
        if ((current?.size ?? 0) > 0) return;
        attachments.delete(topic);
        transport.post({ kind: 'detach', topic });
      };
    },
    onDisconnect(cb): Unsubscribe {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
    hello() {
      return new Promise((resolve, reject) => {
        let resolved = false;
        const unsubscribe = transport.onMessage((message) => {
          if (message.kind !== 'hello') return;
          if (message.protocol !== PROTOCOL_VERSION) {
            unsubscribe();
            reject(
              new WireError(
                'PROTOCOL_VERSION_MISMATCH',
                `Expected protocol ${PROTOCOL_VERSION}, got ${message.protocol}`
              )
            );
            return;
          }
          resolved = true;
          unsubscribe();
          resolve();
        });
        try {
          transport.post({ kind: 'hello', protocol: PROTOCOL_VERSION });
        } catch (error) {
          unsubscribe();
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        setTimeout(() => {
          if (resolved) return;
          unsubscribe();
          reject(new WireError('HELLO_TIMEOUT', 'Timed out waiting for wire hello'));
        }, 5_000);
      });
    },
  };
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `wire_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
