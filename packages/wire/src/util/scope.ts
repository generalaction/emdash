import type { IDisposable } from '@emdash/shared';
import { log as ambientLog, type Logger } from '@emdash/shared/logger';

export type ScopeCleanup = () => void | Promise<void>;

export type ScopeCleanupErrorContext = {
  label: string | undefined;
  labelPath: string | undefined;
  logger: Logger;
};

export interface Scope {
  readonly disposed: boolean;
  readonly log: Logger;
  add(cleanup: ScopeCleanup): void;
  use<T extends IDisposable>(resource: T): T;
  child(label?: string): Scope;
  dispose(): Promise<void>;
}

export type CreateScopeOptions = {
  label?: string;
  logger?: Logger;
  onCleanupError?: (error: unknown, scope: ScopeCleanupErrorContext) => void;
};

export type ScopeDescription = {
  label: string | undefined;
  labelPath: string | undefined;
  disposed: boolean;
  children: ScopeDescription[];
};

type ScopeState = {
  label: string | undefined;
  labelPath: string | undefined;
  logger: Logger;
  cleanups: ScopeCleanup[];
  children: Set<ScopeImpl>;
  onCleanupError: (error: unknown, scope: ScopeCleanupErrorContext) => void;
  disposed: boolean;
  disposePromise: Promise<void> | undefined;
};

export function createScope(options: CreateScopeOptions = {}): Scope {
  const logger = createScopeLogger(options.logger ?? ambientLog, options.label);
  return new ScopeImpl({
    label: options.label,
    labelPath: options.label,
    logger,
    cleanups: [],
    children: new Set(),
    onCleanupError: options.onCleanupError ?? defaultCleanupErrorHandler,
    disposed: false,
    disposePromise: undefined,
  });
}

class ScopeImpl implements Scope {
  constructor(readonly state: ScopeState) {}

  get disposed(): boolean {
    return this.state.disposed;
  }

  get log(): Logger {
    return this.state.logger;
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
    const labelPath = joinScopePath(this.state.labelPath, label);
    const child = new ScopeImpl({
      label,
      labelPath,
      cleanups: [],
      children: new Set(),
      onCleanupError: this.state.onCleanupError,
      logger: createScopeLogger(this.state.logger, labelPath),
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
      this.state.onCleanupError(error, {
        label: this.state.label,
        labelPath: this.state.labelPath,
        logger: this.state.logger,
      });
    }
  }
}

function defaultCleanupErrorHandler(error: unknown, scope: ScopeCleanupErrorContext): void {
  scope.logger.warn('wire scope cleanup failed', {
    label: scope.label,
    labelPath: scope.labelPath,
    error,
  });
}

export function describeScope(scope: Scope): ScopeDescription {
  if (!(scope instanceof ScopeImpl)) {
    return {
      label: undefined,
      labelPath: undefined,
      disposed: scope.disposed,
      children: [],
    };
  }
  return describeScopeImpl(scope);
}

function describeScopeImpl(scope: ScopeImpl): ScopeDescription {
  return {
    label: scope.state.label,
    labelPath: scope.state.labelPath,
    disposed: scope.state.disposed,
    children: [...scope.state.children].map((child) => describeScopeImpl(child)),
  };
}

function createScopeLogger(logger: Logger, labelPath: string | undefined): Logger {
  return labelPath ? logger.child({ scope: labelPath }) : logger;
}

function joinScopePath(parent: string | undefined, label: string | undefined): string | undefined {
  if (!label) return parent;
  return parent ? `${parent}/${label}` : label;
}
