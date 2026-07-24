import type { Unsubscribe } from '@emdash/shared';
import type { LiveSnapshot, LiveUpdate } from '../live/protocol';
import type { WireInstrumentation } from '../observability';
import {
  findStructuredCloneFailure,
  formatStructuredCloneFailure,
  isStructuredCloneError,
} from '../util/structured-clone';
import {
  createBlobConsumer,
  createBlobProducer,
  type BlobConsumer,
  type BlobProducer,
  type BlobSource,
} from './blob-channel';
import {
  WireError,
  type SerializedWireError,
  type WireFileMeta,
  type WireMessage,
  type WireTransport,
} from './protocol';

export type CallOptions = {
  signal?: AbortSignal;
  upload?: {
    channel: string;
    meta: WireFileMeta;
  };
};

export type AttachOptions = {
  onReattach?: () => void;
  onReattachError?: (error: WireError, context: { retrying: boolean }) => void;
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
  onReattachError: Set<(error: WireError, context: { retrying: boolean }) => void>;
  established: Promise<void>;
  attempt: object | null;
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
  /** Disposes this logical connection without closing the underlying transport. */
  dispose(): void;
};

export function connect(transport: WireTransport, options: ConnectOptions = {}): Connection {
  const pending = new Map<string, PendingCall>();
  const attachments = new Map<string, Attachment>();
  const blobConsumers = new Map<string, BlobConsumer>();
  const blobProducers = new Map<string, BlobProducer>();
  const disconnectListeners = new Set<() => void>();
  const instrumentation = options.instrumentation;
  let disposed = false;

  instrumentation?.transport?.({ event: 'connect' });

  const unsubscribeMessage = transport.onMessage((message) => {
    if (disposed) return;
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

    if (message.kind === 'topic-gap') {
      notifyReattached(attachments.get(message.topic));
      return;
    }

    if (message.kind === 'topic-error') {
      const entry = attachments.get(message.topic);
      const error = wireErrorFromSerialized(message.error);
      notifyReattachError(entry, error, { retrying: message.retrying });
      if (!message.retrying) attachments.delete(message.topic);
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

  const unsubscribeDisconnect = transport.onDisconnect(() => {
    if (disposed) return;
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

  const unsubscribeReconnect = transport.onReconnect?.(() => {
    if (disposed) return;
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
      if (disposed) {
        reject(new WireError('DISCONNECTED', 'Wire connection disposed'));
        return;
      }
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
        reject(createPostError(message, error));
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
      assertActive();
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
      assertActive();
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
      if (attachOptions.onReattachError) entry.onReattachError.add(attachOptions.onReattachError);

      try {
        await entry.established;
      } catch (error) {
        entry.pushes.delete(push);
        if (attachOptions.onReattach) entry.onReattach.delete(attachOptions.onReattach);
        if (attachOptions.onReattachError)
          entry.onReattachError.delete(attachOptions.onReattachError);
        throw error;
      }

      return () => {
        const current = attachments.get(topic);
        if (current !== entry) return;
        current.pushes.delete(push);
        if (attachOptions.onReattach) current.onReattach.delete(attachOptions.onReattach);
        if (attachOptions.onReattachError)
          current.onReattachError.delete(attachOptions.onReattachError);
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
      if (disposed) return () => {};
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
    dispose() {
      if (disposed) return;
      disposed = true;

      for (const topic of attachments.keys()) {
        try {
          transport.post({ kind: 'detach', topic });
        } catch {
          // The underlying transport may already be disconnected.
        }
      }
      attachments.clear();

      for (const pendingCall of pending.values()) {
        pendingCall.cleanup();
        pendingCall.reject(new WireError('DISCONNECTED', 'Wire connection disposed'));
      }
      pending.clear();

      for (const consumer of blobConsumers.values()) {
        consumer.fail(new WireError('DISCONNECTED', 'Wire connection disposed'));
      }
      blobConsumers.clear();
      for (const producer of blobProducers.values()) producer.close();
      blobProducers.clear();

      unsubscribeReconnect?.();
      unsubscribeDisconnect();
      unsubscribeMessage();
      disconnectListeners.clear();
    },
  };

  function assertActive(): void {
    if (disposed) throw new WireError('DISCONNECTED', 'Wire connection disposed');
  }

  function getOrCreateAttachment(topic: string): Attachment {
    const current = attachments.get(topic);
    if (current) return current;
    const created: Attachment = {
      pushes: new Set(),
      onReattach: new Set(),
      onReattachError: new Set(),
      established: Promise.resolve(),
      attempt: null,
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
    const attempt = {};
    entry.attempt = attempt;
    const established = request({ kind: 'attach', id: createRequestId(), topic }).then(() => {});
    established.then(
      () => {
        if (attachments.get(topic) !== entry || entry.attempt !== attempt) return;
        if (notifyReattach) notifyReattached(entry);
      },
      (error: unknown) => {
        if (attachments.get(topic) !== entry || entry.attempt !== attempt) return;
        const wireError = toWireError(error);
        if (notifyReattach) {
          const retrying = wireError.code === 'DISCONNECTED';
          notifyReattachError(entry, wireError, { retrying });
          if (!retrying) attachments.delete(topic);
          return;
        }
        attachments.delete(topic);
      }
    );
    return established;
  }

  function notifyReattached(entry: Attachment | undefined): void {
    if (!entry) return;
    for (const cb of entry.onReattach) {
      try {
        cb();
      } catch {
        // Reattach observers are best-effort and must not break the connection.
      }
    }
  }

  function notifyReattachError(
    entry: Attachment | undefined,
    error: WireError,
    context: { retrying: boolean }
  ): void {
    if (!entry) return;
    for (const cb of entry.onReattachError) {
      try {
        cb(error, context);
      } catch {
        // Reattach observers are best-effort and must not break the connection.
      }
    }
  }
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `wire_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function toWireError(error: unknown): WireError {
  if (error instanceof WireError) return error;
  return new WireError('HANDLER_ERROR', error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function createPostError(message: WireMessage, error: unknown): WireError {
  if (isStructuredCloneError(error)) {
    const callContext = message.kind === 'call' ? `Wire call '${message.path}'` : 'Wire message';
    const inputFailure =
      message.kind === 'call' ? findStructuredCloneFailure(message.input, 'input') : null;
    const diagnostic = inputFailure
      ? `'${inputFailure.path}' ${inputFailure.reason}`
      : formatStructuredCloneFailure(message, 'message');
    return new WireError('SERIALIZATION', `${callContext} could not be serialized: ${diagnostic}`, {
      cause: error,
    });
  }
  return new WireError(
    'DISCONNECTED',
    error instanceof Error ? error.message : 'Wire transport disconnected',
    { cause: error }
  );
}

function wireErrorFromSerialized(error: SerializedWireError): WireError {
  return new WireError(error.code, error.message, { cause: error.cause });
}
