import type { Unsubscribe } from '@emdash/shared';
import type { LiveSnapshot, LiveUpdate } from '../live/protocol';
import type { WireInstrumentation } from '../observability';
import {
  createBlobConsumer,
  createBlobProducer,
  type BlobConsumer,
  type BlobProducer,
  type BlobSource,
} from './blob-channel';
import { WireError, type WireFileMeta, type WireMessage, type WireTransport } from './protocol';

export type CallOptions = {
  signal?: AbortSignal;
  upload?: {
    channel: string;
    meta: WireFileMeta;
  };
};

export type AttachOptions = {
  onReattach?: () => void;
};

export type ConnectOptions = {
  instrumentation?: WireInstrumentation;
};

type PendingCall = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
};

type Attachment = {
  pushes: Set<(update: LiveUpdate) => void>;
  onReattach: Set<() => void>;
  established: Promise<void>;
};

export type Connection = {
  call(path: string, input: unknown, options?: CallOptions): Promise<unknown>;
  openBlobConsumer(channel: string): BlobConsumer;
  openBlobProducer(channel: string, source: BlobSource): BlobProducer;
  snapshot(topic: string): Promise<LiveSnapshot<unknown>>;
  attach(
    topic: string,
    push: (update: LiveUpdate) => void,
    options?: AttachOptions
  ): Promise<Unsubscribe>;
  onDisconnect(cb: () => void): Unsubscribe;
};

export function connect(transport: WireTransport, options: ConnectOptions = {}): Connection {
  const pending = new Map<string, PendingCall>();
  const attachments = new Map<string, Attachment>();
  const blobConsumers = new Map<string, BlobConsumer>();
  const blobProducers = new Map<string, BlobProducer>();
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
      for (const push of attachments.get(message.topic)?.pushes ?? []) push(message.update);
      return;
    }

    if (message.kind === 'blob-pull') {
      blobProducers.get(message.channel)?.grant(message.credit);
      return;
    }

    if (message.kind === 'blob-chunk') {
      blobConsumers.get(message.channel)?.push(message.seq, message.data);
      return;
    }

    if (message.kind === 'blob-end') {
      blobConsumers.get(message.channel)?.end();
      blobConsumers.delete(message.channel);
      return;
    }

    if (message.kind === 'blob-error') {
      blobConsumers
        .get(message.channel)
        ?.fail(
          new WireError(message.error.code, message.error.message, { cause: message.error.cause })
        );
      blobConsumers.delete(message.channel);
      return;
    }

    if (message.kind === 'blob-close') {
      blobProducers.get(message.channel)?.close();
      blobProducers.delete(message.channel);
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

    for (const consumer of blobConsumers.values()) {
      consumer.fail(new WireError('DISCONNECTED', 'Wire transport disconnected'));
    }
    blobConsumers.clear();
    for (const producer of blobProducers.values()) producer.close();
    blobProducers.clear();
  });

  transport.onReconnect?.(() => {
    instrumentation?.transport?.({ event: 'reconnect' });
    for (const [topic, entry] of attachments) {
      entry.established = establishAttachment(topic, entry, true);
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
      return request({ kind: 'call', id, path, input, upload: options?.upload }, options).then(
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
    openBlobConsumer(channel) {
      const base = createBlobConsumer({
        channel,
        post: (message) => transport.post(message),
      });
      const wrapped: BlobConsumer = {
        ...base,
        cancel() {
          base.cancel();
          blobConsumers.delete(channel);
        },
      };
      blobConsumers.set(channel, wrapped);
      return wrapped;
    },
    openBlobProducer(channel, source) {
      const producer = createBlobProducer({
        channel,
        source,
        post: (message) => transport.post(message),
        onClose: () => blobProducers.delete(channel),
      });
      blobProducers.set(channel, producer);
      return producer;
    },
    snapshot(topic) {
      return request({ kind: 'snapshot', id: createRequestId(), topic }) as Promise<
        LiveSnapshot<unknown>
      >;
    },
    async attach(topic, push, attachOptions = {}) {
      const entry = getOrCreateAttachment(topic);
      entry.pushes.add(push);
      if (attachOptions.onReattach) entry.onReattach.add(attachOptions.onReattach);

      try {
        await entry.established;
      } catch (error) {
        entry.pushes.delete(push);
        if (attachOptions.onReattach) entry.onReattach.delete(attachOptions.onReattach);
        throw error;
      }

      return () => {
        const current = attachments.get(topic);
        if (current !== entry) return;
        current.pushes.delete(push);
        if (attachOptions.onReattach) current.onReattach.delete(attachOptions.onReattach);
        if (current.pushes.size > 0) return;
        attachments.delete(topic);
        try {
          transport.post({ kind: 'detach', topic });
        } catch {
          // The peer may already be disconnected; local teardown is complete.
        }
      };
    },
    onDisconnect(cb): Unsubscribe {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
  };

  function getOrCreateAttachment(topic: string): Attachment {
    const current = attachments.get(topic);
    if (current) return current;
    const created: Attachment = {
      pushes: new Set(),
      onReattach: new Set(),
      established: Promise.resolve(),
    };
    attachments.set(topic, created);
    created.established = establishAttachment(topic, created, false);
    return created;
  }

  function establishAttachment(
    topic: string,
    entry: Attachment,
    notifyReattach: boolean
  ): Promise<void> {
    const established = request({ kind: 'attach', id: createRequestId(), topic }).then(() => {});
    established.then(
      () => {
        if (!notifyReattach || attachments.get(topic) !== entry) return;
        for (const cb of entry.onReattach) {
          try {
            cb();
          } catch {
            // Reattach observers are best-effort and must not break the connection.
          }
        }
      },
      () => {
        if (attachments.get(topic) === entry) attachments.delete(topic);
      }
    );
    return established;
  }
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `wire_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
