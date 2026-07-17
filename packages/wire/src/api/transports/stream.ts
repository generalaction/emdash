import type { Unsubscribe } from '@emdash/shared';
import type { WireMessage, WireTransport } from '../protocol';
import { createWireFrameDecoder, encodeWireFrame } from './framing';

type ReadableLike = {
  on(event: 'data', cb: (chunk: Buffer | string) => void): unknown;
  on(event: 'close' | 'end' | 'error', cb: () => void): unknown;
};

type WritableLike = {
  write(chunk: string | Uint8Array): unknown;
};

export function streamTransport(input: ReadableLike, output: WritableLike): WireTransport {
  const messageListeners = new Set<(message: WireMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  const decoder = createWireFrameDecoder();
  let disconnected = false;

  const notifyDisconnect = (): void => {
    if (disconnected) return;
    disconnected = true;
    for (const listener of disconnectListeners) listener();
  };

  input.on('data', (chunk) => {
    if (disconnected) return;
    try {
      for (const message of decoder.push(normalizeChunk(chunk))) {
        for (const listener of messageListeners) listener(message);
      }
    } catch {
      notifyDisconnect();
    }
  });
  input.on('close', notifyDisconnect);
  input.on('end', notifyDisconnect);
  input.on('error', notifyDisconnect);

  return {
    post(message) {
      if (disconnected) throw new Error('Stream transport disconnected');
      output.write(encodeWireFrame(message));
    },
    onMessage(cb): Unsubscribe {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onDisconnect(cb): Unsubscribe {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
    close() {
      notifyDisconnect();
      messageListeners.clear();
      disconnectListeners.clear();
      decoder.reset();
    },
  };
}

function normalizeChunk(chunk: Buffer | string): Uint8Array {
  return typeof chunk === 'string'
    ? new globalThis.TextEncoder().encode(chunk)
    : new Uint8Array(chunk);
}
