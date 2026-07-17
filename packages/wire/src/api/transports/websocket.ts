import type { Unsubscribe } from '@emdash/shared';
import type { WireMessage, WireTransport } from '../protocol';
import { createWireFrameDecoder, encodeWireFrame } from './framing';
import {
  reconnectingTransport,
  type ReconnectingTransport,
  type ReconnectingTransportOptions,
} from './reconnecting';

export { DEFAULT_MAX_WIRE_FRAME_BYTES } from './framing';

const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_OPEN = 1;
const WEBSOCKET_CLOSING = 2;
const WEBSOCKET_CLOSED = 3;
const NORMAL_CLOSE_CODE = 1000;
const PROTOCOL_ERROR_CLOSE_CODE = 1002;

export type WebSocketCoreLike = {
  readonly readyState: number;
  send(data: Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
};

export type BrowserWebSocketLike = WebSocketCoreLike & {
  addEventListener(event: string, listener: (event: unknown) => void): void;
  removeEventListener?(event: string, listener: (event: unknown) => void): void;
};

export type NodeWebSocketLike = WebSocketCoreLike & {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
};

export type WebSocketLike = BrowserWebSocketLike | NodeWebSocketLike;

export type WebSocketTransportOptions = {
  maxFrameBytes?: number;
};

export type WebSocketTransport = WireTransport & {
  /** Resolves once the WebSocket is open and rejects if it disconnects first. */
  readonly ready: Promise<void>;
  close(): void;
};

export type ReconnectingWebSocketTransportOptions = WebSocketTransportOptions &
  ReconnectingTransportOptions;

/**
 * Adapts either a browser WebSocket or a Node `ws`-style socket.
 *
 * Callers that receive a connecting socket can await `ready` before handing the
 * transport to `connect()` or `serve()`. `reconnectingWebSocketTransport()` does
 * this automatically.
 */
export function webSocketTransport(
  socket: WebSocketLike,
  options: WebSocketTransportOptions = {}
): WebSocketTransport {
  const messageListeners = new Set<(message: WireMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  const decoder = createWireFrameDecoder({ maxFrameBytes: options.maxFrameBytes });
  const maxFrameBytes = options.maxFrameBytes;
  const browserEvents = isBrowserWebSocket(socket);
  const socketCleanups: Unsubscribe[] = [];
  let disconnected =
    socket.readyState === WEBSOCKET_CLOSING || socket.readyState === WEBSOCKET_CLOSED;
  let readySettled = socket.readyState === WEBSOCKET_OPEN;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  let receiveQueue = Promise.resolve();

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
    if (socket.readyState === WEBSOCKET_OPEN) resolve();
    if (disconnected) reject(new Error('WebSocket disconnected before opening'));
  });
  // A direct server-side adapter may never need to await readiness. Keep a
  // failed handshake from becoming an unhandled rejection in that case.
  void ready.catch(() => undefined);

  setBinaryType(socket);

  const cleanupSocket = (): void => {
    for (const cleanup of socketCleanups.splice(0)) cleanup();
    decoder.reset();
  };

  const notifyDisconnect = (error: Error): void => {
    if (disconnected) return;
    disconnected = true;
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    cleanupSocket();
    for (const listener of disconnectListeners) listener();
  };

  const protocolError = (error: unknown): void => {
    notifyDisconnect(toError(error, 'Invalid Wire WebSocket frame'));
    closeSocket(socket, PROTOCOL_ERROR_CLOSE_CODE, 'Invalid Wire frame');
  };

  socketCleanups.push(
    subscribeSocket(socket, 'open', () => {
      if (disconnected || readySettled) return;
      readySettled = true;
      resolveReady();
    }),
    subscribeSocket(socket, 'message', (...args) => {
      if (disconnected) return;
      receiveQueue = receiveQueue
        .then(async () => {
          const payload = browserEvents ? browserMessageData(args[0]) : nodeMessageData(args);
          const bytes = await webSocketDataBytes(payload);
          if (disconnected) return;
          for (const message of decoder.push(bytes)) {
            for (const listener of messageListeners) listener(message);
          }
        })
        .catch(protocolError);
    }),
    subscribeSocket(socket, 'close', () => {
      notifyDisconnect(new Error('WebSocket disconnected'));
    }),
    subscribeSocket(socket, 'error', () => {
      notifyDisconnect(new Error('WebSocket error'));
      closeSocket(socket);
    })
  );

  return {
    ready,
    post(message) {
      if (disconnected || socket.readyState !== WEBSOCKET_OPEN) {
        if (socket.readyState !== WEBSOCKET_CONNECTING) {
          notifyDisconnect(new Error('WebSocket disconnected'));
        }
        throw new Error(
          socket.readyState === WEBSOCKET_CONNECTING
            ? 'WebSocket is not open yet'
            : 'WebSocket transport disconnected'
        );
      }

      try {
        socket.send(encodeWireFrame(message, maxFrameBytes));
      } catch (error) {
        notifyDisconnect(toError(error, 'WebSocket send failed'));
        closeSocket(socket);
        throw error;
      }
    },
    onMessage(cb): Unsubscribe {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onDisconnect(cb): Unsubscribe {
      if (disconnected) {
        let subscribed = true;
        queueMicrotask(() => {
          if (subscribed) cb();
        });
        return () => {
          subscribed = false;
        };
      }
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
    close() {
      notifyDisconnect(new Error('WebSocket transport closed'));
      cleanupSocket();
      closeSocket(socket, NORMAL_CLOSE_CODE, 'Wire transport closed');
      messageListeners.clear();
      disconnectListeners.clear();
    },
  };
}

export function browserWebSocketTransport(
  socket: BrowserWebSocketLike,
  options: WebSocketTransportOptions = {}
): WebSocketTransport {
  return webSocketTransport(socket, options);
}

export function nodeWebSocketTransport(
  socket: NodeWebSocketLike,
  options: WebSocketTransportOptions = {}
): WebSocketTransport {
  return webSocketTransport(socket, options);
}

/** Creates sockets lazily and reconnects them with the standard Wire backoff/queue semantics. */
export function reconnectingWebSocketTransport(
  createSocket: () => WebSocketLike | Promise<WebSocketLike>,
  options: ReconnectingWebSocketTransportOptions = {}
): ReconnectingTransport {
  const { backoffMs, maxQueuedMessages, ...webSocketOptions } = options;
  return reconnectingTransport(
    async () => {
      const transport = webSocketTransport(await createSocket(), webSocketOptions);
      try {
        await transport.ready;
        return transport;
      } catch (error) {
        transport.close();
        throw error;
      }
    },
    { backoffMs, maxQueuedMessages }
  );
}

function isBrowserWebSocket(socket: WebSocketLike): socket is BrowserWebSocketLike {
  return 'addEventListener' in socket && typeof socket.addEventListener === 'function';
}

function subscribeSocket(
  socket: WebSocketLike,
  event: 'open' | 'message' | 'close' | 'error',
  listener: (...args: unknown[]) => void
): Unsubscribe {
  if (isBrowserWebSocket(socket)) {
    const browserListener = (value: unknown): void => listener(value);
    socket.addEventListener(event, browserListener);
    return () => socket.removeEventListener?.(event, browserListener);
  }

  socket.on(event, listener);
  return () => {
    socket.off?.(event, listener);
    socket.removeListener?.(event, listener);
  };
}

function browserMessageData(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('data' in value)) {
    throw new Error('WebSocket message event is missing data');
  }
  return (value as { data: unknown }).data;
}

function nodeMessageData(args: unknown[]): unknown {
  if (args[1] === false) throw new Error('Wire WebSocket frames must be binary');
  return args[0];
}

async function webSocketDataBytes(value: unknown): Promise<Uint8Array> {
  if (typeof value === 'string') throw new Error('Wire WebSocket frames must be binary');
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (isArrayBuffer(value)) return new Uint8Array(value);
  if (Array.isArray(value)) {
    const chunks = await Promise.all(value.map(webSocketDataBytes));
    return concatBytes(chunks);
  }
  if (isBlobLike(value)) return new Uint8Array(await value.arrayBuffer());
  throw new Error('Unsupported WebSocket message data');
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function isBlobLike(value: unknown): value is { arrayBuffer(): Promise<ArrayBuffer> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function'
  );
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return new Uint8Array(chunks[0]);
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function setBinaryType(socket: WebSocketLike): void {
  try {
    (socket as WebSocketLike & { binaryType?: string }).binaryType = 'arraybuffer';
  } catch {
    // Some WebSocket-compatible implementations expose a read-only binaryType.
  }
}

function closeSocket(socket: WebSocketCoreLike, code?: number, reason?: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // Closing an already-closed implementation is best effort.
  }
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback, { cause: error });
}
