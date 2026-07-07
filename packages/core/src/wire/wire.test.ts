import { describe, expect, it, vi } from 'vitest';
import type { LiveUpdate } from '../live';
import { localWire } from './local';
import { portWire } from './port-client';
import type { PortLike, PortLikeMessageEvent } from './port-protocol';
import { serveWire } from './port-server';
import type { WireTransport } from './types';

class MemoryPort implements PortLike {
  peer: MemoryPort | null = null;
  private listeners = new Set<(event: PortLikeMessageEvent) => void>();

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      for (const listener of this.peer?.listeners ?? []) {
        listener({ data: message });
      }
    });
  }

  on(event: 'message', cb: (event: PortLikeMessageEvent) => void): void {
    if (event === 'message') this.listeners.add(cb);
  }
}

function createPortPair(): [MemoryPort, MemoryPort] {
  const first = new MemoryPort();
  const second = new MemoryPort();
  first.peer = second;
  second.peer = first;
  return [first, second];
}

function createTransport(port: MemoryPort): WireTransport & { disconnect(): void } {
  const messageListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  port.on('message', ({ data }) => {
    for (const listener of messageListeners) listener(data);
  });
  return {
    post: (message) => port.postMessage(message),
    onMessage: (cb) => {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onDisconnect: (cb) => {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
    disconnect: () => {
      for (const listener of disconnectListeners) listener();
    },
  };
}

describe('wire', () => {
  it('round-trips procedure calls over a port', async () => {
    const [clientPort, serverPort] = createPortPair();
    serveWire(
      serverPort,
      localWire(
        {
          echo: (input: { value: string }) => ({ value: input.value.toUpperCase() }),
        },
        () => null
      )
    );

    const wire = portWire(createTransport(clientPort));

    await expect(wire.procedures.call('echo', { value: 'hello' })).resolves.toEqual({
      value: 'HELLO',
    });
  });

  it('ignores non-wire messages on the same port', async () => {
    const [clientPort, serverPort] = createPortPair();
    const procedure = vi.fn((input: { value: number }) => input.value + 1);
    serveWire(
      serverPort,
      localWire({ next: procedure }, () => null)
    );
    serverPort.postMessage({ type: 'resolve-spawn-context-result', requestId: 'unrelated' });

    const wire = portWire(createTransport(clientPort));

    await expect(wire.procedures.call('next', { value: 1 })).resolves.toBe(2);
    expect(procedure).toHaveBeenCalledTimes(1);
  });

  it('streams live updates until the final subscriber detaches', async () => {
    const [clientPort, serverPort] = createPortPair();
    const subscribers = new Set<(update: LiveUpdate) => void>();
    const update: LiveUpdate = {
      generation: 1,
      baseSequence: 0,
      sequence: 1,
      timestamp: 1,
      delta: [],
    };
    const unsubscribe = vi.fn();
    serveWire(
      serverPort,
      localWire({}, (topic) =>
        topic === 'model'
          ? {
              snapshot: () => ({ generation: 1, sequence: 0, timestamp: 1, data: {} }),
              subscribe: (cb) => {
                subscribers.add(cb);
                return () => {
                  subscribers.delete(cb);
                  unsubscribe();
                };
              },
            }
          : null
      )
    );

    const wire = portWire(createTransport(clientPort));
    const first = vi.fn();
    const second = vi.fn();
    const detachFirst = await wire.live.attach('model', first);
    const detachSecond = await wire.live.attach('model', second);
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const subscriber of subscribers) subscriber(update);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(first).toHaveBeenCalledWith(update);
    expect(second).toHaveBeenCalledWith(update);
    detachFirst();
    expect(unsubscribe).not.toHaveBeenCalled();
    detachSecond();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rejects pending calls and reattaches live topics on disconnect', async () => {
    const [clientPort, serverPort] = createPortPair();
    const transport = createTransport(clientPort);
    const serverMessages: unknown[] = [];
    serverPort.on('message', ({ data }) => serverMessages.push(data));
    const wire = portWire(transport);

    const pending = wire.procedures.call('slow', {});
    await wire.live.attach('model', () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    transport.disconnect();

    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      serverMessages.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          (message as { kind?: unknown }).kind === 'wire-attach' &&
          (message as { topic?: unknown }).topic === 'model'
      )
    ).toBe(true);
  });
});
