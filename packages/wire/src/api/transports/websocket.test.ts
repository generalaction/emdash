import { describe, expect, it, vi } from 'vitest';
import type { WireMessage } from '../protocol';
import {
  browserWebSocketTransport,
  nodeWebSocketTransport,
  reconnectingWebSocketTransport,
  type BrowserWebSocketLike,
  type NodeWebSocketLike,
} from './websocket';

describe('webSocketTransport', () => {
  it('waits for a browser WebSocket to open and decodes its binary messages', async () => {
    const socket = new FakeBrowserWebSocket(0);
    const transport = browserWebSocketTransport(socket);
    const messages: WireMessage[] = [];
    transport.onMessage((message) => messages.push(message));

    expect(() => transport.post({ kind: 'cancel', id: 'too-early' })).toThrow(
      'WebSocket is not open yet'
    );
    socket.open();
    await transport.ready;

    transport.post({ kind: 'cancel', id: 'call-1' });
    expect(socket.binaryType).toBe('arraybuffer');
    socket.message(socket.sent[0]!.slice().buffer);

    await vi.waitFor(() => expect(messages).toEqual([{ kind: 'cancel', id: 'call-1' }]));
    transport.close();
  });

  it('round-trips blob chunks from browser Blob-like message data', async () => {
    const socket = new FakeBrowserWebSocket(1);
    const transport = browserWebSocketTransport(socket);
    const messages: WireMessage[] = [];
    const data = new Uint8Array([0, 7, 255, 42]);
    transport.onMessage((message) => messages.push(message));

    transport.post({ kind: 'blob-chunk', channel: 'upload', seq: 3, data });
    const frame = socket.sent[0]!.slice();
    socket.message({ arrayBuffer: async () => frame.buffer as ArrayBuffer });

    await vi.waitFor(() =>
      expect(messages).toEqual([{ kind: 'blob-chunk', channel: 'upload', seq: 3, data }])
    );
    transport.close();
  });

  it('accepts Node ws-style Buffer fragments', async () => {
    const socket = new FakeNodeWebSocket(1);
    const transport = nodeWebSocketTransport(socket);
    const messages: WireMessage[] = [];
    transport.onMessage((message) => messages.push(message));

    transport.post({ kind: 'detach', topic: 'topic-a' });
    const frame = socket.sent[0]!;
    const split = Math.floor(frame.byteLength / 2);
    socket.message([Buffer.from(frame.subarray(0, split)), Buffer.from(frame.subarray(split))]);

    await vi.waitFor(() => expect(messages).toEqual([{ kind: 'detach', topic: 'topic-a' }]));
    transport.close();
  });

  it('notifies disconnect once and rejects readiness when the socket closes early', async () => {
    const socket = new FakeBrowserWebSocket(0);
    const transport = browserWebSocketTransport(socket);
    const disconnect = vi.fn();
    transport.onDisconnect(disconnect);

    socket.peerClose();
    socket.error();

    await expect(transport.ready).rejects.toThrow('WebSocket disconnected');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('closes the underlying socket when it emits an error', async () => {
    const socket = new FakeBrowserWebSocket(1);
    const transport = browserWebSocketTransport(socket);
    const disconnect = vi.fn();
    transport.onDisconnect(disconnect);
    await transport.ready;

    socket.error();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toEqual([{ code: undefined, reason: undefined }]);
    expect(socket.readyState).toBe(3);
  });

  it('closes with a protocol error for corrupt or oversized frames', async () => {
    const corruptSocket = new FakeBrowserWebSocket(1);
    browserWebSocketTransport(corruptSocket);
    corruptSocket.message(new Uint8Array([0xff, 0, 0, 0, 0]));

    await vi.waitFor(() =>
      expect(corruptSocket.closeCalls).toContainEqual({ code: 1002, reason: 'Invalid Wire frame' })
    );

    const limitedSocket = new FakeBrowserWebSocket(1);
    const limited = browserWebSocketTransport(limitedSocket, { maxFrameBytes: 20 });
    expect(() => limited.post({ kind: 'detach', topic: 'this-is-too-long' })).toThrow(
      'Wire frame exceeds 20 bytes'
    );
    limited.close();
  });

  it('allows response-sized frames above 128 KiB by default', () => {
    const socket = new FakeBrowserWebSocket(1);
    const transport = browserWebSocketTransport(socket);
    const value = 'x'.repeat(512 * 1024);

    expect(() =>
      transport.post({ kind: 'result', id: 'large-result', ok: true, value })
    ).not.toThrow();
    expect(socket.sent[0]?.byteLength).toBeGreaterThan(128 * 1024);

    transport.close();
  });

  it('rejects text WebSocket messages', async () => {
    const browserSocket = new FakeBrowserWebSocket(1);
    browserWebSocketTransport(browserSocket);
    browserSocket.message('not a binary frame');

    await vi.waitFor(() =>
      expect(browserSocket.closeCalls).toContainEqual({
        code: 1002,
        reason: 'Invalid Wire frame',
      })
    );

    const nodeSocket = new FakeNodeWebSocket(1);
    nodeWebSocketTransport(nodeSocket);
    nodeSocket.message(Buffer.from('not a binary frame'), false);

    await vi.waitFor(() => expect(nodeSocket.closeCalls).toContainEqual({ code: 1002 }));
  });

  it('reconnects browser or Node-style sockets and flushes queued messages', async () => {
    const sockets: FakeBrowserWebSocket[] = [];
    const reconnects = vi.fn();
    const disconnects = vi.fn();
    const transport = reconnectingWebSocketTransport(
      () => {
        const socket = new FakeBrowserWebSocket(0);
        sockets.push(socket);
        return socket;
      },
      { backoffMs: [0] }
    );
    transport.onDisconnect(disconnects);
    transport.onReconnect(reconnects);

    transport.post({ kind: 'detach', topic: 'first' });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.open();
    await vi.waitFor(() => expect(sockets[0]!.sent).toHaveLength(1));

    sockets[0]!.peerClose();
    transport.post({ kind: 'cancel', id: 'after-disconnect' });
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]!.open();

    await vi.waitFor(() => {
      expect(sockets[1]!.sent).toHaveLength(1);
      expect(disconnects).toHaveBeenCalledTimes(1);
      expect(reconnects).toHaveBeenCalledTimes(1);
    });
    transport.close();
  });
});

type BrowserListener = (event: unknown) => void;

class FakeBrowserWebSocket implements BrowserWebSocketLike {
  readonly sent: Uint8Array[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  binaryType = 'blob';
  private readonly listeners = new Map<string, Set<BrowserListener>>();

  constructor(public readyState: number) {}

  send(data: Uint8Array): void {
    if (this.readyState !== 1) throw new Error('Fake WebSocket is not open');
    this.sent.push(new Uint8Array(data));
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', {});
  }

  addEventListener(event: string, listener: BrowserListener): void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(event: string, listener: BrowserListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  message(data: unknown): void {
    this.emit('message', { data });
  }

  error(): void {
    this.emit('error', {});
  }

  peerClose(): void {
    this.readyState = 3;
    this.emit('close', {});
  }

  private emit(event: string, value: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(value);
  }
}

type NodeListener = (...args: unknown[]) => void;

class FakeNodeWebSocket implements NodeWebSocketLike {
  readonly sent: Uint8Array[] = [];
  readonly closeCalls: Array<{ code?: number }> = [];
  private readonly listeners = new Map<string, Set<NodeListener>>();

  constructor(public readyState: number) {}

  send(data: Uint8Array): void {
    if (this.readyState !== 1) throw new Error('Fake WebSocket is not open');
    this.sent.push(new Uint8Array(data));
  }

  close(code?: number): void {
    this.closeCalls.push({ code });
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }

  on(event: string, listener: NodeListener): this {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
    return this;
  }

  off(event: string, listener: NodeListener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  removeListener(event: string, listener: NodeListener): this {
    return this.off(event, listener);
  }

  message(data: unknown, isBinary = true): void {
    this.emit('message', data, isBinary);
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}
