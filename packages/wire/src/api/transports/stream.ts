import type { Unsubscribe } from '@emdash/shared';
import { isWireMessage, type WireMessage, type WireTransport } from '../protocol';

type ReadableLike = {
  on(event: 'data', cb: (chunk: Buffer | string) => void): unknown;
  on(event: 'close' | 'end' | 'error', cb: () => void): unknown;
};

type WritableLike = {
  write(chunk: string): unknown;
};

export function streamTransport(input: ReadableLike, output: WritableLike): WireTransport {
  const messageListeners = new Set<(message: WireMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  let buffer = '';
  let disconnected = false;

  const notifyDisconnect = (): void => {
    if (disconnected) return;
    disconnected = true;
    for (const listener of disconnectListeners) listener();
  };

  input.on('data', (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.length > 0) emitParsedLine(line, messageListeners);
      index = buffer.indexOf('\n');
    }
  });
  input.on('close', notifyDisconnect);
  input.on('end', notifyDisconnect);
  input.on('error', notifyDisconnect);

  return {
    post(message) {
      output.write(`${JSON.stringify(message)}\n`);
    },
    onMessage(cb): Unsubscribe {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onDisconnect(cb): Unsubscribe {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
  };
}

function emitParsedLine(line: string, listeners: Set<(message: WireMessage) => void>): void {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isWireMessage(parsed)) return;
    for (const listener of listeners) listener(parsed);
  } catch {
    // Ignore malformed frames. The stream boundary is lossy only for that frame.
  }
}
