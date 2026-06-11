import { describe, expect, it } from 'vitest';
import { Emitter } from './emitter';

describe('Emitter', () => {
  it('delivers values to all subscribers and supports unsubscribe', () => {
    const emitter = new Emitter<number>();
    const first: number[] = [];
    const second: number[] = [];

    const unsubFirst = emitter.subscribe((value) => first.push(value));
    emitter.subscribe((value) => second.push(value));
    expect(emitter.size).toBe(2);

    emitter.emit(1);
    unsubFirst();
    emitter.emit(2);

    expect(first).toEqual([1]);
    expect(second).toEqual([1, 2]);
    expect(emitter.size).toBe(1);
  });

  it('tolerates unsubscribe during emit', () => {
    const emitter = new Emitter<string>();
    const seen: string[] = [];
    const unsubscribe = emitter.subscribe(() => {
      unsubscribe();
    });
    emitter.subscribe((value) => seen.push(value));

    emitter.emit('a');
    emitter.emit('b');

    expect(seen).toEqual(['a', 'b']);
    expect(emitter.size).toBe(1);
  });

  it('clears all subscribers', () => {
    const emitter = new Emitter<number>();
    const seen: number[] = [];
    emitter.subscribe((value) => seen.push(value));

    emitter.clear();
    emitter.emit(1);

    expect(seen).toEqual([]);
    expect(emitter.size).toBe(0);
  });
});
