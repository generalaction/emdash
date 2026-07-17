import type { Unsubscribe } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../testing';
import { connect } from '../connect';
import type { WireMessage, WireTransport } from '../protocol';
import { reconnectingTransport } from './reconnecting';

describe('reconnectingTransport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes queued messages in order after the first connection opens', async () => {
    const connected = deferred<WireTransport>();
    const transport = reconnectingTransport(() => connected.promise);
    const inner = new FakeTransport();

    transport.post({ kind: 'detach', topic: 'first' });
    transport.post({ kind: 'cancel', id: 'second' });
    connected.resolve(inner);

    await vi.waitFor(() =>
      expect(inner.sent).toEqual([
        { kind: 'detach', topic: 'first' },
        { kind: 'cancel', id: 'second' },
      ])
    );
    transport.close();
  });

  it('rejects new messages without discarding queued messages when the queue is full', async () => {
    const connected = deferred<WireTransport>();
    const transport = reconnectingTransport(() => connected.promise, { maxQueuedMessages: 2 });
    const inner = new FakeTransport();

    transport.post({ kind: 'detach', topic: 'kept-a' });
    transport.post({ kind: 'cancel', id: 'kept-b' });
    expect(() => transport.post({ kind: 'detach', topic: 'rejected' })).toThrow(
      'Wire reconnect queue is full (limit 2)'
    );
    connected.resolve(inner);

    await vi.waitFor(() =>
      expect(inner.sent).toEqual([
        { kind: 'detach', topic: 'kept-a' },
        { kind: 'cancel', id: 'kept-b' },
      ])
    );
    transport.close();
  });

  it('rejects an RPC call when the reconnect queue is full', async () => {
    const connected = deferred<WireTransport>();
    const transport = reconnectingTransport(() => connected.promise, { maxQueuedMessages: 1 });
    const connection = connect(transport);
    const inner = new FakeTransport();

    const queued = connection.call('queued', null);
    await expect(connection.call('rejected', null)).rejects.toMatchObject({
      code: 'DISCONNECTED',
      message: 'Wire reconnect queue is full (limit 1)',
    });

    connected.resolve(inner);
    await vi.waitFor(() => expect(inner.sent).toHaveLength(1));
    const sent = inner.sent[0];
    expect(sent?.kind).toBe('call');
    if (sent?.kind !== 'call') throw new Error('Expected a queued call');
    inner.receive({ kind: 'result', id: sent.id, ok: true, value: 'done' });
    await expect(queued).resolves.toBe('done');

    transport.close();
  });

  it('does not queue blob channel frames while disconnected', async () => {
    const connected = deferred<WireTransport>();
    const transport = reconnectingTransport(() => connected.promise);
    const inner = new FakeTransport();

    transport.post({ kind: 'blob-pull', channel: 'stale', credit: 1 });
    transport.post({ kind: 'blob-close', channel: 'stale' });
    transport.post({ kind: 'detach', topic: 'kept' });
    connected.resolve(inner);

    await vi.waitFor(() => expect(inner.sent).toEqual([{ kind: 'detach', topic: 'kept' }]));
    transport.close();
  });

  it('fires reconnect only for replacement connections after queued messages flush', async () => {
    const firstReady = deferred<WireTransport>();
    const secondReady = deferred<WireTransport>();
    const first = new FakeTransport();
    const second = new FakeTransport();
    const reconnects: string[] = [];
    const transport = reconnectingTransport(() =>
      firstReady.settled ? secondReady.promise : firstReady.promise
    );
    transport.onReconnect(() => reconnects.push('reconnected'));

    firstReady.resolve(first);
    await vi.waitFor(() => expect(first.disconnectSubscriberCount).toBe(1));
    first.disconnect();
    transport.post({ kind: 'detach', topic: 'queued-on-reconnect' });
    secondReady.resolve(second);

    await vi.waitFor(() => {
      expect(second.sent).toEqual([{ kind: 'detach', topic: 'queued-on-reconnect' }]);
      expect(reconnects).toEqual(['reconnected']);
    });
    transport.close();
  });

  it('caps reconnect backoff at the last configured delay', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const transport = reconnectingTransport(
      () => {
        attempts += 1;
        return Promise.reject(new Error('offline'));
      },
      { backoffMs: [10, 20] }
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(attempts).toBe(3);
    await vi.advanceTimersByTimeAsync(20);
    expect(attempts).toBe(4);

    transport.close();
  });

  it('stops retrying when closed', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const transport = reconnectingTransport(
      () => {
        attempts += 1;
        return Promise.reject(new Error('offline'));
      },
      { backoffMs: [10] }
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toBe(1);

    transport.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(1);
  });
});

class FakeTransport implements WireTransport {
  readonly sent: WireMessage[] = [];
  private readonly messageListeners = new Set<(message: WireMessage) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private closed = false;

  get disconnectSubscriberCount(): number {
    return this.disconnectListeners.size;
  }

  post(message: WireMessage): void {
    if (this.closed) throw new Error('Fake transport closed');
    this.sent.push(message);
  }

  onMessage(cb: (message: WireMessage) => void): Unsubscribe {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onDisconnect(cb: () => void): Unsubscribe {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  receive(message: WireMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }

  disconnect(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.disconnectListeners) listener();
  }

  close(): void {
    this.disconnect();
    this.messageListeners.clear();
    this.disconnectListeners.clear();
  }
}
