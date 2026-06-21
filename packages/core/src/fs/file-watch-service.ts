import type { IDisposable } from '@emdash/shared';
import { ResourceMap } from '../lib';
import { NativeWatch } from './native-watch';
import { realpathOrResolve } from './paths';
import type { FileWatchOptions, IFileWatchService, RawFileEvent, WatchHandle } from './types';

export type FileWatchServiceOptions = {
  /** Receives background failures (resubscribe attempts, teardown). */
  onError?: (context: string, error: unknown) => void;
};

type WatchConsumer = {
  onEvents: (events: RawFileEvent[]) => void;
  onResync?: () => void;
  debounceMs: number;
  pending: RawFileEvent[];
  timer: ReturnType<typeof setTimeout> | null;
};

function normalizeIgnore(ignore: string[] | undefined): string[] {
  return [...(ignore ?? [])].sort();
}

function watchKey(root: string, ignore: string[]): string {
  return JSON.stringify({ root, ignore });
}

export class FileWatchService implements IFileWatchService, IDisposable {
  private readonly consumers = new Map<string, Set<WatchConsumer>>();
  private readonly natives = new Map<string, NativeWatch>();
  private readonly subscriptions: ResourceMap<NativeWatch>;
  private readonly onError: (context: string, error: unknown) => void;
  private disposed = false;

  constructor(options: FileWatchServiceOptions = {}) {
    this.onError = options.onError ?? (() => {});
    this.subscriptions = new ResourceMap<NativeWatch>({
      teardown: async (key, native) => {
        this.natives.delete(key);
        await native.dispose();
      },
      onError: this.onError,
    });
  }

  watch(
    root: string,
    onEvents: (events: RawFileEvent[]) => void,
    options: FileWatchOptions = {}
  ): WatchHandle {
    if (this.disposed) throw new Error('FileWatchService disposed');
    const normalizedRoot = realpathOrResolve(root);
    const ignore = normalizeIgnore(options.ignore);
    const key = watchKey(normalizedRoot, ignore);

    const consumer: WatchConsumer = {
      onEvents,
      onResync: options.onResync,
      debounceMs: options.debounceMs ?? 0,
      pending: [],
      timer: null,
    };
    let consumerSet = this.consumers.get(key);
    if (!consumerSet) {
      consumerSet = new Set();
      this.consumers.set(key, consumerSet);
    }
    consumerSet.add(consumer);

    const lease = this.subscriptions.acquire(key, async () => {
      const native = new NativeWatch(
        normalizedRoot,
        ignore,
        (events) => this.deliver(key, events),
        () => this.resyncConsumers(key),
        this.onError
      );
      try {
        await native.ready();
      } catch (error) {
        await native.dispose();
        throw error;
      }
      this.natives.set(key, native);
      return native;
    });
    lease.catch(() => {});

    let closed = false;
    return {
      ready: async () => {
        await lease;
      },
      release: () => {
        if (closed) return;
        closed = true;
        this.removeConsumer(key, consumer);
        void lease.then((acquired) => acquired.release()).catch(() => {});
      },
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.subscriptions.dispose();
    for (const consumerSet of this.consumers.values()) {
      for (const consumer of consumerSet) clearConsumer(consumer);
    }
    this.consumers.clear();
    const natives = [...this.natives.values()];
    this.natives.clear();
    await Promise.all(natives.map((native) => native.dispose()));
  }

  private deliver(key: string, events: RawFileEvent[]): void {
    const consumerSet = this.consumers.get(key);
    if (!consumerSet) return;
    for (const consumer of consumerSet) {
      deliverEvents(consumer, events);
    }
  }

  private resyncConsumers(key: string): void {
    const consumerSet = this.consumers.get(key);
    if (!consumerSet) return;
    for (const consumer of consumerSet) {
      consumer.onResync?.();
    }
  }

  private removeConsumer(key: string, consumer: WatchConsumer): void {
    const consumerSet = this.consumers.get(key);
    if (!consumerSet) return;
    consumerSet.delete(consumer);
    clearConsumer(consumer);
    if (consumerSet.size === 0) this.consumers.delete(key);
  }
}

function deliverEvents(consumer: WatchConsumer, events: RawFileEvent[]): void {
  if (consumer.debounceMs <= 0) {
    consumer.onEvents(events);
    return;
  }
  consumer.pending.push(...events);
  if (consumer.timer) return;
  consumer.timer = setTimeout(() => {
    consumer.timer = null;
    const pending = consumer.pending;
    consumer.pending = [];
    if (pending.length > 0) consumer.onEvents(pending);
  }, consumer.debounceMs);
}

function clearConsumer(consumer: WatchConsumer): void {
  if (consumer.timer) clearTimeout(consumer.timer);
  consumer.timer = null;
  consumer.pending = [];
}
