export interface IInitializable {
  initialize(): void | Promise<void>;
}

export interface IDisposable {
  dispose(): void | Promise<void>;
}
