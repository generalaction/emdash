import type { Lease, Unsubscribe } from '../lifecycle';
import type { Result } from '../result';
import {
  createLifecycleRegistry,
  type LifecycleRegistry,
  type LifecycleRegistryLeaseDrainTimeout,
  type LifecycleRegistryState,
} from './lifecycle-registry';
import type { Scope } from './scope';

type MaybePromise<T> = T | Promise<T>;

export type LifecycleCellState<Value, StartError, StopError> = LifecycleRegistryState<
  Value,
  StartError,
  StopError
>;

export type LifecycleCellStateChange<Value, StartError, StopError> = {
  previous: LifecycleCellState<Value, StartError, StopError>;
  current: LifecycleCellState<Value, StartError, StopError>;
};

export type LifecycleCellObserver<Value, StartError, StopError> = (
  change: LifecycleCellStateChange<Value, StartError, StopError>
) => void | Promise<void>;

export type LifecycleCellObserverError<Value, StartError, StopError> = {
  error: unknown;
  change: LifecycleCellStateChange<Value, StartError, StopError>;
};

export type LifecycleCellOptions<StartInput, Value, StartError, StopContext, StopError> = {
  label?: string;
  scope?: Scope;
  start(
    input: StartInput,
    scope: Scope,
    signal: AbortSignal
  ): MaybePromise<Result<Value, StartError>>;
  interrupt?(
    value: Value,
    context: StopContext | undefined,
    signal: AbortSignal
  ): MaybePromise<void>;
  stop(
    value: Value,
    context: StopContext | undefined,
    scope: Scope,
    signal: AbortSignal
  ): MaybePromise<Result<void, StopError>>;
  onStateChanged?: LifecycleCellObserver<Value, StartError, StopError>;
  onObserverError?: (error: LifecycleCellObserverError<Value, StartError, StopError>) => void;
  drainTimeoutMs?: number;
  onLeaseDrainTimeout?: (event: Omit<LifecycleRegistryLeaseDrainTimeout, 'key'>) => void;
};

export interface LifecycleCell<
  StartInput,
  Value,
  StartError,
  StopContext = void,
  StopError = StartError,
> {
  get(): Value | undefined;
  has(): boolean;
  state(): LifecycleCellState<Value, StartError, StopError>;
  start(input: StartInput): Promise<Result<Value, StartError>>;
  use<T, UseError>(
    input: StartInput,
    operation: (value: Value) => MaybePromise<Result<T, UseError>>
  ): Promise<Result<T, StartError | UseError>>;
  acquire(input: StartInput): Promise<Result<Lease<Value>, StartError>>;
  register(value: Value): Promise<Value>;
  stop(context?: StopContext): Promise<Result<void, StopError>>;
  forceRemove(reason?: unknown): Promise<void>;
  dispose(): Promise<void>;
  onStateChanged(observer: LifecycleCellObserver<Value, StartError, StopError>): Unsubscribe;
}

const CELL_KEY = 'value';

class LifecycleCellImpl<
  StartInput,
  Value,
  StartError,
  StopContext = void,
  StopError = StartError,
> implements LifecycleCell<StartInput, Value, StartError, StopContext, StopError> {
  private readonly registry: LifecycleRegistry<
    StartInput,
    Value,
    StartError,
    StopContext,
    StopError
  >;

  constructor(
    options: LifecycleCellOptions<StartInput, Value, StartError, StopContext, StopError>
  ) {
    this.registry = createLifecycleRegistry({
      label: options.label,
      scope: options.scope,
      keyOf: () => CELL_KEY,
      start: options.start,
      interrupt: options.interrupt
        ? (_key, value, context, signal) => options.interrupt!(value, context, signal)
        : undefined,
      stop: (_key, value, context, scope, signal) => options.stop(value, context, scope, signal),
      onStateChanged: options.onStateChanged
        ? (change) =>
            options.onStateChanged!({ previous: change.previous, current: change.current })
        : undefined,
      onObserverError: options.onObserverError
        ? ({ error, change }) =>
            options.onObserverError!({
              error,
              change: { previous: change.previous, current: change.current },
            })
        : undefined,
      drainTimeoutMs: options.drainTimeoutMs,
      onLeaseDrainTimeout: options.onLeaseDrainTimeout
        ? ({ leaseCount, timeoutMs }) => options.onLeaseDrainTimeout!({ leaseCount, timeoutMs })
        : undefined,
    });
  }

  get(): Value | undefined {
    return this.registry.get(CELL_KEY);
  }

  has(): boolean {
    return this.registry.has(CELL_KEY);
  }

  state(): LifecycleCellState<Value, StartError, StopError> {
    return this.registry.state(CELL_KEY);
  }

  start(input: StartInput): Promise<Result<Value, StartError>> {
    return this.registry.start(input);
  }

  use<T, UseError>(
    input: StartInput,
    operation: (value: Value) => MaybePromise<Result<T, UseError>>
  ): Promise<Result<T, StartError | UseError>> {
    return this.registry.use(input, operation);
  }

  acquire(input: StartInput): Promise<Result<Lease<Value>, StartError>> {
    return this.registry.acquire(input);
  }

  register(value: Value): Promise<Value> {
    return this.registry.register(CELL_KEY, value);
  }

  stop(context?: StopContext): Promise<Result<void, StopError>> {
    return this.registry.stop(CELL_KEY, context);
  }

  forceRemove(reason?: unknown): Promise<void> {
    return this.registry.forceRemove(CELL_KEY, reason);
  }

  dispose(): Promise<void> {
    return this.registry.dispose();
  }

  onStateChanged(observer: LifecycleCellObserver<Value, StartError, StopError>): Unsubscribe {
    return this.registry.onStateChanged((change) =>
      observer({ previous: change.previous, current: change.current })
    );
  }
}

export function createLifecycleCell<
  StartInput,
  Value,
  StartError,
  StopContext = void,
  StopError = StartError,
>(
  options: LifecycleCellOptions<StartInput, Value, StartError, StopContext, StopError>
): LifecycleCell<StartInput, Value, StartError, StopContext, StopError> {
  return new LifecycleCellImpl(options);
}
