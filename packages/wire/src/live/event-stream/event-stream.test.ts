import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { eventStream } from '../../api';
import { eventFromUpdate } from './client';
import { createEventStreamHost, EventStreamSource } from './server';

describe('EventStreamSource', () => {
  it('emits envelope-correct event updates while attached', () => {
    const source = new EventStreamSource<{ message: string }>({ generation: 1000 });
    const updates: unknown[] = [];
    source.subscribe((update) => updates.push(update));

    source.emit({ message: 'hello' });

    expect(updates).toEqual([
      {
        generation: 1000,
        baseSequence: 0,
        sequence: 1,
        timestamp: expect.any(Number),
        delta: { event: { message: 'hello' } },
      },
    ]);
    expect(eventFromUpdate<{ message: string }>(updates[0] as never)).toEqual({ message: 'hello' });
  });

  it('drops events when there are no subscribers', () => {
    const source = new EventStreamSource<{ message: string }>({ generation: 1000 });
    const updates: unknown[] = [];

    source.emit({ message: 'early' });
    source.subscribe((update) => updates.push(update));
    source.emit({ message: 'late' });

    expect(updates).toHaveLength(1);
    expect(eventFromUpdate<{ message: string }>(updates[0] as never)).toEqual({ message: 'late' });
    expect(source.snapshot().sequence).toBe(1);
  });
});

describe('createEventStreamHost', () => {
  const contract = eventStream({
    key: z.object({ id: z.string() }),
    event: z.object({ message: z.string() }),
  });

  it('isolates events by key', () => {
    const host = createEventStreamHost(contract);
    const first: unknown[] = [];
    const second: unknown[] = [];
    host.resolve({ id: 'first' }).subscribe((update) => first.push(eventFromUpdate(update)));
    host.resolve({ id: 'second' }).subscribe((update) => second.push(eventFromUpdate(update)));

    host.emit({ id: 'first' }, { message: 'one' });
    host.emit({ id: 'second' }, { message: 'two' });

    expect(first).toEqual([{ message: 'one' }]);
    expect(second).toEqual([{ message: 'two' }]);
  });

  it('drops idle sources after the last subscriber detaches', () => {
    const host = createEventStreamHost(contract);
    const source = host.resolve({ id: 'known' });
    const unsubscribe = source.subscribe(() => {});

    unsubscribe();

    expect(host.resolve({ id: 'known' })).not.toBe(source);
  });

  it('calls onEmpty when the last source subscriber detaches', () => {
    const onEmpty = vi.fn();
    const source = new EventStreamSource({ onEmpty });
    const unsubscribe = source.subscribe(() => {});

    unsubscribe();

    expect(onEmpty).toHaveBeenCalledOnce();
  });
});
