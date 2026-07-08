import type { Unsubscribe } from '@emdash/shared';
import type { LiveSnapshot, LiveUpdate } from '../live/protocol';
import type { WireInstrumentation } from '../observability';
import { WireError, type WireMessage, type WireTransport } from './protocol';

export type CallOptions = {
  signal?: AbortSignal;
};

export type ConnectOptions = {
  instrumentation?: WireInstrumentation;
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
};

export function connect(transport: WireTransport, options: ConnectOptions = {}): Connection {
  const pending = new Map<string, PendingCall>();
  const attachments = new Map<string, Set<(update: LiveUpdate) => void>>();
  const disconnectListeners = new Set<() => void>();
  const instrumentation = options.instrumentation;

  instrumentation?.transport?.({ event: 'connect' });

  transport.onMessage((message) => {
    if (message.kind === 'result') {
      const pendingCall = pending.get(message.id);
      if (!pendingCall) return;
      pending.delete(message.id);
      pendingCall.cleanup();
      if (message.ok) {
        pendingCall.resolve(message.value);
      } else {
        pendingCall.reject(new WireError(message.code, message.message, { cause: message.cause }));
      }
      return;
    }

    if (message.kind === 'update') {
      for (const push of attachments.get(message.topic) ?? []) push(message.update);
    }
  });

  transport.onDisconnect(() => {
    instrumentation?.transport?.({ event: 'disconnect' });
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
    const callStart = message.kind === 'call' ? performanceNow() : undefined;
    if (message.kind === 'call') {
      instrumentation?.callStart?.({
        callId: message.id,
        path: message.path,
        input: message.input,
        side: 'client',
      });
    }
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        if (message.kind === 'call') {
          instrumentation?.cancel?.({ callId: message.id, side: 'client' });
          instrumentation?.callEnd?.({
            callId: message.id,
            path: message.path,
            side: 'client',
            durationMs: 0,
            ok: false,
            errorCode: 'CANCELLED',
            errorMessage: 'Wire call cancelled',
          });
        }
        reject(new WireError('CANCELLED', 'Wire call cancelled'));
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
        if (message.kind === 'call') {
          instrumentation?.cancel?.({ callId: message.id, side: 'client' });
          instrumentation?.callEnd?.({
            callId: message.id,
            path: message.path,
            side: 'client',
            durationMs: performanceNow() - (callStart ?? performanceNow()),
            ok: false,
            errorCode: 'CANCELLED',
            errorMessage: 'Wire call cancelled',
          });
        }
        reject(new WireError('CANCELLED', 'Wire call cancelled'));
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
      const id = createRequestId();
      const start = performanceNow();
      return request({ kind: 'call', id, path, input }, options).then(
        (value) => {
          instrumentation?.callEnd?.({
            callId: id,
            path,
            side: 'client',
            durationMs: performanceNow() - start,
            ok: true,
            result: value,
          });
          return value;
        },
        (error: unknown) => {
          if (error instanceof WireError && error.code === 'CANCELLED') throw error;
          instrumentation?.callEnd?.({
            callId: id,
            path,
            side: 'client',
            durationMs: performanceNow() - start,
            ok: false,
            errorCode: error instanceof WireError ? error.code : 'HANDLER_ERROR',
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      );
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
  };
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `wire_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
