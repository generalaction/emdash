import { once, type Lease, type Unsubscribe } from '../lifecycle';
import { err, ok, type Result } from '../result';
import { createScope, type Scope } from './scope';

type MaybePromise<T> = T | Promise<T>;

export type LifecycleRegistryState<Value, StartError, StopError> =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'ready'; value: Value }
  | { kind: 'stopping'; value: Value }
  | { kind: 'start-failed'; error: StartError }
  | { kind: 'stop-failed'; value: Value; error: StopError }
  | { kind: 'disposed' };

export type LifecycleRegistryStateChange<Value, StartError, StopError> = {
  key: string;
  previous: LifecycleRegistryState<Value, StartError, StopError>;
  current: LifecycleRegistryState<Value, StartError, StopError>;
};

export type LifecycleRegistryObserver<Value, StartError, StopError> = (
  change: LifecycleRegistryStateChange<Value, StartError, StopError>
) => void | Promise<void>;

export type LifecycleRegistryObserverError<Value, StartError, StopError> = {
  key: string;
  error: unknown;
  change: LifecycleRegistryStateChange<Value, StartError, StopError>;
};

export type LifecycleRegistryLeaseDrainTimeout = {
  key: string;
  leaseCount: number;
  timeoutMs: number;
};

export type LifecycleRegistryOptions<StartInput, Value, StartError, StopContext, StopError> = {
  label?: string;
  scope?: Scope;
  keyOf(input: StartInput): string;
  start(
    input: StartInput,
    scope: Scope,
    signal: AbortSignal
  ): MaybePromise<Result<Value, StartError>>;
  interrupt?(
    key: string,
    value: Value,
    context: StopContext | undefined,
    signal: AbortSignal
  ): MaybePromise<void>;
  stop(
    key: string,
    value: Value,
    context: StopContext | undefined,
    scope: Scope,
    signal: AbortSignal
  ): MaybePromise<Result<void, StopError>>;
  onStateChanged?: LifecycleRegistryObserver<Value, StartError, StopError>;
  onObserverError?: (error: LifecycleRegistryObserverError<Value, StartError, StopError>) => void;
  drainTimeoutMs?: number;
  onLeaseDrainTimeout?: (event: LifecycleRegistryLeaseDrainTimeout) => void;
};

type RegistryEntry<Value, StartError, StopError> = {
  key: string;
  scope: Scope | undefined;
  state: LifecycleRegistryState<Value, StartError, StopError>;
  tail: Promise<unknown> | undefined;
  startPromise: Promise<Result<Value, StartError>> | undefined;
  stopPromise: Promise<Result<void, StopError>> | undefined;
  leaseCount: number;
  leaseWaiters: Set<() => void>;
};

export interface LifecycleRegistry<
  StartInput,
  Value,
  StartError,
  StopContext = void,
  StopError = StartError,
> {
  get(key: string): Value | undefined;
  has(key: string): boolean;
  keys(): IterableIterator<string>;
  values(): IterableIterator<Value>;
  entries(): IterableIterator<[string, Value]>;
  state(key: string): LifecycleRegistryState<Value, StartError, StopError>;
  states(): Map<string, LifecycleRegistryState<Value, StartError, StopError>>;
  start(input: StartInput): Promise<Result<Value, StartError>>;
  use<T, UseError>(
    input: StartInput,
    operation: (value: Value) => MaybePromise<Result<T, UseError>>
  ): Promise<Result<T, StartError | UseError>>;
  acquire(input: StartInput): Promise<Result<Lease<Value>, StartError>>;
  register(key: string, value: Value): Promise<Value>;
  stop(key: string, context?: StopContext): Promise<Result<void, StopError>>;
  forceRemove(key: string, reason?: unknown): Promise<void>;
  dispose(): Promise<void>;
  onStateChanged(observer: LifecycleRegistryObserver<Value, StartError, StopError>): Unsubscribe;
}

class LifecycleRegistryImpl<
  StartInput,
  Value,
  StartError,
  StopContext = void,
  StopError = StartError,
> implements LifecycleRegistry<StartInput, Value, StartError, StopContext, StopError> {
  private readonly _scope: Scope;
  private readonly _entries = new Map<string, RegistryEntry<Value, StartError, StopError>>();
  private readonly _observers = new Set<LifecycleRegistryObserver<Value, StartError, StopError>>();
  private _disposing = false;
  private _disposed = false;
  private _disposePromise: Promise<void> | undefined;

  constructor(
    private readonly _options: LifecycleRegistryOptions<
      StartInput,
      Value,
      StartError,
      StopContext,
      StopError
    >
  ) {
    const label = _options.label ?? 'lifecycle-registry';
    if (
      _options.drainTimeoutMs !== undefined &&
      (!Number.isFinite(_options.drainTimeoutMs) || _options.drainTimeoutMs < 0)
    ) {
      throw new RangeError('LifecycleRegistry drainTimeoutMs must be a non-negative finite number');
    }
    this._scope = _options.scope ? _options.scope.child(label) : createScope({ label });
    if (_options.onStateChanged) this._observers.add(_options.onStateChanged);
  }

  get(key: string): Value | undefined {
    const entry = this._entries.get(key);
    if (!entry) return undefined;
    return valueFromState(entry.state);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  keys(): IterableIterator<string> {
    return this.ownedEntries()
      .map(([key]) => key)
      [Symbol.iterator]();
  }

  values(): IterableIterator<Value> {
    return this.ownedEntries()
      .map(([, value]) => value)
      [Symbol.iterator]();
  }

  entries(): IterableIterator<[string, Value]> {
    return this.ownedEntries()[Symbol.iterator]();
  }

  state(key: string): LifecycleRegistryState<Value, StartError, StopError> {
    if (this._disposed) return { kind: 'disposed' };
    return this._entries.get(key)?.state ?? { kind: 'idle' };
  }

  states(): Map<string, LifecycleRegistryState<Value, StartError, StopError>> {
    const states = new Map<string, LifecycleRegistryState<Value, StartError, StopError>>();
    for (const [key, entry] of this._entries) states.set(key, entry.state);
    return states;
  }

  start(input: StartInput): Promise<Result<Value, StartError>> {
    this.assertOpen();
    const key = this._options.keyOf(input);
    const entry = this.ensureEntry(key);

    if (entry.startPromise) return entry.startPromise;
    if (entry.stopPromise) return entry.stopPromise.then(() => this.start(input));

    const existing = valueFromState(entry.state);
    if (existing !== undefined) return Promise.resolve(ok(existing));

    const promise = this.enqueue(entry, () => this.startEntry(entry, input)).finally(() => {
      if (entry.startPromise === promise) entry.startPromise = undefined;
    });

    entry.startPromise = promise;
    promise.catch(() => {});
    return promise;
  }

  use<T, UseError>(
    input: StartInput,
    operation: (value: Value) => MaybePromise<Result<T, UseError>>
  ): Promise<Result<T, StartError | UseError>> {
    this.assertOpen();
    const entry = this.ensureEntry(this._options.keyOf(input));
    if (entry.stopPromise) return entry.stopPromise.then(() => this.use(input, operation));
    return this.enqueue(entry, async () => {
      const started = await this.ensureStarted(entry, input);
      if (!started.success) return err(started.error);
      return operation(started.data);
    });
  }

  acquire(input: StartInput): Promise<Result<Lease<Value>, StartError>> {
    this.assertOpen();
    const entry = this.ensureEntry(this._options.keyOf(input));
    if (entry.stopPromise) return entry.stopPromise.then(() => this.acquire(input));
    return this.enqueue(entry, async () => {
      const started = await this.ensureStarted(entry, input);
      if (!started.success) return started;
      entry.leaseCount += 1;
      return ok({
        value: started.data,
        release: once(async () => {
          entry.leaseCount = Math.max(0, entry.leaseCount - 1);
          if (entry.leaseCount !== 0) return;
          const waiters = [...entry.leaseWaiters];
          entry.leaseWaiters.clear();
          for (const resolve of waiters) resolve();
        }),
      });
    });
  }

  register(key: string, value: Value): Promise<Value> {
    this.assertOpen();
    const entry = this.ensureEntry(key);
    if (entry.stopPromise) return entry.stopPromise.then(() => this.register(key, value));

    const existing = valueFromState(entry.state);
    if (existing !== undefined) return Promise.resolve(existing);

    return this.enqueue(entry, async () => {
      const current = valueFromState(entry.state);
      if (current !== undefined) return current;

      entry.scope = this._scope.child(entry.key);
      this.transition(entry, { kind: 'ready', value });
      return value;
    });
  }

  stop(key: string, context?: StopContext): Promise<Result<void, StopError>> {
    if (this._disposed) return Promise.resolve(ok<void>());

    const entry = this._entries.get(key);
    if (!entry) return Promise.resolve(ok<void>());
    if (entry.stopPromise) return entry.stopPromise;

    const promise = this.enqueue(entry, async () => {
      let value = valueFromState(entry.state);
      if (value === undefined) {
        await this.removeEntry(entry, 'stop without value');
        return ok<void>();
      }

      const scope = entry.scope;
      if (!scope) return ok<void>();

      this.transition(entry, { kind: 'stopping', value });
      if (this._options.interrupt) {
        const interruptedValue = value;
        await scope
          .run('interrupt', (signal) =>
            this._options.interrupt!(key, interruptedValue, context, signal)
          )
          .value();
      }
      await this.waitForLeases(entry);
      value = valueFromState(entry.state);
      if (value === undefined) {
        await this.removeEntry(entry, 'stop without value');
        return ok<void>();
      }
      const result = await scope
        .run('stop', (signal) => this._options.stop(key, value, context, scope, signal))
        .value();

      if (!result.success) {
        this.transition(entry, { kind: 'stop-failed', value, error: result.error });
        return err(result.error);
      }

      await this.removeEntry(entry, 'stop');
      return ok<void>();
    }).finally(() => {
      if (entry.stopPromise === promise) entry.stopPromise = undefined;
    });

    entry.stopPromise = promise;
    promise.catch(() => {});
    return promise;
  }

  async forceRemove(key: string, reason?: unknown): Promise<void> {
    let entry = this._entries.get(key);
    if (!entry) return;

    const pending = entry.stopPromise ?? entry.startPromise;
    if (pending) await pending.catch(() => {});

    entry = this._entries.get(key);
    if (!entry) return;
    await this.removeEntry(entry, reason ?? new Error(`Lifecycle entry force-removed: ${key}`));
  }

  async dispose(): Promise<void> {
    if (this._disposePromise) return this._disposePromise;

    this._disposing = true;
    this._disposePromise = (async () => {
      await Promise.allSettled([...this.keys()].map((key) => this.stop(key, undefined)));

      for (const entry of [...this._entries.values()]) {
        await this.disposeEntry(entry, new Error('LifecycleRegistry disposed'));
      }

      await this._scope.dispose(new Error('LifecycleRegistry disposed'));
      this._disposed = true;
      this._disposing = false;
    })();

    return this._disposePromise;
  }

  onStateChanged(observer: LifecycleRegistryObserver<Value, StartError, StopError>): Unsubscribe {
    this._observers.add(observer);
    return () => this._observers.delete(observer);
  }

  private ensureEntry(key: string): RegistryEntry<Value, StartError, StopError> {
    let entry = this._entries.get(key);
    if (!entry) {
      entry = {
        key,
        scope: undefined,
        state: { kind: 'idle' },
        tail: undefined,
        startPromise: undefined,
        stopPromise: undefined,
        leaseCount: 0,
        leaseWaiters: new Set(),
      };
      this._entries.set(key, entry);
    }
    return entry;
  }

  private enqueue<T>(
    entry: RegistryEntry<Value, StartError, StopError>,
    operation: () => Promise<T>
  ): Promise<T> {
    const run = () => {
      try {
        return operation();
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const promise = entry.tail ? entry.tail.then(run, run) : run();
    const tail = promise.catch(() => {});
    entry.tail = tail;
    promise
      .finally(() => {
        if (entry.tail === tail) entry.tail = undefined;
      })
      .catch(() => {});
    return promise;
  }

  private ensureStarted(
    entry: RegistryEntry<Value, StartError, StopError>,
    input: StartInput
  ): Promise<Result<Value, StartError>> {
    const current = valueFromState(entry.state);
    return current === undefined ? this.startEntry(entry, input) : Promise.resolve(ok(current));
  }

  private async startEntry(
    entry: RegistryEntry<Value, StartError, StopError>,
    input: StartInput
  ): Promise<Result<Value, StartError>> {
    const current = valueFromState(entry.state);
    if (current !== undefined) return ok(current);

    const scope = this._scope.child(entry.key);
    entry.scope = scope;
    this.transition(entry, { kind: 'starting' });

    try {
      const result = await scope
        .run('start', (signal) => this._options.start(input, scope, signal))
        .value();

      if (result.success) {
        this.transition(entry, { kind: 'ready', value: result.data });
        return result;
      }

      await scope.dispose(result.error);
      entry.scope = undefined;
      this.transition(entry, { kind: 'start-failed', error: result.error });
      return err(result.error);
    } catch (error) {
      // Observers must never see a permanent 'starting': surface the thrown
      // failure before the scope teardown and rethrow.
      this.transition(entry, { kind: 'start-failed', error: error as StartError });
      await scope.dispose(error);
      entry.scope = undefined;
      throw error;
    }
  }

  private waitForLeases(entry: RegistryEntry<Value, StartError, StopError>): Promise<void> {
    if (entry.leaseCount === 0) return Promise.resolve();
    const timeoutMs = this._options.drainTimeoutMs;
    if (timeoutMs === undefined) {
      return new Promise<void>((resolve) => entry.leaseWaiters.add(resolve));
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        entry.leaseWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        this._options.onLeaseDrainTimeout?.({
          key: entry.key,
          leaseCount: entry.leaseCount,
          timeoutMs,
        });
        finish();
      }, timeoutMs);
      entry.leaseWaiters.add(finish);
    });
  }

  private async removeEntry(
    entry: RegistryEntry<Value, StartError, StopError>,
    reason: unknown
  ): Promise<void> {
    if (entry.scope) {
      await entry.scope.dispose(reason);
      entry.scope = undefined;
    }
    this.transition(entry, { kind: 'idle' });
    if (this._entries.get(entry.key) === entry) this._entries.delete(entry.key);
  }

  private async disposeEntry(
    entry: RegistryEntry<Value, StartError, StopError>,
    reason: unknown
  ): Promise<void> {
    if (entry.scope) {
      await entry.scope.dispose(reason);
      entry.scope = undefined;
    }
    this.transition(entry, { kind: 'disposed' });
    if (this._entries.get(entry.key) === entry) this._entries.delete(entry.key);
  }

  private transition(
    entry: RegistryEntry<Value, StartError, StopError>,
    current: LifecycleRegistryState<Value, StartError, StopError>
  ): void {
    const previous = entry.state;
    entry.state = current;
    const change = { key: entry.key, previous, current };

    for (const observer of this._observers) {
      try {
        Promise.resolve(observer(change)).catch((error: unknown) =>
          this.reportObserverError(error, change)
        );
      } catch (error) {
        this.reportObserverError(error, change);
      }
    }
  }

  private reportObserverError(
    error: unknown,
    change: LifecycleRegistryStateChange<Value, StartError, StopError>
  ): void {
    this._options.onObserverError?.({ key: change.key, error, change });
  }

  private ownedEntries(): [string, Value][] {
    const entries: [string, Value][] = [];
    for (const [key, entry] of this._entries) {
      const value = valueFromState(entry.state);
      if (value !== undefined) entries.push([key, value]);
    }
    return entries;
  }

  private assertOpen(): void {
    if (this._disposed || this._disposing) throw new Error('LifecycleRegistry is disposed');
  }
}

export function createLifecycleRegistry<
  StartInput,
  Value,
  StartError,
  StopContext = void,
  StopError = StartError,
>(
  options: LifecycleRegistryOptions<StartInput, Value, StartError, StopContext, StopError>
): LifecycleRegistry<StartInput, Value, StartError, StopContext, StopError> {
  return new LifecycleRegistryImpl(options);
}

function valueFromState<Value, StartError, StopError>(
  state: LifecycleRegistryState<Value, StartError, StopError>
): Value | undefined {
  switch (state.kind) {
    case 'ready':
    case 'stopping':
    case 'stop-failed':
      return state.value;
    case 'idle':
    case 'starting':
    case 'start-failed':
    case 'disposed':
      return undefined;
  }
}
