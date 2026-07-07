import { isWireMessage, type PortLike } from './port-protocol';
import type { Unsubscribe, Wire } from './types';
import { serializeWireError } from './types';

export function serveWire(port: PortLike, wire: Wire): void {
  const attached = new Map<string, Unsubscribe>();

  port.on('message', (event) => {
    const message = event.data;
    if (!isWireMessage(message)) return;

    switch (message.kind) {
      case 'wire-call':
        void wire.procedures.call(message.path, message.input).then(
          (value) => {
            port.postMessage({ kind: 'wire-result', id: message.id, ok: true, value });
          },
          (error: unknown) => {
            port.postMessage({
              kind: 'wire-result',
              id: message.id,
              ok: false,
              ...serializeWireError(error),
            });
          }
        );
        break;
      case 'wire-snapshot':
        void wire.live.snapshot(message.topic).then(
          (value) => {
            port.postMessage({ kind: 'wire-result', id: message.id, ok: true, value });
          },
          (error: unknown) => {
            port.postMessage({
              kind: 'wire-result',
              id: message.id,
              ok: false,
              ...serializeWireError(error),
            });
          }
        );
        break;
      case 'wire-attach':
        if (attached.has(message.topic)) break;
        void wire.live
          .attach(message.topic, (update) => {
            port.postMessage({ kind: 'wire-update', topic: message.topic, update });
          })
          .then(
            (unsubscribe) => attached.set(message.topic, unsubscribe),
            (error: unknown) => {
              port.postMessage({
                kind: 'wire-result',
                id: `attach:${message.topic}`,
                ok: false,
                ...serializeWireError(error),
              });
            }
          );
        break;
      case 'wire-detach':
        attached.get(message.topic)?.();
        attached.delete(message.topic);
        break;
    }
  });
}
