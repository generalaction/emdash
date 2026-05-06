// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookSchema = Record<string, (...args: any[]) => void | Promise<void>>;

export interface Hookable<T extends HookSchema> {
  on<K extends keyof T>(name: K, handler: T[K]): () => void;
}

export class HookCore<T extends HookSchema> implements Hookable<T> {
  private readonly _hooks = new Map<keyof T, Set<T[keyof T]>>();

  constructor(private readonly onError: (name: keyof T, error: unknown) => void) {}

  /**
   * @param name - The name of the hook to register the handler for.
   * @param handler - The handler to register.
   * @returns A function to unregister the handler.
   */
  on<K extends keyof T>(name: K, handler: T[K]) {
    if (!this._hooks.has(name)) this._hooks.set(name, new Set());
    this._hooks.get(name)!.add(handler);
    return () => this._hooks.get(name)?.delete(handler);
  }

  async callHook<K extends keyof T>(name: K, ...args: Parameters<T[K]>): Promise<void> {
    for (const handler of this._hooks.get(name) ?? []) {
      await (handler as (...a: unknown[]) => unknown)(...args);
    }
  }

  callHookSync<K extends keyof T>(name: K, ...args: Parameters<T[K]>): void {
    for (const handler of this._hooks.get(name) ?? []) {
      const result = (handler as (...a: unknown[]) => unknown)(...args);
      if (result instanceof Promise) {
        throw new TypeError(`Hook "${String(name)}" returned a Promise in a sync context`);
      }
    }
  }

  callHookBackground<K extends keyof T>(name: K, ...args: Parameters<T[K]>): void {
    for (const handler of this._hooks.get(name) ?? []) {
      Promise.resolve((handler as (...a: unknown[]) => unknown)(...args)).catch((e) =>
        this.onError(name, { error: String(e) })
      );
    }
  }
}
