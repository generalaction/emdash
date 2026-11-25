import { describe, expect, it, vi } from 'vitest';
import type { Controller } from './controller';
import { isWireMessage, type WireMessage, type WireTransport } from './protocol';
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

function createController(): Controller {
  const source = {
    subscribe: vi.fn(() => () => {}),
  };

  return {
    call: vi.fn(),
    acquireLive: () => ({
      ready: async () => source,
      release: async () => {},
    }),
  } as unknown as Controller;
}

async function attach(
  clientTransport: WireTransport,
  message: WireMessage,
  id: string
): Promise<WireMessage> {
  const received: WireMessage[] = [];
  const unsubscribe = clientTransport.onMessage((incoming) => received.push(incoming));
  clientTransport.post(message);

  await vi.waitFor(() => {
    expect(received.some((incoming) => incoming.kind === 'result' && incoming.id === id)).toBe(
      true
    );
  });

  unsubscribe();
  return received.find((incoming) => incoming.kind === 'result' && incoming.id === id)!;
}

describe('credit protocol', () => {
  it('accepts valid topic-credit messages and rejects malformed ones', () => {
    expect(isWireMessage({ kind: 'topic-credit', topic: 'log', consumed: 10 })).toBe(true);
    expect(isWireMessage({ kind: 'topic-credit', consumed: 10 })).toBe(false);
    expect(isWireMessage({ kind: 'topic-credit', topic: 'log', consumed: -1 })).toBe(false);
    expect(isWireMessage({ kind: 'topic-credit', topic: 'log', consumed: 1.5 })).toBe(false);

    expect(isWireMessage({ kind: 'topic-pressure', topic: 'log', paused: true })).toBe(true);
    expect(isWireMessage({ kind: 'topic-pressure', topic: 'log', paused: 'true' })).toBe(false);
    expect(isWireMessage({ kind: 'topic-pressure', topic: 'log' })).toBe(false);
    expect(isWireMessage({ kind: 'topic-pressure', paused: true })).toBe(false);

    expect(isWireMessage({ kind: 'attach', id: 'a', topic: 'log', window: 4096 })).toBe(true);
    expect(isWireMessage({ kind: 'attach', id: 'a', topic: 'log', window: -1 })).toBe(false);
    expect(isWireMessage({ kind: 'attach', id: 'a', topic: 'log', paused: true })).toBe(true);
    expect(isWireMessage({ kind: 'attach', id: 'a', topic: 'log', paused: false })).toBe(false);
    expect(isWireMessage({ kind: 'attach', id: 'a', topic: 'log', paused: 'true' })).toBe(false);
  });

  it('replies to an attach without a window with the old undefined result', async () => {
    const { clientTransport, serverTransport } = createLoopbackTransports();
    const unsubscribeServe = serve(serverTransport, createController());

    try {
      const result = await attach(
        clientTransport,
        { kind: 'attach', id: 'attach-no-window', topic: 'log' },
        'attach-no-window'
      );

      expect(result).toEqual({
        kind: 'result',
        id: 'attach-no-window',
        ok: true,
        value: undefined,
      });
    } finally {
      unsubscribeServe();
    }
  });

  it('replies to an attach with a window with the offered window', async () => {
    const { clientTransport, serverTransport } = createLoopbackTransports();
    const unsubscribeServe = serve(serverTransport, createController());

    try {
      const result = await attach(
        clientTransport,
        { kind: 'attach', id: 'attach-window', topic: 'log', window: 4096 },
        'attach-window'
      );

      expect(result).toEqual({
        kind: 'result',
        id: 'attach-window',
        ok: true,
        value: { window: 4096 },
      });
    } finally {
      unsubscribeServe();
    }
  });

  it('drops unknown message kinds', async () => {
    const { clientTransport, serverTransport } = createLoopbackTransports();
    const unsubscribeServe = serve(serverTransport, createController());
    const received: WireMessage[] = [];
    const unsubscribeMessage = clientTransport.onMessage((message) => received.push(message));

    try {
      clientTransport.post({ kind: 'made-up' } as unknown as WireMessage);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(received).toEqual([]);
    } finally {
      unsubscribeMessage();
      unsubscribeServe();
    }
  });
});
