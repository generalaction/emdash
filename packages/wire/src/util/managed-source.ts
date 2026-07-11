import type { PendingLease } from '@emdash/shared';
import type { Clock } from '../scheduling';
import { createResourceCache, type ResourceCache } from './resource-cache';
import type { Scope } from './scope';

/** @deprecated Use ResourceCache instead. Put all provisioning identity in the key. */
export interface ManagedSource<K, T, C = void> {
  acquire(key: K): PendingLease<T>;
  acquire(key: K, context: C): PendingLease<T>;
  peek(key: K): T | undefined;
  invalidate(key: K): Promise<void>;
  dispose(): Promise<void>;
}

/** @deprecated Use CreateResourceCacheOptions instead. */
type CreateManagedSourceOptionsBase<K> = {
  key: (key: K) => string;
  scope?: Scope;
  label?: string;
  graceMs?: number;
  clock?: Clock;
  onError?: (error: unknown, key: string) => void;
};

/** @deprecated Use CreateResourceCacheOptions instead. */
export type CreateManagedSourceOptions<K, T, C = void> = [C] extends [void]
  ? CreateManagedSourceOptionsBase<K> & {
      create: (key: K, scope: Scope) => Promise<T>;
    }
  : CreateManagedSourceOptionsBase<K> & {
      create: (key: K, context: C, scope: Scope) => Promise<T>;
    };

/** @deprecated Use CreateResourceCacheOptions instead. */
export type CreateManagedSourceWithContextOptions<K, T, C> = CreateManagedSourceOptionsBase<K> & {
  create: (key: K, context: C, scope: Scope) => Promise<T>;
};

type LegacyKey<K, C> = {
  key: K;
  context: C | undefined;
  hasContext: boolean;
};

/** @deprecated Use createResourceCache instead. Put all provisioning identity in the key. */
export function createManagedSource<K, T>(
  options: CreateManagedSourceOptions<K, T>
): ManagedSource<K, T>;
/** @deprecated Use createResourceCache instead. Put all provisioning identity in the key. */
export function createManagedSource<K, T, C>(
  options: CreateManagedSourceWithContextOptions<K, T, C>
): ManagedSource<K, T, C>;
export function createManagedSource<K, T, C = void>(
  options: CreateManagedSourceOptions<K, T> | CreateManagedSourceWithContextOptions<K, T, C>
): ManagedSource<K, T, C> {
  const cache: ResourceCache<LegacyKey<K, C>, T> = createResourceCache({
    key: (key) => options.key(key.key),
    scope: options.scope,
    label: options.label ?? 'managed-source',
    idleTtlMs: options.graceMs,
    clock: options.clock,
    onError: options.onError,
    create: (key, scope) => {
      if (key.hasContext) {
        return (options.create as (key: K, context: C, scope: Scope) => Promise<T>)(
          key.key,
          key.context as C,
          scope
        );
      }
      return (options.create as (key: K, scope: Scope) => Promise<T>)(key.key, scope);
    },
  });

  return {
    acquire(key: K, ...args: [context?: C]): PendingLease<T> {
      return cache.acquire({ key, context: args[0], hasContext: args.length > 0 });
    },
    peek(key): T | undefined {
      return cache.peek({ key, context: undefined, hasContext: false });
    },
    invalidate(key): Promise<void> {
      return cache.invalidate({ key, context: undefined, hasContext: false });
    },
    dispose(): Promise<void> {
      return cache.dispose();
    },
  };
}
