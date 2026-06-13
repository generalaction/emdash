export type Unsubscribe = () => void;

export interface IDisposable {
  dispose(): void | Promise<void>;
}

export interface Lease<T> {
  readonly value: T;
  release(): void;
}
