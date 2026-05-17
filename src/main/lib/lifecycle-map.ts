import { err, ok, type Result } from '@shared/result';

export type LifecycleStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

export type LifecycleHooks<T> = {
  preProvision?: (id: string) => Promise<void> | void;
  postProvision?: (id: string, value: T) => Promise<void> | void;
  preTeardown?: (id: string, value: T) => Promise<void> | void;
  postTeardown?: (id: string, value: T) => Promise<void> | void;
};

/**
 * Manages the lifecycle state machine for a collection of async resources.
 *
 * Encapsulates four maps (active, in-flight provision, in-flight teardown, errors)
 * and provides deduplicated provision/teardown with a consistent bootstrap status query.
 *
 * Callers own timeout, error conversion, and logging — only the state transitions
 * and deduplication logic live here.
 *
 * Hooks are awaited in sequence. To fire-and-forget, return void from the hook body
 * without returning the Promise.
 */
export class LifecycleMap<T, E> {
  private readonly _active = new Map<string, T>();
  private readonly _provisioning = new Map<string, Promise<Result<T, E>>>();
  private readonly _tearingDown = new Map<string, Promise<Result<void, E>>>();
  private readonly _errors = new Map<string, E>();

  constructor(private readonly _hooks: LifecycleHooks<T> = {}) {}

  get(id: string): T | undefined {
    return this._active.get(id);
  }

  has(id: string): boolean {
    return this._active.has(id);
  }

  keys(): IterableIterator<string> {
    return this._active.keys();
  }

  values(): IterableIterator<T> {
    return this._active.values();
  }

  /** Clears the active map without running any teardown callbacks. Use for bulk detach operations. */
  clearActive(): void {
    this._active.clear();
  }

  bootstrapStatus(id: string, formatError: (e: E) => string): LifecycleStatus {
    if (this._active.has(id)) return { status: 'ready' };
    if (this._provisioning.has(id)) return { status: 'bootstrapping' };
    const error = this._errors.get(id);
    if (error) return { status: 'error', message: formatError(error) };
    return { status: 'not-started' };
  }

  /**
   * Provisions a resource with deduplication.
   * - If already active, returns the existing value immediately.
   * - If already in-flight, returns the existing promise.
   * - Otherwise runs: preProvision → run() → _active.set() → postProvision.
   */
  provision(id: string, run: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const existing = this._active.get(id);
    if (existing !== undefined) return Promise.resolve(ok(existing));

    const inFlight = this._provisioning.get(id);
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        await this._hooks.preProvision?.(id);
        const result = await run();
        if (result.success) {
          this._active.set(id, result.data);
          await this._hooks.postProvision?.(id, result.data);
        } else {
          this._errors.set(id, result.error);
        }
        return result;
      } finally {
        this._provisioning.delete(id);
      }
    })();

    this._provisioning.set(id, promise);
    return promise;
  }

  /**
   * Tears down a resource with deduplication.
   * - If already tearing down, returns the existing promise.
   * - If not found in the active map, returns `null` — caller decides what to do.
   * - Otherwise runs: preTeardown → run() → _active.delete() → postTeardown.
   * - postTeardown always fires (via finally), even if run() fails.
   */
  teardown<TE>(
    id: string,
    run: (value: T) => Promise<Result<void, TE>>
  ): Promise<Result<void, TE>> | null {
    const inFlight = this._tearingDown.get(id) as Promise<Result<void, TE>> | undefined;
    if (inFlight) return inFlight;

    const value = this._active.get(id);
    if (value === undefined) return null;

    const promise = (async () => {
      try {
        await this._hooks.preTeardown?.(id, value);
        const result = await run(value);
        return result.success ? ok<void>() : err(result.error);
      } finally {
        this._active.delete(id);
        this._tearingDown.delete(id);
        await this._hooks.postTeardown?.(id, value);
      }
    })();

    this._tearingDown.set(id, promise as Promise<Result<void, E>>);
    return promise;
  }
}
