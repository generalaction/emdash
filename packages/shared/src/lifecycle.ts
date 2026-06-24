export type Unsubscribe = () => void;

export interface IInitializable {
  initialize(): void | Promise<void>;
}

export interface IDisposable {
  dispose(): void | Promise<void>;
}

export interface ILifecycle extends IInitializable, IDisposable {}

export interface Lease<T> {
  readonly value: T;
  release(): Promise<void>;
}

export interface PendingLease<T> {
  ready(): Promise<T>;
  release(): Promise<void>;
}

class PendingLeaseAdapter<T> implements PendingLease<T> {
  private releasePromise: Promise<void> | null = null;

  constructor(private readonly lease: Promise<Lease<T>>) {
    this.lease.catch(() => {});
  }

  async ready(): Promise<T> {
    return (await this.lease).value;
  }

  release(): Promise<void> {
    this.releasePromise ??= this.releaseOnce();
    return this.releasePromise;
  }

  private async releaseOnce(): Promise<void> {
    try {
      const lease = await this.lease;
      await lease.release();
    } catch {}
  }
}

export function toPendingLease<T>(lease: Promise<Lease<T>>): PendingLease<T> {
  return new PendingLeaseAdapter(lease);
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
