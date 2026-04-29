import { err, ok, type Result } from '@shared/result';

export type LifecycleStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

/**
 * Manages the lifecycle state machine for a collection of async resources.
 *
 * Encapsulates four maps (active, in-flight provision, in-flight teardown, errors)
 * and provides deduplicated provision/teardown with a consistent bootstrap status query.
 *
 * Callers own timeout, error conversion, and logging — only the state transitions
 * and deduplication logic live here.
 */
export class LifecycleMap<T, E> {
  private readonly _active = new Map<string, T>();
  private readonly _provisioning = new Map<string, Promise<Result<T, E>>>();
  private readonly _tearingDown = new Map<string, Promise<Result<void, E>>>();
  private readonly _errors = new Map<string, E>();

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
   * - Otherwise calls `run`, stores the result, and returns it.
   */
  provision(id: string, run: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    const existing = this._active.get(id);
    if (existing !== undefined) return Promise.resolve(ok(existing));

    const inFlight = this._provisioning.get(id);
    if (inFlight) return inFlight;

    const promise = run().then((result) => {
      if (result.success) this._active.set(id, result.data);
      else this._errors.set(id, result.error);
      this._provisioning.delete(id);
      return result;
    });

    this._provisioning.set(id, promise);
    return promise;
  }

  /**
   * Tears down a resource with deduplication.
   * - If already tearing down, returns the existing promise.
   * - If not found in the active map, returns `null` — caller decides what to do.
   * - Otherwise calls `run`, cleans up maps, calls `onFinally`, and returns the result.
   *
   * The teardown error type `TE` is independent of the provision error type `E`,
   * since provision and teardown may surface different error variants.
   */
  teardown<TE>(
    id: string,
    run: (value: T) => Promise<Result<void, TE>>,
    onFinally?: () => void
  ): Promise<Result<void, TE>> | null {
    const inFlight = this._tearingDown.get(id) as Promise<Result<void, TE>> | undefined;
    if (inFlight) return inFlight;

    const value = this._active.get(id);
    if (value === undefined) return null;

    const promise = run(value)
      .then((result) => {
        if (!result.success) return err(result.error);
        return ok<void>();
      })
      .finally(() => {
        this._active.delete(id);
        this._tearingDown.delete(id);
        onFinally?.();
      });

    this._tearingDown.set(id, promise as Promise<Result<void, E>>);
    return promise;
  }
}
