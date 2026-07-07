import type { Lease, PendingLease } from '@emdash/shared';
import { toPendingLease } from '@emdash/shared';
import { createScope, type Scope } from './scope';

export interface ManagedSource<K, T> {
  acquire(key: K): PendingLease<T>;
  peek(key: K): T | undefined;
  dispose(): Promise<void>;
}

export type CreateManagedSourceOptions<K, T> = {
  key: (key: K) => string;
  create: (key: K, scope: Scope) => Promise<T>;
  graceMs?: number;
  onError?: (error: unknown, key: string) => void;
};

type Entry<K, T> = {
  key: K;
  keyId: string;
  scope: Scope;
  refCount: number;
  hasValue: boolean;
  value: T | undefined;
  createPromise: Promise<T> | undefined;
  disposePromise: Promise<void> | undefined;
  graceTimer: ReturnType<typeof setTimeout> | undefined;
};

export function createManagedSource<K, T>(
  options: CreateManagedSourceOptions<K, T>
): ManagedSource<K, T> {
  const entries = new Map<string, Entry<K, T>>();
  const graceMs = options.graceMs ?? 0;
  let disposed = false;

  return {
    acquire(key): PendingLease<T> {
      return toPendingLease(acquireLease(key));
    },
    peek(key): T | undefined {
      const entry = entries.get(options.key(key));
      return entry?.hasValue === true ? entry.value : undefined;
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const current = [...entries.values()];
      await Promise.all(current.map((entry) => disposeEntry(entry)));
      entries.clear();
    },
  };

  async function acquireLease(key: K): Promise<Lease<T>> {
    if (disposed) throw new Error('ManagedSource is disposed');

    const keyId = options.key(key);
    let entry = entries.get(keyId);
    if (entry?.disposePromise) {
      await entry.disposePromise;
      if (disposed) throw new Error('ManagedSource is disposed');
      entry = entries.get(keyId);
    }

    if (!entry) {
      entry = createEntry(key, keyId);
      entries.set(keyId, entry);
    }

    clearGraceTimer(entry);
    entry.refCount += 1;

    let released = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      await releaseEntry(entry);
    };

    try {
      const value = await ensureCreated(entry);
      return { value, release };
    } catch (error) {
      await release();
      throw error;
    }
  }

  function createEntry(key: K, keyId: string): Entry<K, T> {
    return {
      key,
      keyId,
      scope: createScope({ label: `managed-source:${keyId}` }),
      refCount: 0,
      hasValue: false,
      value: undefined,
      createPromise: undefined,
      disposePromise: undefined,
      graceTimer: undefined,
    };
  }

  function ensureCreated(entry: Entry<K, T>): Promise<T> {
    if (entry.hasValue) return Promise.resolve(entry.value as T);
    if (entry.createPromise) return entry.createPromise;

    entry.createPromise = options
      .create(entry.key, entry.scope)
      .then((value) => {
        entry.createPromise = undefined;
        if (disposed || entries.get(entry.keyId) !== entry || entry.scope.disposed) {
          throw new Error('ManagedSource entry was disposed during creation');
        }
        entry.hasValue = true;
        entry.value = value;
        if (entry.refCount === 0) scheduleDispose(entry);
        return value;
      })
      .catch(async (error: unknown) => {
        entry.createPromise = undefined;
        if (entries.get(entry.keyId) === entry) entries.delete(entry.keyId);
        options.onError?.(error, entry.keyId);
        await entry.scope.dispose();
        throw error;
      });

    return entry.createPromise;
  }

  function releaseEntry(entry: Entry<K, T>): Promise<void> {
    if (entries.get(entry.keyId) !== entry) return Promise.resolve();
    if (entry.refCount > 0) entry.refCount -= 1;
    if (entry.refCount > 0) return Promise.resolve();
    if (entry.createPromise && !entry.hasValue) return Promise.resolve();
    return scheduleDispose(entry);
  }

  function scheduleDispose(entry: Entry<K, T>): Promise<void> {
    if (entry.disposePromise || entries.get(entry.keyId) !== entry) return Promise.resolve();
    clearGraceTimer(entry);
    if (graceMs <= 0) {
      return disposeEntry(entry);
    }
    entry.graceTimer = setTimeout(() => {
      entry.graceTimer = undefined;
      void disposeEntry(entry);
    }, graceMs);
    return Promise.resolve();
  }

  async function disposeEntry(entry: Entry<K, T>): Promise<void> {
    if (entry.disposePromise) return entry.disposePromise;
    clearGraceTimer(entry);
    entry.disposePromise = entry.scope.dispose().finally(() => {
      if (entries.get(entry.keyId) === entry) entries.delete(entry.keyId);
    });
    return entry.disposePromise;
  }

  function clearGraceTimer(entry: Entry<K, T>): void {
    if (!entry.graceTimer) return;
    clearTimeout(entry.graceTimer);
    entry.graceTimer = undefined;
  }
}
