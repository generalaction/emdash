import type { Unsubscribe } from '@emdash/shared';
import { deferred, waitFor } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { connect } from '../api/connect';
import { defineContract, eventStream, resourcedStream } from '../api/define';
import type { WireError } from '../api/protocol';
import { serve } from '../api/serve';
import { encodeTopic } from '../api/topics';
import { memoryTransportPair, reconnectingTransport } from '../api/transports';
import { createEventStreamHost, EventStreamSource } from '../live/event-stream';
import { createTestWire } from '../testing';
import { client } from './client';
import { createController } from './controller';

const contract = defineContract({
  events: eventStream({
    key: z.object({ id: z.string().trim() }),
    event: z.object({ message: z.string() }),
  }),
});

describe('eventStream API', () => {
  it('delivers events while attached and drops events emitted before attachment', async () => {
    const key = { id: 'known' };
    const host = createEventStreamHost(contract.events);
    const wire = createTestWire(contract, { events: host }, { validate: 'full' });
    const seen: Array<{ message: string }> = [];

    host.emit(key, { message: 'early' });
    const unsubscribe = await wire.client.events.subscribe(key, {
      onEvent: (event) => seen.push(event),
    });
    await waitFor(() => host.resolve(key).subscriberCount === 1);
    host.emit(key, { message: 'late' });
    await waitFor(() => seen.length === 1);

    try {
      expect(seen).toEqual([{ message: 'late' }]);
    } finally {
      unsubscribe();
      wire.dispose();
      host.dispose();
    }
  });

  it('signals a gap when an event stream reattaches after reconnect', async () => {
    const key = { id: 'known' };
    const host = createEventStreamHost(contract.events);
    const controller = createController(contract, { events: host });
    const pairs: ReturnType<typeof memoryTransportPair>[] = [];
    const serverDisposers: Unsubscribe[] = [];
    const transport = reconnectingTransport(async () => {
      const pair = memoryTransportPair();
      pairs.push(pair);
      serverDisposers.push(serve(pair.right, controller));
      return pair.left;
    });
    const contractClient = client(contract, connect(transport));
    const gaps: string[] = [];
    const seen: Array<{ message: string }> = [];
    const unsubscribe = await contractClient.events.subscribe(key, {
      onEvent: (event) => seen.push(event),
      onGap: () => gaps.push('gap'),
    });

    await waitFor(() => host.resolve(key).subscriberCount === 1);
    host.emit(key, { message: 'first' });
    await waitFor(() => seen.length === 1);
    expect(gaps).toEqual([]);

    pairs[0]?.disconnect();
    host.emit(key, { message: 'dropped' });
    await waitFor(() => pairs.length === 2);
    await waitFor(() => gaps.length === 1);
    await waitFor(() => host.resolve(key).subscriberCount === 1);
    host.emit(key, { message: 'second' });
    await waitFor(() => seen.length === 2);

    expect(seen).toEqual([{ message: 'first' }, { message: 'second' }]);
    unsubscribe();
    transport.close();
    for (const dispose of serverDisposers) dispose();
  });

  it('validates event stream keys before resolving topics', () => {
    const host = createEventStreamHost(contract.events);
    const wire = createTestWire(contract, { events: host }, { validate: 'inputs' });

    try {
      expect(() =>
        wire.controller.resolveLive(encodeTopic(contract.events.id, { id: 1 }))
      ).toThrow();
      expect(
        wire.controller.resolveLive(encodeTopic(contract.events.id, { id: ' known ' }))
      ).not.toBeNull();
    } finally {
      wire.dispose();
      host.dispose();
    }
  });

  it('rejects a bare resolver for a resourced event stream at bind time', () => {
    const resourcedContract = defineContract({
      events: resourcedStream({
        key: z.object({ id: z.string() }),
        event: z.object({ message: z.string() }),
      }),
    });

    expect(() =>
      createController(resourcedContract, {
        events: (() => new EventStreamSource()) as never,
      })
    ).toThrowError(expect.objectContaining<Partial<WireError>>({ code: 'CONTRACT_MISMATCH' }));
  });

  it('cancels a pending resourced attachment when the caller aborts', async () => {
    const resourcedContract = defineContract({
      events: resourcedStream({
        key: z.object({ id: z.string() }),
        event: z.object({ message: z.string() }),
      }),
    });
    const activation = deferred<Unsubscribe>();
    let activationSignal: AbortSignal | undefined;
    const host = createEventStreamHost(resourcedContract.events, {
      activate: (_key, signal) => {
        activationSignal = signal;
        return activation.promise;
      },
    });
    const wire = createTestWire(resourcedContract, { events: host });
    const controller = new AbortController();
    const attachment = wire.client.events
      .handle({ id: 'known' })
      .attach(() => {}, { signal: controller.signal });

    await waitFor(() => activationSignal !== undefined);
    controller.abort();

    await expect(attachment).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(activationSignal?.aborted).toBe(true);
    expect(host.resolve({ id: 'known' }).subscriberCount).toBe(0);

    const dispose = vi.fn();
    activation.resolve(dispose);
    await waitFor(() => dispose.mock.calls.length === 1);
    wire.dispose();
    host.dispose();
  });

  it('keeps shared pending activation alive when only one caller aborts', async () => {
    const resourcedContract = defineContract({
      events: resourcedStream({
        key: z.object({ id: z.string() }),
        event: z.object({ message: z.string() }),
      }),
    });
    const activation = deferred<Unsubscribe>();
    let activationSignal: AbortSignal | undefined;
    const dispose = vi.fn();
    const host = createEventStreamHost(resourcedContract.events, {
      activate: (_key, signal) => {
        activationSignal = signal;
        return activation.promise;
      },
    });
    const wire = createTestWire(resourcedContract, { events: host });
    const firstController = new AbortController();
    const first = wire.client.events
      .handle({ id: 'known' })
      .attach(() => {}, { signal: firstController.signal });
    const second = wire.client.events.handle({ id: 'known' }).attach(() => {});

    await waitFor(() => activationSignal !== undefined);
    firstController.abort();
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(activationSignal?.aborted).toBe(false);
    expect(host.resolve({ id: 'known' }).subscriberCount).toBe(1);

    activation.resolve(dispose);
    const detachSecond = await second;
    expect(dispose).not.toHaveBeenCalled();
    detachSecond();
    await waitFor(() => dispose.mock.calls.length === 1);

    wire.dispose();
    host.dispose();
  });
});
