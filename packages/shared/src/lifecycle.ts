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
  release(): void;
}
