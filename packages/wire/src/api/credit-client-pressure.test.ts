import { describe, expect, it, vi } from 'vitest';
import { LiveLogSource } from '../live/log/source';
import { createPressureSignal } from './channel';
import { createLiveClientHandle } from './client';
import { connect } from './connect';
import type { Controller } from './controller';
import type { WireMessage, WireTransport } from './protocol';
import { serve } from './serve';

function createInMemoryTransport() {
  let onMessage: ((message: WireMessage) => void) | undefined;
  const post = vi.fn();
  const transport = {
    post,
    onMessage(handler: (message: WireMessage) => void) {
      onMessage = handler;
      return () => {};
    },
    onDisconnect(_handler: () => void) {
      return () => {};
    },
  } as unknown as WireTransport;

  return {
    transport,
    post,
    send(message: WireMessage) {
      if (!onMessage) throw new Error('Wire transport is not listening');
      onMessage(message);
    },
  };
}

function createLinkedTransports(): {
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

async function waitFor(check: () => void, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - started >= timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

describe('credit gate backpressure end-to-end', () => {
  it('reports paused when credit is not granted, and resumes after credit is granted', async () => {
    const onPressureChange = vi.fn();
    const source = new LiveLogSource({ onPressureChange });
    const lease = {
      ready: async () => source,
      release: async () => {},
    };
    const controller = {
      acquireLive: (topic: string) => (topic === 'logs' ? lease : undefined),
    } as unknown as Controller;

    const { transport, post, send } = createInMemoryTransport();
    const unsubscribe = serve(transport, controller);

    try {
      send({
        kind: 'attach',
        id: 'attach-1',
        topic: 'logs',
        window: 1024,
      } as WireMessage);
      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'result', id: 'attach-1', ok: true })
        );
      });

      source.append('x'.repeat(300 * 1024));
      source.append('y'.repeat(300 * 1024));

      expect(onPressureChange).toHaveBeenCalledWith(true);

      send({
        kind: 'topic-credit',
        topic: 'logs',
        consumed: 1_000_000,
      } as WireMessage);

      expect(onPressureChange).toHaveBeenLastCalledWith(false);
    } finally {
      unsubscribe();
    }
  });

  it('relays topic-pressure into the subscribed source pressure', async () => {
    let subscribedPressure: { readonly paused: boolean } | undefined;
    const source = {
      subscribe: vi.fn(
        (_cb: (update: unknown) => void, options?: { pressure?: { readonly paused: boolean } }) => {
          subscribedPressure = options?.pressure;
          return () => {};
        }
      ),
    };
    const controller = {
      acquireLive: (topic: string) =>
        topic === 'logs' ? { ready: async () => source, release: async () => {} } : undefined,
    } as unknown as Controller;

    const { transport, post, send } = createInMemoryTransport();
    const unsubscribe = serve(transport, controller);

    try {
      send({ kind: 'attach', id: 'attach-pressure', topic: 'logs' } as WireMessage);
      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'result', id: 'attach-pressure', ok: true })
        );
        expect(subscribedPressure?.paused).toBe(false);
      });

      send({
        kind: 'topic-pressure',
        topic: 'logs',
        paused: true,
      } as WireMessage);
      await waitFor(() => {
        expect(subscribedPressure?.paused).toBe(true);
      });

      send({
        kind: 'topic-pressure',
        topic: 'logs',
        paused: false,
      } as WireMessage);
      await waitFor(() => {
        expect(subscribedPressure?.paused).toBe(false);
      });
    } finally {
      unsubscribe();
    }
  });

  it('combines the credit gate pressure with relayed topic-pressure', async () => {
    const onPressureChange = vi.fn();
    const source = new LiveLogSource({ onPressureChange });
    const lease = {
      ready: async () => source,
      release: async () => {},
    };
    const controller = {
      acquireLive: (topic: string) => (topic === 'logs' ? lease : undefined),
    } as unknown as Controller;

    const { transport, post, send } = createInMemoryTransport();
    const unsubscribe = serve(transport, controller);

    try {
      send({
        kind: 'attach',
        id: 'attach-combined',
        topic: 'logs',
        window: 1024,
      } as WireMessage);
      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'result', id: 'attach-combined', ok: true })
        );
      });

      send({ kind: 'topic-pressure', topic: 'logs', paused: true } as WireMessage);
      await waitFor(() => {
        expect(onPressureChange).toHaveBeenLastCalledWith(true);
      });

      source.append('x'.repeat(300 * 1024));
      source.append('y'.repeat(300 * 1024));
      await waitFor(() => {
        expect(onPressureChange).toHaveBeenLastCalledWith(true);
      });

      send({
        kind: 'topic-credit',
        topic: 'logs',
        consumed: 1_000_000,
      } as WireMessage);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onPressureChange).toHaveBeenLastCalledWith(true);

      send({ kind: 'topic-pressure', topic: 'logs', paused: false } as WireMessage);
      await waitFor(() => {
        expect(onPressureChange).toHaveBeenLastCalledWith(false);
      });
    } finally {
      unsubscribe();
    }
  });

  it('carries an outer subscriber pressure through a relayed live source', async () => {
    const onPressureChange = vi.fn();
    const workerSource = new LiveLogSource({ onPressureChange });
    const workerLease = {
      ready: async () => workerSource,
      release: async () => {},
    };
    const workerController = {
      acquireLive: (topic: string) => (topic === 'logs' ? workerLease : undefined),
    } as unknown as Controller;

    const workerPair = createLinkedTransports();
    const unsubscribeWorker = serve(workerPair.serverTransport, workerController);
    const middleConnection = connect(workerPair.clientTransport);
    const relaySource = createLiveClientHandle(middleConnection, 'logs').asLiveSource();

    const outerLease = {
      ready: async () => relaySource,
      release: async () => {},
    };
    const outerController = {
      acquireLive: (topic: string) => (topic === 'logs' ? outerLease : undefined),
    } as unknown as Controller;
    const outerPair = createLinkedTransports();
    const unsubscribeOuter = serve(outerPair.serverTransport, outerController);
    const outerConnection = connect(outerPair.clientTransport);

    try {
      const pressure = createPressureSignal();
      const detach = await outerConnection.attach('logs', () => {}, { pressure });

      pressure.set(true);
      await waitFor(() => {
        expect(onPressureChange).toHaveBeenCalledWith(true);
      });

      pressure.set(false);
      await waitFor(() => {
        expect(onPressureChange).toHaveBeenLastCalledWith(false);
      });

      detach();
    } finally {
      outerConnection.dispose();
      middleConnection.dispose();
      unsubscribeOuter();
      unsubscribeWorker();
    }
  });

  it('sees paused:true from an attach before any update or topic-pressure', async () => {
    let subscribedPressure: { readonly paused: boolean } | undefined;
    const source = {
      subscribe: vi.fn(
        (_cb: (update: unknown) => void, options?: { pressure?: { readonly paused: boolean } }) => {
          subscribedPressure = options?.pressure;
          return () => {};
        }
      ),
    };
    const controller = {
      acquireLive: (topic: string) =>
        topic === 'logs' ? { ready: async () => source, release: async () => {} } : undefined,
    } as unknown as Controller;

    const { transport, post, send } = createInMemoryTransport();
    const unsubscribe = serve(transport, controller);

    try {
      send({
        kind: 'attach',
        id: 'attach-paused-initial',
        topic: 'logs',
        paused: true,
      } as WireMessage);
      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'result', id: 'attach-paused-initial', ok: true })
        );
        expect(subscribedPressure?.paused).toBe(true);
      });
    } finally {
      unsubscribe();
    }
  });

  it('cleans up after an attach whose source never becomes ready', async () => {
    const lease = {
      ready: vi.fn(async () => {
        throw new Error('source not ready');
      }),
      release: vi.fn(async () => {}),
    };
    const controller = {
      acquireLive: (topic: string) => (topic === 'logs' ? lease : undefined),
    } as unknown as Controller;

    const { transport, post, send } = createInMemoryTransport();
    const unsubscribe = serve(transport, controller);

    try {
      send({ kind: 'attach', id: 'attach-failed-ready', topic: 'logs' } as WireMessage);
      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'result', id: 'attach-failed-ready', ok: false })
        );
      });
      await waitFor(() => {
        expect(lease.release).toHaveBeenCalled();
      });
    } finally {
      unsubscribe();
    }
  });

  it('cleans up when an attach is cancelled while its source is still becoming ready', async () => {
    let resolveReady: (() => void) | undefined;
    const lease = {
      ready: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveReady = resolve;
          })
      ),
      release: vi.fn(async () => {}),
    };
    const controller = {
      acquireLive: (topic: string) => (topic === 'logs' ? lease : undefined),
    } as unknown as Controller;

    const { transport, post, send } = createInMemoryTransport();
    const unsubscribe = serve(transport, controller);

    try {
      send({ kind: 'attach', id: 'attach-pending-ready', topic: 'logs' } as WireMessage);
      await waitFor(() => {
        expect(lease.ready).toHaveBeenCalled();
      });

      send({ kind: 'cancel', id: 'attach-pending-ready' } as WireMessage);
      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'result', id: 'attach-pending-ready', ok: false })
        );
        expect(lease.release).toHaveBeenCalled();
      });

      resolveReady?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      unsubscribe();
    }
  });

  it('does not subscribe when readiness fails', async () => {
    const subscribe = vi.fn(() => () => {});
    const lease = {
      ready: vi.fn(async () => {
        throw new Error('source not ready');
      }),
      release: vi.fn(async () => {}),
    };
    const controller = {
      acquireLive: (topic: string) => (topic === 'logs' ? lease : undefined),
    } as unknown as Controller;

    const { transport, post, send } = createInMemoryTransport();
    const unsubscribe = serve(transport, controller);

    try {
      send({ kind: 'attach', id: 'attach-failed-ready-subscribe', topic: 'logs' } as WireMessage);
      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'result',
            id: 'attach-failed-ready-subscribe',
            ok: false,
          })
        );
        expect(lease.release).toHaveBeenCalled();
      });
      expect(subscribe).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('does not subscribe when a cancelled readiness resolves late', async () => {
    let resolveReady: ((source: unknown) => void) | undefined;
    const subscribe = vi.fn(() => () => {});
    const source = { subscribe };
    const lease = {
      ready: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveReady = resolve;
          })
      ),
      release: vi.fn(async () => {}),
    };
    const controller = {
      acquireLive: (topic: string) => (topic === 'logs' ? lease : undefined),
    } as unknown as Controller;

    const { transport, post, send } = createInMemoryTransport();
    const unsubscribe = serve(transport, controller);

    try {
      send({ kind: 'attach', id: 'attach-pending-ready-subscribe', topic: 'logs' } as WireMessage);
      await waitFor(() => {
        expect(lease.ready).toHaveBeenCalled();
      });

      send({ kind: 'cancel', id: 'attach-pending-ready-subscribe' } as WireMessage);
      await waitFor(() => {
        expect(post).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'result',
            id: 'attach-pending-ready-subscribe',
            ok: false,
          })
        );
        expect(lease.release).toHaveBeenCalled();
      });

      resolveReady?.(source);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(subscribe).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
