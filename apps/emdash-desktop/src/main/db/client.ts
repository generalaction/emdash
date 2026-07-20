import type Database from 'better-sqlite3';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import { createDrizzleClient, type DrizzleClient } from './drizzleClient';
import type * as schema from './schema';

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;
export type DrizzleTx = Parameters<AppDb['transaction']>[0] extends (tx: infer T) => unknown
  ? T
  : never;

let client: DrizzleClient | undefined;

function getClient(): DrizzleClient {
  client ??= createDrizzleClient();
  return client;
}

function lazyObject<T extends object>(resolve: () => T): T {
  const target = {};
  return new Proxy(target, {
    get: (_target, property) => {
      const resolved = resolve();
      const value = Reflect.get(resolved, property, resolved);
      return typeof value === 'function' ? value.bind(resolved) : value;
    },
    set: (_target, property, value) => Reflect.set(resolve(), property, value),
    has: (_target, property) => Reflect.has(resolve(), property),
    ownKeys: () => Reflect.ownKeys(resolve()),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(resolve()),
  }) as T;
}

export const sqlite = lazyObject<Database.Database>(() => getClient().sqlite);
export const db = lazyObject<AppDb>(() => getClient().db);
