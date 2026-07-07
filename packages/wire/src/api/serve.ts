import type { Unsubscribe } from '@emdash/shared';
import type { Controller } from './bind';
import {
  PROTOCOL_VERSION,
  serializeWireError,
  WireError,
  WIRE_CANCELLED_CODE,
  type WireMessage,
  type WireTransport,
} from './protocol';

export function serve(transport: WireTransport, controller: Controller): Unsubscribe {
  const attached = new Map<string, Unsubscribe>();
  const calls = new Map<string, AbortController>();

  function post(message: WireMessage): void {
    try {
      transport.post(message);
    } catch {
      // The peer may disconnect while async work is settling.
    }
  }

  function reply(id: string, work: () => Promise<unknown> | unknown): void {
    Promise.resolve()
      .then(work)
      .then(
        (value) => post({ kind: 'result', id, ok: true, value }),
        (error: unknown) => {
          post({ kind: 'result', id, ok: false, ...serializeWireError(error) });
        }
      );
  }

  function replyCall(id: string, work: (signal: AbortSignal) => Promise<unknown> | unknown): void {
    const abort = new AbortController();
    calls.set(id, abort);
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(work(abort.signal));
    } catch (error) {
      result = Promise.reject(error);
    }
    result
      .then(
        (value) => post({ kind: 'result', id, ok: true, value }),
        (error: unknown) => {
          const serialized = abort.signal.aborted
            ? { code: WIRE_CANCELLED_CODE, message: 'Wire call cancelled' }
            : serializeWireError(error);
          post({ kind: 'result', id, ok: false, ...serialized });
        }
      )
      .finally(() => {
        calls.delete(id);
      });
  }

  function detachAll(): void {
    for (const detach of attached.values()) detach();
    attached.clear();
  }

  function abortAll(): void {
    for (const abort of calls.values()) abort.abort();
    calls.clear();
  }

  function handleMessage(message: WireMessage): void {
    switch (message.kind) {
      case 'hello':
        post({ kind: 'hello', protocol: PROTOCOL_VERSION });
        break;
      case 'call':
        replyCall(message.id, (signal) => controller.call(message.path, message.input, { signal }));
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
            source.subscribe((update) => post({ kind: 'update', topic: message.topic, update }))
          );
          return undefined;
        });
        break;
      case 'detach':
        attached.get(message.topic)?.();
        attached.delete(message.topic);
        break;
      case 'cancel':
        calls.get(message.id)?.abort();
        break;
      case 'result':
      case 'update':
        break;
    }
  }

  const unsubscribeMessage = transport.onMessage(handleMessage);
  const unsubscribeDisconnect = transport.onDisconnect(() => {
    abortAll();
    detachAll();
  });

  return () => {
    unsubscribeMessage();
    unsubscribeDisconnect();
    abortAll();
    detachAll();
  };
}

function requireLiveSource(controller: Controller, topic: string) {
  const source = controller.resolveLive(topic);
  if (!source) throw new WireError('UNKNOWN_TOPIC', `Unknown live topic '${topic}'`);
  return source;
}
