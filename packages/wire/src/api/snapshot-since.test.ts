import { describe, expect, it, vi } from 'vitest';
import { LiveLogSource } from '../live/log/source';
import { connect } from './connect';
import type { Controller } from './controller';
import type { WireMessage, WireTransport } from './protocol';
import { serve } from './serve';

function createLoopbackTransports(): {
  clientTransport: WireTransport;
  serverTransport: WireTransport;
} {
  const clientHandlers = new Set<(message: WireMessage) => void>();
  const serverHandlers = new Set<(message: WireMessage) => void>();

  const clientTransport: WireTransport = {
    post(message) {
      for (const handler of serverHandlers) handler(message);
    },
    onMessage(handler) {
      clientHandlers.add(handler);
      return () => clientHandlers.delete(handler);
    },
    onDisconnect() {
      return () => {};
    },
  };

  const serverTransport: WireTransport = {
    post(message) {
      for (const handler of clientHandlers) handler(message);
    },
    onMessage(handler) {
      serverHandlers.add(handler);
      return () => serverHandlers.delete(handler);
    },
    onDisconnect() {
      return () => {};
    },
  };

  return { clientTransport, serverTransport };
}

function createController(source: LiveLogSource): Controller {
  return {
    call: vi.fn(),
    acquireLive: () => ({
      ready: async () => source,
      release: async () => {},
    }),
  } as unknown as Controller;
}

describe('snapshot since round trip', () => {
  it('passes a valid since to the live source and returns the ranged tail', async () => {
    const { clientTransport, serverTransport } = createLoopbackTransports();
    const source = new LiveLogSource({ generation: 7 });
    source.append('hello');
    source.append(' world');
    const snapshotSpy = vi.spyOn(source, 'snapshot');

    const unsubscribeServe = serve(serverTransport, createController(source));
    const connection = connect(clientTransport);

    try {
      const snapshot = await connection.snapshot('log', {
        since: { generation: 7, offset: 6 },
      });

      expect(snapshot.data).toEqual({
        baseOffset: 6,
        text: 'world',
        truncated: false,
      });
      expect(snapshotSpy).toHaveBeenCalledWith({ since: { generation: 7, offset: 6 } });
    } finally {
      connection.dispose();
      unsubscribeServe();
    }
  });

  it('keeps old-style snapshots returning the full tail', async () => {
    const { clientTransport, serverTransport } = createLoopbackTransports();
    const source = new LiveLogSource({ generation: 7 });
    source.append('hello');
    const snapshotSpy = vi.spyOn(source, 'snapshot');

    const unsubscribeServe = serve(serverTransport, createController(source));
    const connection = connect(clientTransport);

    try {
      const snapshot = await connection.snapshot('log');

      expect(snapshot.data).toEqual({
        baseOffset: 0,
        text: 'hello',
        truncated: false,
      });
      expect(snapshotSpy).toHaveBeenCalledWith();
    } finally {
      connection.dispose();
      unsubscribeServe();
    }
  });

  it('returns the full tail when since is not a safe integer', async () => {
    const { clientTransport, serverTransport } = createLoopbackTransports();
    const source = new LiveLogSource({ generation: 7 });
    source.append('hello');
    const snapshotSpy = vi.spyOn(source, 'snapshot');

    const unsubscribeServe = serve(serverTransport, createController(source));
    const connection = connect(clientTransport);

    try {
      const snapshot = await connection.snapshot('log', {
        since: { generation: Number.MAX_SAFE_INTEGER + 1, offset: 0 },
      });

      expect(snapshot.data).toEqual({
        baseOffset: 0,
        text: 'hello',
        truncated: false,
      });
      expect(snapshotSpy).toHaveBeenCalledWith();
    } finally {
      connection.dispose();
      unsubscribeServe();
    }
  });

  it('returns the full tail when the server ignores since', async () => {
    const { clientTransport, serverTransport } = createLoopbackTransports();
    const source = new LiveLogSource({ generation: 7 });
    source.append('hello');
    const snapshot = vi.fn(async () => source.snapshot());
    const ignoringSource = { snapshot, subscribe: source.subscribe.bind(source) };

    const unsubscribeServe = serve(serverTransport, {
      call: vi.fn(),
      acquireLive: () => ({
        ready: async () => ignoringSource,
        release: async () => {},
      }),
    } as unknown as Controller);
    const connection = connect(clientTransport);

    try {
      const result = await connection.snapshot('log', {
        since: { generation: 7, offset: 999 },
      });

      expect(result.data).toEqual({
        baseOffset: 0,
        text: 'hello',
        truncated: false,
      });
      expect(snapshot).toHaveBeenCalled();
    } finally {
      connection.dispose();
      unsubscribeServe();
    }
  });
});
