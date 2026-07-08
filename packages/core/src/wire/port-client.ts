import type { LiveSnapshot, LiveUpdate } from '../live/protocol';
import { isWireMessage } from './port-protocol';
import type { Unsubscribe, Wire, WireTransport } from './types';
import { WireError } from './types';

type PendingCall = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export function portWire(transport: WireTransport): Wire {
  const pending = new Map<string, PendingCall>();
  const attachments = new Map<string, Set<(update: LiveUpdate) => void>>();
  const disconnectListeners = new Set<() => void>();

  transport.onMessage((message) => {
    if (!isWireMessage(message)) return;

    if (message.kind === 'wire-result') {
      const pendingCall = pending.get(message.id);
      if (!pendingCall) return;
      pending.delete(message.id);
      if (message.ok) {
        pendingCall.resolve(message.value);
      } else {
        pendingCall.reject(new WireError(message.code, message.message));
      }
      return;
    }

    if (message.kind === 'wire-update') {
      for (const push of attachments.get(message.topic) ?? []) {
        push(message.update);
      }
    }
  });

  transport.onDisconnect(() => {
    for (const pendingCall of pending.values()) {
      pendingCall.reject(new WireError('DISCONNECTED', 'Wire transport disconnected'));
    }
    pending.clear();

    for (const listener of disconnectListeners) listener();
    for (const topic of attachments.keys()) {
      transport.post({ kind: 'wire-attach', topic });
    }
  });

  function request(message: {
    kind: 'wire-call' | 'wire-snapshot';
    id: string;
    path?: string;
    input?: unknown;
    topic?: string;
  }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      pending.set(message.id, { resolve, reject });
      try {
        transport.post(message);
      } catch (error) {
        pending.delete(message.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  return {
    procedures: {
      call(path, input) {
        return request({ kind: 'wire-call', id: crypto.randomUUID(), path, input });
      },
    },
    live: {
      snapshot(topic) {
        return request({ kind: 'wire-snapshot', id: crypto.randomUUID(), topic }) as Promise<
          LiveSnapshot<unknown>
        >;
      },
      async attach(topic, push) {
        let pushes = attachments.get(topic);
        if (!pushes) {
          pushes = new Set();
          attachments.set(topic, pushes);
          transport.post({ kind: 'wire-attach', topic });
        }
        pushes.add(push);

        return () => {
          pushes.delete(push);
          if (pushes.size > 0) return;
          attachments.delete(topic);
          transport.post({ kind: 'wire-detach', topic });
        };
      },
    },
    onDisconnect(cb): Unsubscribe {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
  };
}
