import { describe, expect, it, vi } from 'vitest';
import { createBoundedBuffer } from './bounded-buffer';

describe('createBoundedBuffer', () => {
  describe('ownership loss contract', () => {
    it('fires onDrop exactly once for the value evicted by drop-oldest overflow', () => {
      const onDrop = vi.fn();
      const buffer = createBoundedBuffer<string>({ capacity: 2, overflow: 'drop-oldest', onDrop });

      buffer.offer('a');
      buffer.offer('b');
      const result = buffer.offer('c');

      expect(result).toEqual({ kind: 'accepted', dropped: 'a' });
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith('a');
      expect(buffer.toArray()).toEqual(['b', 'c']);
    });

    it('fires onDrop exactly once for the value discarded by drop-newest overflow', () => {
      const onDrop = vi.fn();
      const buffer = createBoundedBuffer<string>({ capacity: 1, overflow: 'drop-newest', onDrop });

      buffer.offer('a');
      const result = buffer.offer('b');

      expect(result).toEqual({ kind: 'dropped', value: 'b' });
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith('b');
    });

    it('never fires onDrop on reject at capacity > 0 — the caller keeps the value', () => {
      const onDrop = vi.fn();
      const buffer = createBoundedBuffer<string>({ capacity: 1, overflow: 'reject', onDrop });

      buffer.offer('a');
      const result = buffer.offer('b');

      expect(result).toEqual({ kind: 'full' });
      expect(onDrop).not.toHaveBeenCalled();
    });

    it('never fires onDrop on reject at capacity 0 — the caller keeps the value', () => {
      const onDrop = vi.fn();
      const buffer = createBoundedBuffer<string>({ capacity: 0, overflow: 'reject', onDrop });

      const result = buffer.offer('a');

      expect(result).toEqual({ kind: 'full' });
      expect(onDrop).not.toHaveBeenCalled();
    });

    it('fires onDrop on drop-newest at capacity 0 — the buffer took responsibility and dropped', () => {
      const onDrop = vi.fn();
      const buffer = createBoundedBuffer<string>({ capacity: 0, overflow: 'drop-newest', onDrop });

      const result = buffer.offer('a');

      expect(result).toEqual({ kind: 'dropped', value: 'a' });
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith('a');
    });

    it('drains every buffered value through onDrop exactly once on clear()', () => {
      const onDrop = vi.fn();
      const buffer = createBoundedBuffer<string>({ capacity: 3, overflow: 'reject', onDrop });

      buffer.offer('a');
      buffer.offer('b');
      buffer.offer('c');
      buffer.clear();

      expect(onDrop).toHaveBeenCalledTimes(3);
      expect(onDrop.mock.calls.map(([value]) => value)).toEqual(['a', 'b', 'c']);
      expect(buffer.size).toBe(0);

      buffer.clear();
      expect(onDrop).toHaveBeenCalledTimes(3);
    });

    it('does not fire onDrop for values handed to the consumer via take()', () => {
      const onDrop = vi.fn();
      const buffer = createBoundedBuffer<string>({ capacity: 2, overflow: 'reject', onDrop });

      buffer.offer('a');
      expect(buffer.take()).toBe('a');
      buffer.clear();

      expect(onDrop).not.toHaveBeenCalled();
    });
  });

  describe('offer(undefined)', () => {
    it('throws with a clear message', () => {
      const buffer = createBoundedBuffer<string | undefined>({ capacity: 2, overflow: 'reject' });

      expect(() => buffer.offer(undefined)).toThrow(/undefined/);
      expect(buffer.size).toBe(0);
    });
  });
});
