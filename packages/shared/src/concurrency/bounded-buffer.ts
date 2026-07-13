export type BoundedBufferOverflow = 'reject' | 'drop-oldest' | 'drop-newest';

export type BoundedBufferOfferResult<T> =
  | { kind: 'accepted' }
  | { kind: 'accepted'; dropped: T }
  | { kind: 'dropped'; value: T }
  | { kind: 'full' };

export type CreateBoundedBufferOptions<T> = {
  capacity: number;
  overflow: BoundedBufferOverflow;
  onDrop?: (value: T) => void;
};

export interface BoundedBuffer<T> {
  readonly capacity: number;
  readonly size: number;
  offer(value: T): BoundedBufferOfferResult<T>;
  take(): T | undefined;
  takeLast(): T | undefined;
  requeueFront(value: T): void;
  clear(): void;
  toArray(): T[];
}

export function createBoundedBuffer<T>(options: CreateBoundedBufferOptions<T>): BoundedBuffer<T> {
  return new BoundedBufferImpl(options);
}

class BoundedBufferImpl<T> implements BoundedBuffer<T> {
  private readonly slots: Array<T | undefined>;
  private readonly onDrop: ((value: T) => void) | undefined;
  private start = 0;
  private length = 0;

  constructor(private readonly options: CreateBoundedBufferOptions<T>) {
    this.slots = new Array(Math.max(0, Math.floor(options.capacity)));
    this.onDrop = options.onDrop;
  }

  get capacity(): number {
    return this.slots.length;
  }

  get size(): number {
    return this.length;
  }

  offer(value: T): BoundedBufferOfferResult<T> {
    if (this.capacity === 0) {
      this.onDrop?.(value);
      return this.options.overflow === 'drop-newest'
        ? { kind: 'dropped', value }
        : { kind: 'full' };
    }

    if (this.length < this.capacity) {
      this.pushBack(value);
      return { kind: 'accepted' };
    }

    switch (this.options.overflow) {
      case 'drop-oldest': {
        const dropped = this.slots[this.start] as T;
        this.slots[this.start] = value;
        this.start = (this.start + 1) % this.capacity;
        this.onDrop?.(dropped);
        return { kind: 'accepted', dropped };
      }
      case 'drop-newest':
        this.onDrop?.(value);
        return { kind: 'dropped', value };
      case 'reject':
        return { kind: 'full' };
    }
  }

  take(): T | undefined {
    if (this.length === 0 || this.capacity === 0) return undefined;
    const value = this.slots[this.start];
    this.slots[this.start] = undefined;
    this.start = (this.start + 1) % this.capacity;
    this.length -= 1;
    if (this.length === 0) this.start = 0;
    return value;
  }

  takeLast(): T | undefined {
    if (this.length === 0 || this.capacity === 0) return undefined;
    const index = this.indexOf(this.length - 1);
    const value = this.slots[index];
    this.slots[index] = undefined;
    this.length -= 1;
    if (this.length === 0) this.start = 0;
    return value;
  }

  requeueFront(value: T): void {
    if (this.capacity === 0 || this.length >= this.capacity) {
      throw new Error('BoundedBuffer is full');
    }
    this.start = (this.start - 1 + this.capacity) % this.capacity;
    this.slots[this.start] = value;
    this.length += 1;
  }

  clear(): void {
    for (let i = 0; i < this.length; i += 1) {
      this.slots[this.indexOf(i)] = undefined;
    }
    this.start = 0;
    this.length = 0;
  }

  toArray(): T[] {
    const values: T[] = [];
    for (let i = 0; i < this.length; i += 1) {
      values.push(this.slots[this.indexOf(i)] as T);
    }
    return values;
  }

  private pushBack(value: T): void {
    this.slots[this.indexOf(this.length)] = value;
    this.length += 1;
  }

  private indexOf(offset: number): number {
    return (this.start + offset) % this.capacity;
  }
}
