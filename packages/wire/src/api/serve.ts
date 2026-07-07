import type { Unsubscribe } from '@emdash/shared';
import { getCurrentLogger, runWithLogger, type Logger } from '@emdash/shared/logger';
import type { WireInstrumentation } from '../observability';
import type { Controller } from './bind';
import {
  PROTOCOL_VERSION,
  serializeWireError,
  WireError,
  WIRE_CANCELLED_CODE,
  type WireMessage,
  type WireTransport,
} from './protocol';

export type ServeOptions = {
  instrumentation?: WireInstrumentation;
  logger?: Logger;
};

export function serve(
  transport: WireTransport,
  controller: Controller,
  options: ServeOptions = {}
): Unsubscribe {
  const attached = new Map<string, Unsubscribe>();
  const calls = new Map<string, AbortController>();
  const instrumentation = options.instrumentation;

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

  function replyCall(
    id: string,
    work: (signal: AbortSignal) => Promise<unknown> | unknown,
    onEnd?: (event: {
      durationMs: number;
      ok: boolean;
      value?: unknown;
      errorCode?: string;
      errorMessage?: string;
    }) => void
  ): void {
    const abort = new AbortController();
    calls.set(id, abort);
    const start = performanceNow();
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(work(abort.signal));
    } catch (error) {
      result = Promise.reject(error);
    }
    result
      .then(
        (value) => {
          onEnd?.({ durationMs: performanceNow() - start, ok: true, value });
          post({ kind: 'result', id, ok: true, value });
        },
        (error: unknown) => {
          const serialized = abort.signal.aborted
            ? { code: WIRE_CANCELLED_CODE, message: 'Wire call cancelled' }
            : serializeWireError(error);
          onEnd?.({
            durationMs: performanceNow() - start,
            ok: false,
            errorCode: serialized.code,
            errorMessage: serialized.message,
          });
          post({ kind: 'result', id, ok: false, ...serialized });
        }
      )
      .finally(() => {
        calls.delete(id);
      });
  }

  function replyControllerCall(id: string, path: string, input: unknown): void {
    instrumentation?.callStart?.({ callId: id, path, input, side: 'server' });
    const logger = options.logger ?? getCurrentLogger();
    replyCall(
      id,
      (signal) =>
        runWithLogger(logger.child({ wireCallId: id, wirePath: path }), () =>
          controller.call(path, input, { signal })
        ),
      (event) =>
        instrumentation?.callEnd?.({
          callId: id,
          path,
          side: 'server',
          durationMs: event.durationMs,
          ok: event.ok,
          result: event.value,
          errorCode: event.errorCode,
          errorMessage: event.errorMessage,
        })
    );
  }

  function replySnapshot(id: string, topic: string): void {
    const start = performanceNow();
    reply(id, async () => {
      try {
        const snapshot = await requireLiveSource(controller, topic).snapshot();
        instrumentation?.snapshot?.({
          requestId: id,
          topic,
          durationMs: performanceNow() - start,
          ok: true,
        });
        return snapshot;
      } catch (error) {
        instrumentation?.snapshot?.({
          requestId: id,
          topic,
          durationMs: performanceNow() - start,
          ok: false,
          errorCode: error instanceof WireError ? error.code : 'ERROR',
        });
        throw error;
      }
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
        replyControllerCall(message.id, message.path, message.input);
        break;
      case 'snapshot':
        replySnapshot(message.id, message.topic);
        break;
      case 'attach':
        reply(message.id, () => {
          if (attached.has(message.topic)) return undefined;
          const source = requireLiveSource(controller, message.topic);
          attached.set(
            message.topic,
            source.subscribe((update) => post({ kind: 'update', topic: message.topic, update }))
          );
          instrumentation?.topicAttach?.({
            topic: message.topic,
            attachmentCount: attached.size,
          });
          return undefined;
        });
        break;
      case 'detach':
        attached.get(message.topic)?.();
        attached.delete(message.topic);
        instrumentation?.topicDetach?.({
          topic: message.topic,
          attachmentCount: attached.size,
        });
        break;
      case 'cancel':
        instrumentation?.cancel?.({ callId: message.id, side: 'server' });
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

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function requireLiveSource(controller: Controller, topic: string) {
  const source = controller.resolveLive(topic);
  if (!source) throw new WireError('UNKNOWN_TOPIC', `Unknown live topic '${topic}'`);
  return source;
}
