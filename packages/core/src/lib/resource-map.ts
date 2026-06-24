import { once } from '@emdash/shared';
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
 * - The last `release()` tears the value down; releases are single-flight: every caller
 *   awaits the same teardown completion.
 * - Acquiring a key that is tearing down waits for the teardown, then provisions fresh.
 * - `dispose()` refuses new acquires and resolves once no entries or teardowns remain.
 */
export class ResourceMap<T> implements IDisposable {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly teardowns = new Map<string, Promise<void>>();
  private idleWaiters: Array<() => void> = [];
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
      await this.releaseRef(key, entry);
      throw error;
    }
    return this.createLease(key, entry, value);
  }

  async dispose(): Promise<void> {
    this.disposeRequested = true;
    this.notifyIdle();
    await this.waitForIdle();
  }

  private createLease(key: string, entry: Entry<T>, value: T): Lease<T> {
    return { value, release: once(() => this.releaseRef(key, entry)) };
  }

  private releaseRef(key: string, entry: Entry<T>): Promise<void> {
    entry.refs -= 1;
    if (entry.refs > 0) return Promise.resolve();
    if (this.entries.get(key) !== entry) return Promise.resolve();
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
      this.notifyIdle();
    });
    this.teardowns.set(key, teardown);
    return teardown;
  }

  private async waitForIdle(): Promise<void> {
    if (this.idle) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private notifyIdle(): void {
    if (!this.idle) return;
    this.options.onEmpty?.();
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private assertOpen(): void {
    if (this.disposeRequested) throw new Error('ResourceMap disposed');
  }
}
