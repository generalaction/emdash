export type Unsubscribe = () => void;

export interface IInitializable {
  initialize(): void | Promise<void>;
}

export interface IDisposable {
  dispose(): void | Promise<void>;
}

export interface ILifecycle extends IInitializable, IDisposable {}

export interface IReleasable {
  release(): Promise<void>;
}

export interface Lease<T> {
  readonly value: T;
  release(): Promise<void>;
}

export interface PendingLease<T> {
  ready(): Promise<T>;
  release(): Promise<void>;
}

export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => (promise ??= fn());
}

export function toPendingLease<T>(leasePromise: Promise<Lease<T>>): PendingLease<T> {
  leasePromise.catch(() => {});
  return {
    ready: async () => (await leasePromise).value,
    release: once(async () => {
      try {
        await (await leasePromise).release();
      } catch {}
    }),
  };
}

export async function withLease<T, R>(
  leaseOrPromise: Lease<T> | Promise<Lease<T>>,
  run: (value: T, lease: Lease<T>) => R | Promise<R>
): Promise<R> {
  const lease = await leaseOrPromise;
  try {
    return await run(lease.value, lease);
  } finally {
    await lease.release();
  }
}
