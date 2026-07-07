import type { IDisposable } from '@emdash/shared';

export type ScopeCleanup = () => void | Promise<void>;

export type ScopeCleanupErrorContext = {
  label: string | undefined;
};

export interface Scope {
  readonly disposed: boolean;
  add(cleanup: ScopeCleanup): void;
  use<T extends IDisposable>(resource: T): T;
  child(label?: string): Scope;
  dispose(): Promise<void>;
}

export type CreateScopeOptions = {
  label?: string;
  onCleanupError?: (error: unknown, scope: ScopeCleanupErrorContext) => void;
};

type ScopeState = {
  label: string | undefined;
  cleanups: ScopeCleanup[];
  children: Set<ScopeImpl>;
  onCleanupError: (error: unknown, scope: ScopeCleanupErrorContext) => void;
  disposed: boolean;
  disposePromise: Promise<void> | undefined;
};

export function createScope(options: CreateScopeOptions = {}): Scope {
  return new ScopeImpl({
    label: options.label,
    cleanups: [],
    children: new Set(),
    onCleanupError: options.onCleanupError ?? defaultCleanupErrorHandler,
    disposed: false,
    disposePromise: undefined,
  });
}

class ScopeImpl implements Scope {
  constructor(private readonly state: ScopeState) {}

  get disposed(): boolean {
    return this.state.disposed;
  }

  add(cleanup: ScopeCleanup): void {
    if (this.state.disposed) {
      void this.runCleanup(cleanup);
      return;
    }
    this.state.cleanups.push(cleanup);
  }

  use<T extends IDisposable>(resource: T): T {
    this.add(() => resource.dispose());
    return resource;
  }

  child(label?: string): Scope {
    const child = new ScopeImpl({
      label,
      cleanups: [],
      children: new Set(),
      onCleanupError: this.state.onCleanupError,
      disposed: false,
      disposePromise: undefined,
    });

    if (this.state.disposed) {
      void child.dispose();
      return child;
    }

    this.state.children.add(child);
    child.add(() => {
      this.state.children.delete(child);
    });
    return child;
  }

  dispose(): Promise<void> {
    if (this.state.disposePromise) return this.state.disposePromise;
    this.state.disposed = true;
    this.state.disposePromise = this.disposeAll();
    return this.state.disposePromise;
  }

  private async disposeAll(): Promise<void> {
    const children = [...this.state.children].reverse();
    this.state.children.clear();
    for (const child of children) {
      await child.dispose();
    }

    const cleanups = [...this.state.cleanups].reverse();
    this.state.cleanups.length = 0;
    for (const cleanup of cleanups) {
      await this.runCleanup(cleanup);
    }
  }

  private async runCleanup(cleanup: ScopeCleanup): Promise<void> {
    try {
      await cleanup();
    } catch (error) {
      this.state.onCleanupError(error, { label: this.state.label });
    }
  }
}

function defaultCleanupErrorHandler(error: unknown, scope: ScopeCleanupErrorContext): void {
  console.warn('[wire:scope] cleanup failed', { error, scope });
}
