import { describe, expect, it, vi } from 'vitest';
import { anyPressure, createPressureSignal } from './channel';
import { connect } from './connect';
import type { Controller } from './controller';
import type { WireMessage, WireTransport } from './protocol';
import { serve } from './serve';

function createMockTransport(
  options: { reconnectable?: boolean; failPost?: (message: WireMessage) => boolean } = {}
) {
  const messageHandlers = new Set<(message: WireMessage) => void>();
  const reconnectHandlers = new Set<() => void>();
  const posted: WireMessage[] = [];

  const transport = {
    post(message: WireMessage) {
      if (options.failPost?.(message)) throw new Error('Wire transport post failed');
      posted.push(message);
    },
    onMessage(handler: (message: WireMessage) => void) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onDisconnect() {
      return () => {};
    },
    ...(options.reconnectable
      ? {
          onReconnect(handler: () => void) {
            reconnectHandlers.add(handler);
            return () => reconnectHandlers.delete(handler);
          },
        }
      : {}),
  } as unknown as WireTransport;

  return {
    transport,
    posted,
    deliver(message: WireMessage) {
      for (const handler of messageHandlers) handler(message);
    },
    reconnect() {
      for (const handler of reconnectHandlers) handler();
    },
  };
}

function createReconnectingLoopback() {
  const clientHandlers = new Set<(message: WireMessage) => void>();
  const serverHandlers = new Set<(message: WireMessage) => void>();
  const reconnectHandlers = new Set<() => void>();
  const serverReceived: WireMessage[] = [];
  let failPost: ((message: WireMessage) => boolean) | undefined;

  const clientTransport: WireTransport = {
    post(message) {
      if (failPost?.(message)) throw new Error('Wire transport post failed');
      serverReceived.push(message);
      for (const handler of serverHandlers) handler(message);
    },
    onMessage(handler) {
      clientHandlers.add(handler);
      return () => clientHandlers.delete(handler);
    },
    onDisconnect() {
      return () => {};
    },
    onReconnect(handler) {
      reconnectHandlers.add(handler);
      return () => reconnectHandlers.delete(handler);
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

  return {
    clientTransport,
    serverTransport,
    serverReceived,
    reconnect() {
      for (const handler of reconnectHandlers) handler();
    },
    setFailPost(next: ((message: WireMessage) => boolean) | undefined) {
      failPost = next;
    },
  };
}

function takeAttach(posted: WireMessage[]): Extract<WireMessage, { kind: 'attach' }> {
  const message = posted.find((message) => message.kind === 'attach');
  if (!message) throw new Error('Expected an attach message');
  return message as Extract<WireMessage, { kind: 'attach' }>;
}

async function establishAttach(
  mock: ReturnType<typeof createMockTransport>,
  topic: string,
  pressure = createPressureSignal()
) {
  const connection = connect(mock.transport);
  const attach = connection.attach(topic, () => {}, { pressure });
  await vi.waitFor(() => {
    expect(mock.posted.some((message) => message.kind === 'attach')).toBe(true);
  });
  const message = takeAttach(mock.posted);
  mock.deliver({ kind: 'result', id: message.id, ok: true, value: undefined });
  const detach = await attach;
  return { connection, detach, attachId: message.id };
}

describe('connect topic pressure', () => {
  it('posts topic-pressure whenever the pressure signal changes and stops after detach', async () => {
    const mock = createMockTransport();
    const pressure = createPressureSignal();
    const { detach, attachId } = await establishAttach(mock, 'logs', pressure);

    mock.posted.length = 0;
    pressure.set(true);
    expect(mock.posted).toEqual([
      { kind: 'topic-pressure', topic: 'logs', attachId, paused: true },
    ]);

    mock.posted.length = 0;
    pressure.set(false);
    expect(mock.posted).toEqual([
      { kind: 'topic-pressure', topic: 'logs', attachId, paused: false },
    ]);

    detach();
    mock.posted.length = 0;
    pressure.set(true);
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([]);
  });

  it('posts the current state once after attach when already paused', async () => {
    const mock = createMockTransport();
    const pressure = createPressureSignal();
    pressure.set(true);
    const { attachId } = await establishAttach(mock, 'logs', pressure);

    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([
      { kind: 'topic-pressure', topic: 'logs', attachId, paused: true },
    ]);
  });

  it('posts the current state again after reattach', async () => {
    const mock = createMockTransport({ reconnectable: true });
    const pressure = createPressureSignal();
    pressure.set(true);
    await establishAttach(mock, 'logs', pressure);

    mock.posted.length = 0;
    mock.reconnect();
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'attach')).toBe(true);
    });
    const reattach = takeAttach(mock.posted);
    mock.deliver({ kind: 'result', id: reattach.id, ok: true, value: undefined });
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'topic-pressure')).toBe(true);
    });
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([
      { kind: 'topic-pressure', topic: 'logs', attachId: reattach.id, paused: true },
    ]);
  });

  it('does not post topic-pressure when no pressure signal is provided', async () => {
    const mock = createMockTransport();
    const connection = connect(mock.transport);
    const attach = connection.attach('logs', () => {});
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'attach')).toBe(true);
    });
    const message = takeAttach(mock.posted);
    mock.deliver({ kind: 'result', id: message.id, ok: true, value: undefined });
    await attach;

    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([]);
  });

  it('shares pressure state across subscribers on one topic', async () => {
    const mock = createMockTransport();
    const connection = connect(mock.transport);
    const a = createPressureSignal();
    const b = createPressureSignal();

    const attachA = connection.attach('logs', () => {}, { pressure: a });
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'attach')).toBe(true);
    });
    const attachMessage = takeAttach(mock.posted);
    mock.deliver({ kind: 'result', id: attachMessage.id, ok: true, value: undefined });
    const detachA = await attachA;

    await connection.attach('logs', () => {}, { pressure: b });

    mock.posted.length = 0;
    a.set(true);
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([
      { kind: 'topic-pressure', topic: 'logs', attachId: attachMessage.id, paused: true },
    ]);

    mock.posted.length = 0;
    detachA();
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([
      { kind: 'topic-pressure', topic: 'logs', attachId: attachMessage.id, paused: false },
    ]);
  });

  it('keeps a topic paused when the unpaused subscriber detaches', async () => {
    const mock = createMockTransport();
    const connection = connect(mock.transport);
    const a = createPressureSignal();
    a.set(true);
    const b = createPressureSignal();

    const attachA = connection.attach('logs', () => {}, { pressure: a });
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'attach')).toBe(true);
    });
    const attachMessage = takeAttach(mock.posted);
    mock.deliver({ kind: 'result', id: attachMessage.id, ok: true, value: undefined });
    await attachA;

    const attachB = connection.attach('logs', () => {}, { pressure: b });
    const detachB = await attachB;

    mock.posted.length = 0;
    detachB();
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).not.toContainEqual({
      kind: 'topic-pressure',
      topic: 'logs',
      attachId: attachMessage.id,
      paused: false,
    });
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([
      { kind: 'topic-pressure', topic: 'logs', attachId: attachMessage.id, paused: true },
    ]);
  });

  it('retries a failed paused:false post after reconnect', async () => {
    let failNextFalse = true;
    const mock = createMockTransport({
      reconnectable: true,
      failPost: (message) => {
        if (message.kind === 'topic-pressure' && message.paused === false && failNextFalse) {
          failNextFalse = false;
          return true;
        }
        return false;
      },
    });
    const connection = connect(mock.transport);
    const pressure = createPressureSignal();

    const attach = connection.attach('logs', () => {}, { pressure });
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'attach')).toBe(true);
    });
    const attachMessage = takeAttach(mock.posted);
    mock.deliver({ kind: 'result', id: attachMessage.id, ok: true, value: undefined });
    await attach;

    mock.posted.length = 0;
    pressure.set(true);
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([
      { kind: 'topic-pressure', topic: 'logs', attachId: attachMessage.id, paused: true },
    ]);

    mock.posted.length = 0;
    pressure.set(false);
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([]);

    mock.reconnect();
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'attach')).toBe(true);
    });
    const reattach = takeAttach(mock.posted);
    expect(reattach.paused).toBeUndefined();
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([]);
    mock.deliver({ kind: 'result', id: reattach.id, ok: true, value: undefined });
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'topic-pressure')).toBe(true);
    });
    expect(mock.posted.filter((message) => message.kind === 'topic-pressure')).toEqual([
      { kind: 'topic-pressure', topic: 'logs', attachId: reattach.id, paused: false },
    ]);
  });

  it('carries paused:true on attach when the pressure is already paused', async () => {
    const mock = createMockTransport({ reconnectable: true });
    const pressure = createPressureSignal();
    pressure.set(true);

    const connection = connect(mock.transport);
    const attach = connection.attach('logs', () => {}, { pressure });
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'attach')).toBe(true);
    });
    const attachMessage = takeAttach(mock.posted);
    expect(attachMessage.paused).toBe(true);
    mock.deliver({ kind: 'result', id: attachMessage.id, ok: true, value: undefined });
    await attach;

    mock.posted.length = 0;
    mock.reconnect();
    await vi.waitFor(() => {
      expect(mock.posted.some((message) => message.kind === 'attach')).toBe(true);
    });
    expect(takeAttach(mock.posted).paused).toBe(true);
  });

  it('owes detach and unpause when the final posts fail, then reposts them on reconnect', async () => {
    const loop = createReconnectingLoopback();
    let unsubscribed = false;
    const source = {
      subscribe: vi.fn(() => () => {
        unsubscribed = true;
      }),
    };
    const lease = {
      ready: async () => source,
      release: vi.fn(async () => {}),
    };
    const controller = {
      acquireLive: (topic: string) => (topic === 'logs' ? lease : undefined),
    } as unknown as Controller;

    const unsubscribeServe = serve(loop.serverTransport, controller);
    const connection = connect(loop.clientTransport);
    try {
      const pressure = createPressureSignal();
      pressure.set(true);
      const detach = await connection.attach('logs', () => {}, { pressure });
      await vi.waitFor(() => {
        expect(source.subscribe).toHaveBeenCalled();
      });

      let failedUnpause = false;
      let failedDetach = false;
      loop.setFailPost((message) => {
        if (message.kind === 'topic-pressure' && message.paused === false && !failedUnpause) {
          failedUnpause = true;
          return true;
        }
        if (message.kind === 'detach' && !failedDetach) {
          failedDetach = true;
          return true;
        }
        return false;
      });

      detach();
      expect(failedUnpause).toBe(true);
      expect(failedDetach).toBe(true);

      loop.setFailPost(undefined);
      loop.serverReceived.length = 0;
      loop.reconnect();

      await vi.waitFor(() => {
        expect(
          loop.serverReceived.some(
            (message) =>
              message.kind === 'topic-pressure' &&
              message.topic === 'logs' &&
              message.paused === false
          )
        ).toBe(true);
        expect(
          loop.serverReceived.some(
            (message) => message.kind === 'detach' && message.topic === 'logs'
          )
        ).toBe(true);
      });
      await vi.waitFor(() => {
        expect(unsubscribed).toBe(true);
      });
    } finally {
      connection.dispose();
      unsubscribeServe();
    }
  });

  it('a later attach of the same topic clears its owed detach', async () => {
    const loop = createReconnectingLoopback();
    const source = {
      subscribe: vi.fn(() => () => {}),
    };
    const lease = {
      ready: async () => source,
      release: vi.fn(async () => {}),
    };
    const controller = {
      acquireLive: (topic: string) => (topic === 'logs' ? lease : undefined),
    } as unknown as Controller;

    const unsubscribeServe = serve(loop.serverTransport, controller);
    const connection = connect(loop.clientTransport);
    try {
      const pressure = createPressureSignal();
      pressure.set(true);
      const detach = await connection.attach('logs', () => {}, { pressure });
      await vi.waitFor(() => {
        expect(source.subscribe).toHaveBeenCalled();
      });

      let failedUnpause = false;
      let failedDetach = false;
      loop.setFailPost((message) => {
        if (message.kind === 'topic-pressure' && message.paused === false && !failedUnpause) {
          failedUnpause = true;
          return true;
        }
        if (message.kind === 'detach' && !failedDetach) {
          failedDetach = true;
          return true;
        }
        return false;
      });

      detach();
      expect(failedUnpause).toBe(true);
      expect(failedDetach).toBe(true);

      loop.setFailPost(undefined);
      await connection.attach('logs', () => {});
      loop.serverReceived.length = 0;
      loop.reconnect();

      await vi.waitFor(() => {
        expect(loop.serverReceived.some((message) => message.kind === 'attach')).toBe(true);
      });
      expect(loop.serverReceived.some((message) => message.kind === 'detach')).toBe(false);
    } finally {
      connection.dispose();
      unsubscribeServe();
    }
  });

  it('drops the attachment locally when last detach posts fail and does not reattach to a fresh server session', async () => {
    const loop = createReconnectingLoopback();
    const source = {
      subscribe: vi.fn(() => () => {}),
    };
    const lease = {
      ready: async () => source,
      release: vi.fn(async () => {}),
    };
    const controller = {
      acquireLive: (topic: string) => (topic === 'logs' ? lease : undefined),
    } as unknown as Controller;

    let unsubscribeServe = serve(loop.serverTransport, controller);
    const connection = connect(loop.clientTransport);
    const pressure = createPressureSignal();
    pressure.set(true);
    const detach = await connection.attach('logs', () => {}, { pressure });
    await vi.waitFor(() => {
      expect(source.subscribe).toHaveBeenCalled();
    });

    let failedUnpause = false;
    let failedDetach = false;
    loop.setFailPost((message) => {
      if (message.kind === 'topic-pressure' && message.paused === false && !failedUnpause) {
        failedUnpause = true;
        return true;
      }
      if (message.kind === 'detach' && !failedDetach) {
        failedDetach = true;
        return true;
      }
      return false;
    });

    detach();
    expect(failedUnpause).toBe(true);
    expect(failedDetach).toBe(true);

    // The failed posts mean the previous server session is gone; a reconnect
    // starts against a fresh session with no attachment or pressure state.
    unsubscribeServe();
    const freshServerMessages: WireMessage[] = [];
    const unsubscribeFreshSpy = loop.serverTransport.onMessage((message) => {
      freshServerMessages.push(message);
    });
    const freshAcquireLive = vi.fn((topic: string) => (topic === 'logs' ? lease : undefined));
    const freshController = {
      acquireLive: freshAcquireLive,
    } as unknown as Controller;
    unsubscribeServe = serve(loop.serverTransport, freshController);

    loop.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));

    unsubscribeFreshSpy();
    expect(freshServerMessages.filter((message) => message.kind === 'attach')).toEqual([]);
    expect(freshAcquireLive).not.toHaveBeenCalled();
    unsubscribeServe();
  });
});

describe('anyPressure', () => {
  it('removes listeners from every source on dispose', () => {
    const a = createPressureSignal();
    const b = createPressureSignal();
    const combined = anyPressure(a, b);
    const observed: boolean[] = [];
    const unsubscribe = combined.onChange((paused) => observed.push(paused));

    a.set(true);
    expect(observed).toEqual([true]);

    // Disposing a paused combination unpauses it once; later source changes reach nobody.
    combined.dispose();
    a.set(false);
    b.set(true);
    expect(observed).toEqual([true, false]);
    expect(combined.paused).toBe(false);

    const late = vi.fn();
    const lateOff = combined.onChange(late);
    a.set(true);
    b.set(false);
    expect(late).not.toHaveBeenCalled();
    lateOff();
    unsubscribe();
  });
});
