import { describe, expect, it, vi } from 'vitest';
import { connect } from '../connect';
import type { WireTransport } from '../protocol';
import { memoryTransportPair } from './memory';
import { replaceableTransport } from './replaceable';

describe('replaceableTransport', () => {
  it('fences callbacks already queued by a retired physical transport', () => {
    const transport = replaceableTransport();
    let delayedDisconnect: (() => void) | undefined;
    const close = vi.fn();
    const old: WireTransport = {
      post() {},
      onMessage: () => () => {},
      close,
      onDisconnect(listener) {
        delayedDisconnect = listener;
        return () => {};
      },
    };
    transport.install(old);
    const replacement = memoryTransportPair();
    transport.install(replacement.left);
    delayedDisconnect?.();
    expect(transport.current).toBe(replacement.left);
    expect(transport.connected).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    transport.close();
  });

  it('closes late candidates and rejects installation after final disposal', () => {
    const transport = replaceableTransport();
    const close = vi.fn();
    transport.close();
    expect(() => transport.install({ ...memoryTransportPair().left, close })).toThrow('closed');
    expect(close).toHaveBeenCalledOnce();
    expect(transport.connected).toBe(false);
  });
  it('keeps logical identity while its owner installs and detaches physical transports', async () => {
    const transport = replaceableTransport();
    const connection = connect(transport, { maxHeldCalls: 0 });
    const first = memoryTransportPair();
    const replacement = memoryTransportPair();
    let disconnects = 0;
    let reconnects = 0;
    connection.onDisconnect(() => disconnects++);
    transport.onReconnect(() => reconnects++);
    try {
      await expect(connection.call('read', undefined)).rejects.toMatchObject({
        code: 'DISCONNECTED',
      });
      transport.install(first.left);
      expect(transport.connected).toBe(true);
      transport.detach();
      expect(transport.connected).toBe(false);
      await expect(connection.call('read', undefined)).rejects.toMatchObject({
        code: 'DISCONNECTED',
      });
      transport.install(replacement.left);
      first.disconnect();
      expect(transport.connected).toBe(true);
      expect(disconnects).toBe(1);
      expect(reconnects).toBe(2);
    } finally {
      connection.dispose();
      transport.close();
    }
  });
});
