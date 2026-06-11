import type { Unsubscribe } from './lifecycle';

export class Emitter<T> {
  private readonly subscribers = new Set<(value: T) => void>();

  get size(): number {
    return this.subscribers.size;
  }

  emit(value: T): void {
    for (const subscriber of [...this.subscribers]) {
      subscriber(value);
    }
  }

  subscribe(cb: (value: T) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  clear(): void {
    this.subscribers.clear();
  }
}
