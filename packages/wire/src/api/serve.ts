import type { Unsubscribe } from '@emdash/shared';
import type { Controller } from './bind';
import {
  PROTOCOL_VERSION,
  serializeWireError,
  WireError,
  type WireMessage,
  type WireTransport,
} from './protocol';

export function serve(transport: WireTransport, controller: Controller): Unsubscribe {
  const attached = new Map<string, Unsubscribe>();

  function reply(id: string, work: () => Promise<unknown> | unknown): void {
    Promise.resolve()
      .then(work)
      .then(
        (value) => transport.post({ kind: 'result', id, ok: true, value }),
        (error: unknown) => {
          transport.post({ kind: 'result', id, ok: false, ...serializeWireError(error) });
        }
      );
  }

  function detachAll(): void {
    for (const detach of attached.values()) detach();
    attached.clear();
  }

  function handleMessage(message: WireMessage): void {
    switch (message.kind) {
      case 'hello':
        transport.post({ kind: 'hello', protocol: PROTOCOL_VERSION });
        break;
      case 'call':
        reply(message.id, () => controller.call(message.path, message.input, {}));
        break;
      case 'snapshot':
        reply(message.id, () => requireLiveSource(controller, message.topic).snapshot());
        break;
      case 'attach':
        reply(message.id, () => {
          if (attached.has(message.topic)) return undefined;
          const source = requireLiveSource(controller, message.topic);
          attached.set(
            message.topic,
            source.subscribe((update) =>
              transport.post({ kind: 'update', topic: message.topic, update })
            )
          );
          return undefined;
        });
        break;
      case 'detach':
        attached.get(message.topic)?.();
        attached.delete(message.topic);
        break;
      case 'result':
      case 'update':
        break;
    }
  }

  const unsubscribeMessage = transport.onMessage(handleMessage);
  const unsubscribeDisconnect = transport.onDisconnect(detachAll);

  return () => {
    unsubscribeMessage();
    unsubscribeDisconnect();
    detachAll();
  };
}

function requireLiveSource(controller: Controller, topic: string) {
  const source = controller.resolveLive(topic);
  if (!source) throw new WireError('UNKNOWN_TOPIC', `Unknown live topic '${topic}'`);
  return source;
}
