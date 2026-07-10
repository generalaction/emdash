import type { Lease, PendingLease, Result } from '@emdash/shared';
import { err, ok, toPendingLease } from '@emdash/shared';
import { createScope, type Scope } from './scope';

export interface ManagedSource<K, T, C = void> {
  acquire(key: K): PendingLease<T>;
  acquire(key: K, context: C): PendingLease<T>;
  peek(key: K): T | undefined;
  invalidate(key: K): Promise<void>;
  dispose(): Promise<void>;
}

type CreateManagedSourceOptionsBase<K> = {
  key: (key: K) => string;
  scope?: Scope;
  label?: string;
  graceMs?: number;
  onError?: (error: unknown, key: string) => void;
};

export type CreateManagedSourceOptions<K, T, C = void> = [C] extends [void]
  ? CreateManagedSourceOptionsBase<K> & {
      create: (key: K, scope: Scope) => Promise<T>;
    }
  : CreateManagedSourceOptionsBase<K> & {
      create: (key: K, context: C, scope: Scope) => Promise<T>;
    };

export type CreateManagedSourceWithContextOptions<K, T, C> = CreateManagedSourceOptionsBase<K> & {
  create: (key: K, context: C, scope: Scope) => Promise<T>;
};

type Entry<K, T, C> = {
  key: K;
  keyId: string;
  context: C;
  hasContext: boolean;
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
): ManagedSource<K, T>;
export function createManagedSource<K, T, C>(
  options: CreateManagedSourceWithContextOptions<K, T, C>
): ManagedSource<K, T, C>;
export function createManagedSource<K, T, C = void>(
  options: CreateManagedSourceOptions<K, T> | CreateManagedSourceWithContextOptions<K, T, C>
): ManagedSource<K, T, C> {
  const sourceScope = options.scope
    ? options.scope.child(options.label ?? 'managed-source')
    : createScope({ label: options.label });
  const entries = new Map<string, Entry<K, T, C>>();
  const graceMs = options.graceMs ?? 0;
  let disposed = false;
  let disposePromise: Promise<void> | undefined;
  let disposeEntriesPromise: Promise<void> | undefined;

  sourceScope.add(() => disposeEntries());

  return {
    acquire(key: K, ...args: [context?: C]): PendingLease<T> {
      return toPendingLease(acquireLease(key, args[0] as C, args.length > 0));
    },
    peek(key): T | undefined {
      const entry = entries.get(options.key(key));
      return entry?.hasValue === true ? entry.value : undefined;
    },
    async invalidate(key): Promise<void> {
      const entry = entries.get(options.key(key));
      if (!entry) return;
      await disposeEntry(entry);
    },
    async dispose(): Promise<void> {
      if (disposePromise) return disposePromise;
      disposed = true;
      disposePromise = sourceScope.dispose();
      return disposePromise;
    },
  };

  async function acquireLease(key: K, context: C, hasContext: boolean): Promise<Lease<T>> {
    if (disposed || sourceScope.disposed) throw new Error('ManagedSource is disposed');

    const keyId = options.key(key);
    let entry = entries.get(keyId);
    if (entry?.disposePromise) {
      await entry.disposePromise;
      if (disposed || sourceScope.disposed) throw new Error('ManagedSource is disposed');
      entry = entries.get(keyId);
    }

    if (!entry) {
      entry = createEntry(key, keyId, context, hasContext);
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

  function createEntry(key: K, keyId: string, context: C, hasContext: boolean): Entry<K, T, C> {
    return {
      key,
      keyId,
      context,
      hasContext,
      scope: sourceScope.child(entryScopeLabel(keyId)),
      refCount: 0,
      hasValue: false,
      value: undefined,
      createPromise: undefined,
      disposePromise: undefined,
      graceTimer: undefined,
    };
  }

  function entryScopeLabel(keyId: string): string {
    return options.scope || options.label ? keyId : `managed-source:${keyId}`;
  }

  async function disposeEntries(): Promise<void> {
    if (disposeEntriesPromise) return disposeEntriesPromise;
    disposed = true;
    disposeEntriesPromise = (async () => {
      const current = [...entries.values()];
      await Promise.all(current.map((entry) => disposeEntry(entry)));
      entries.clear();
    })();
    return disposeEntriesPromise;
  }

  function ensureCreated(entry: Entry<K, T, C>): Promise<T> {
    if (entry.hasValue) return Promise.resolve(entry.value as T);
    if (entry.createPromise) return entry.createPromise;

    entry.createPromise = createValue(entry)
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

  function releaseEntry(entry: Entry<K, T, C>): Promise<void> {
    if (entries.get(entry.keyId) !== entry) return Promise.resolve();
    if (entry.refCount > 0) entry.refCount -= 1;
    if (entry.refCount > 0) return Promise.resolve();
    if (entry.createPromise && !entry.hasValue) return Promise.resolve();
    return scheduleDispose(entry);
  }

  function scheduleDispose(entry: Entry<K, T, C>): Promise<void> {
    if (entry.disposePromise || entries.get(entry.keyId) !== entry) return Promise.resolve();
    clearGraceTimer(entry);
    if (graceMs <= 0) {
      return disposeEntry(entry);
    }
    entry.graceTimer = setTimeout(() => {
      entry.graceTimer = undefined;
      void disposeEntry(entry);
    }, graceMs);
    entry.graceTimer.unref?.();
    return Promise.resolve();
  }

  async function disposeEntry(entry: Entry<K, T, C>): Promise<void> {
    if (entry.disposePromise) return entry.disposePromise;
    clearGraceTimer(entry);
    entry.disposePromise = entry.scope.dispose().finally(() => {
      if (entries.get(entry.keyId) === entry) entries.delete(entry.keyId);
    });
    return entry.disposePromise;
  }

  function clearGraceTimer(entry: Entry<K, T, C>): void {
    if (!entry.graceTimer) return;
    clearTimeout(entry.graceTimer);
    entry.graceTimer = undefined;
  }

  function createValue(entry: Entry<K, T, C>): Promise<T> {
    if (entry.hasContext) {
      return (options.create as (key: K, context: C, scope: Scope) => Promise<T>)(
        entry.key,
        entry.context,
        entry.scope
      );
    }
    return (options.create as (key: K, scope: Scope) => Promise<T>)(entry.key, entry.scope);
  }
}

export function acquireAsResult<K, T, E>(
  source: ManagedSource<K, T>,
  key: K,
  isExpectedError: (error: unknown) => error is E
): Promise<Result<Lease<T>, E>>;
export function acquireAsResult<K, T, C, E>(
  source: ManagedSource<K, T, C>,
  key: K,
  context: C,
  isExpectedError: (error: unknown) => error is E
): Promise<Result<Lease<T>, E>>;
export async function acquireAsResult<K, T, C, E>(
  source: ManagedSource<K, T, C>,
  key: K,
  contextOrPredicate: C | ((error: unknown) => error is E),
  maybePredicate?: (error: unknown) => error is E
): Promise<Result<Lease<T>, E>> {
  const hasContext = maybePredicate !== undefined;
  const isExpectedError = (hasContext ? maybePredicate : contextOrPredicate) as (
    error: unknown
  ) => error is E;
  const pending = hasContext
    ? source.acquire(key, contextOrPredicate as C)
    : (source as ManagedSource<K, T>).acquire(key);

  try {
    const value = await pending.ready();
    return ok({ value, release: pending.release });
  } catch (error) {
    if (isExpectedError(error)) return err(error);
    throw error;
  }
}
