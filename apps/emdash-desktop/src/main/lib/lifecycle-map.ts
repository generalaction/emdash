import { err, ok, type Result } from '@emdash/shared';

export type LifecycleStatus<E> =
  | { status: 'ready' | 'bootstrapping' | 'not-started' }
  | { status: 'error'; error: E };

export type LifecycleHooks<T> = {
  preProvision?: (id: string) => Promise<void> | void;
  postProvision?: (id: string, value: T) => Promise<void> | void;
  preTeardown?: (id: string, value: T) => Promise<void> | void;
  postTeardown?: (id: string, value: T) => Promise<void> | void;
};

/**
 * Manages the lifecycle state machine for a collection of async resources.
 *
 * Encapsulates five maps (active, in-flight provision, in-flight teardown, provision errors,
 * teardown errors) and provides deduplicated provision/teardown with a consistent status query.
 *
 * Callers own timeout, error conversion, and logging — only the state transitions
 * and deduplication logic live here.
 *
 * Hooks are awaited in sequence. To fire-and-forget, return void from the hook body
 * without returning the Promise.
 *
 * Type parameters:
 *   T  — the provisioned resource type
 *   PE — provision error type (stored in _errors, surfaced by bootstrapStatus)
 *   TE — teardown error type (stored in _teardownErrors, surfaced by teardownStatus);
 *        defaults to PE when provision and teardown share the same error type
 */
export class LifecycleMap<T, PE, TE> {
  private readonly _active = new Map<string, T>();
  private readonly _provisioning = new Map<string, Promise<Result<T, PE>>>();
  private readonly _tearingDown = new Map<string, Promise<Result<void, TE>>>();
  private readonly _errors = new Map<string, PE>();
  private readonly _teardownErrors = new Map<string, TE>();

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

  bootstrapStatus(id: string): LifecycleStatus<PE> {
    if (this._active.has(id)) return { status: 'ready' };
    if (this._provisioning.has(id)) return { status: 'bootstrapping' };
    const error = this._errors.get(id);
    if (error) return { status: 'error', error };
    return { status: 'not-started' };
  }

  teardownStatus(id: string): LifecycleStatus<TE> {
    if (this._tearingDown.has(id)) return { status: 'bootstrapping' };
    const error = this._teardownErrors.get(id);
    if (error) return { status: 'error', error };
    return { status: 'not-started' };
  }

  provision(id: string, run: () => Promise<Result<T, PE>>): Promise<Result<T, PE>> {
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
          this._teardownErrors.delete(id);
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

  teardown(
    id: string,
    run: (value: T) => Promise<Result<void, TE>>
  ): Promise<Result<void, TE>> | null {
    const inFlight = this._tearingDown.get(id);
    if (inFlight) return inFlight;

    const value = this._active.get(id);
    if (value === undefined) return null;

    const promise = (async () => {
      try {
        await this._hooks.preTeardown?.(id, value);
        const result = await run(value);
        if (!result.success) {
          this._teardownErrors.set(id, result.error);
        }
        return result.success ? ok<void>() : err(result.error);
      } finally {
        this._active.delete(id);
        this._tearingDown.delete(id);
        await this._hooks.postTeardown?.(id, value);
      }
    })();

    this._tearingDown.set(id, promise);
    return promise;
  }
}
