import type { IDisposable, Lease } from '@emdash/shared';

export type ResourceMapOptions<T> = {
  /** Tears down a provisioned value after its last lease is released. */
  teardown: (key: string, value: T) => void | Promise<void>;
  /** Receives teardown failures (provision failures propagate to acquirers). */
  onError?: (context: string, error: unknown) => void;
  /** Fired whenever the map becomes empty (no entries, no in-flight teardowns). */
  onEmpty?: () => void;
};

type Entry<T> = {
  refs: number;
  promise: Promise<T>;
};

/**
 * Keyed, ref-counted async resources with single-flight provisioning.
 *
 * - Concurrent `acquire`s of the same key share one provision; each gets its own lease.
 * - A failed provision rejects every waiting acquirer and evicts the entry.
 * - The last `release()` tears the value down; releases are idempotent and concurrency-safe.
 * - Acquiring a key that is tearing down waits for the teardown, then provisions fresh.
 * - `dispose()` refuses new acquires; teardown still happens when the last lease releases.
 */
export class ResourceMap<T> implements IDisposable {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly teardowns = new Map<string, Promise<void>>();
  private disposeRequested = false;

  constructor(private readonly options: ResourceMapOptions<T>) {}

  get size(): number {
    return this.entries.size;
  }

  get idle(): boolean {
    return this.entries.size === 0 && this.teardowns.size === 0;
  }

  async acquire(key: string, provision: () => Promise<T>): Promise<Lease<T>> {
    this.assertOpen();
    while (this.teardowns.has(key)) {
      await this.teardowns.get(key);
      this.assertOpen();
    }

    let entry = this.entries.get(key);
    if (!entry) {
      entry = { refs: 0, promise: provision() };
      entry.promise.catch(() => {});
      this.entries.set(key, entry);
    }
    entry.refs += 1;

    let value: T;
    try {
      value = await entry.promise;
    } catch (error) {
      this.releaseRef(key, entry);
      throw error;
    }
    return this.createLease(key, entry, value);
  }

  dispose(): void {
    this.disposeRequested = true;
    if (this.idle) this.options.onEmpty?.();
  }

  private createLease(key: string, entry: Entry<T>, value: T): Lease<T> {
    let released = false;
    return {
      value,
      release: () => {
        if (released) return;
        released = true;
        this.releaseRef(key, entry);
      },
    };
  }

  private releaseRef(key: string, entry: Entry<T>): void {
    entry.refs -= 1;
    if (entry.refs > 0) return;
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);

    const teardown = (async () => {
      let value: T;
      try {
        value = await entry.promise;
      } catch {
        return;
      }
      try {
        await this.options.teardown(key, value);
      } catch (error) {
        this.options.onError?.(`teardown ${key}`, error);
      }
    })().finally(() => {
      this.teardowns.delete(key);
      if (this.idle) this.options.onEmpty?.();
    });
    this.teardowns.set(key, teardown);
  }

  private assertOpen(): void {
    if (this.disposeRequested) throw new Error('ResourceMap disposed');
  }
}
