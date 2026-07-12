import { describe, expect, it, vi } from 'vitest';
import { createBoundedBuffer } from './bounded-buffer';

describe('createBoundedBuffer', () => {
  it('dequeues accepted values in FIFO order', () => {
    const buffer = createBoundedBuffer<number>({ capacity: 3, overflow: 'reject' });

    expect(buffer.offer(1)).toEqual({ kind: 'accepted' });
    expect(buffer.offer(2)).toEqual({ kind: 'accepted' });
    expect(buffer.offer(3)).toEqual({ kind: 'accepted' });

    expect(buffer.size).toBe(3);
    expect(buffer.take()).toBe(1);
    expect(buffer.take()).toBe(2);
    expect(buffer.take()).toBe(3);
    expect(buffer.take()).toBeUndefined();
  });

  it('rejects values at capacity with reject overflow', () => {
    const buffer = createBoundedBuffer<number>({ capacity: 1, overflow: 'reject' });

    expect(buffer.offer(1)).toEqual({ kind: 'accepted' });
    expect(buffer.offer(2)).toEqual({ kind: 'full' });
    expect(buffer.toArray()).toEqual([1]);
  });

  it('drops the oldest value with drop-oldest overflow', () => {
    const onDrop = vi.fn();
    const buffer = createBoundedBuffer<number>({ capacity: 2, overflow: 'drop-oldest', onDrop });

    buffer.offer(1);
    buffer.offer(2);
    expect(buffer.offer(3)).toEqual({ kind: 'accepted', dropped: 1 });

    expect(onDrop).toHaveBeenCalledWith(1);
    expect(buffer.toArray()).toEqual([2, 3]);
  });

  it('drops the newest value with drop-newest overflow', () => {
    const onDrop = vi.fn();
    const buffer = createBoundedBuffer<number>({ capacity: 2, overflow: 'drop-newest', onDrop });

    buffer.offer(1);
    buffer.offer(2);
    expect(buffer.offer(3)).toEqual({ kind: 'dropped', value: 3 });

    expect(onDrop).toHaveBeenCalledWith(3);
    expect(buffer.toArray()).toEqual([1, 2]);
  });

  it('supports zero capacity buffers', () => {
    const buffer = createBoundedBuffer<number>({ capacity: 0, overflow: 'reject' });

    expect(buffer.capacity).toBe(0);
    expect(buffer.offer(1)).toEqual({ kind: 'full' });
    expect(buffer.size).toBe(0);
    expect(buffer.take()).toBeUndefined();
  });

  it('requeues a value at the front after dequeue', () => {
    const buffer = createBoundedBuffer<string>({ capacity: 2, overflow: 'reject' });
    buffer.offer('first');
    buffer.offer('second');

    const first = buffer.take();
    expect(first).toBe('first');
    buffer.requeueFront(first as string);

    expect(buffer.take()).toBe('first');
    expect(buffer.take()).toBe('second');
  });

  it('clears buffered values', () => {
    const buffer = createBoundedBuffer<number>({ capacity: 2, overflow: 'reject' });
    buffer.offer(1);
    buffer.offer(2);

    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(buffer.toArray()).toEqual([]);
    expect(buffer.take()).toBeUndefined();
  });

  it('normalizes negative capacity to zero', () => {
    const buffer = createBoundedBuffer<number>({ capacity: -1, overflow: 'reject' });

    expect(buffer.capacity).toBe(0);
    expect(buffer.offer(1)).toEqual({ kind: 'full' });
  });
});
