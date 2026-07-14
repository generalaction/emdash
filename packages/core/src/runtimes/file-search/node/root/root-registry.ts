import { err, ok, type Result } from '@emdash/shared';
import { LifecycleRegistry, type Scope } from '@emdash/shared/concurrency';
import type { HostAbsolutePath } from '@primitives/path/api';
import type {
  ContentSearchError,
  FileSearchRegisterRootError,
  FileSearchRootInput,
  FileSearchUnregisterRootError,
  PathSearchError,
} from '@runtimes/file-search/api';
import {
  indexNotReady,
  rootNotRegistered,
  toExpectedFileSearchIoError,
  toExpectedRootError,
} from '../error-mapping';
import { hostAbsolutePathFromNative } from '../native-paths';
import type {
  FileSearchRootUpsertResult,
  RootCatalogStore,
  StoredFileSearchRoot,
} from '../storage/root-catalog-store';
import type { RegisteredRoot } from './registered-root';
import type { NodeFileSearchRootResolver, ResolvedFileSearchRoot } from './root-identity';

type RootStartInput = Readonly<{
  root: HostAbsolutePath;
  rootKey: string;
}>;

type RootStopContext = Readonly<{ kind: 'unregister'; root: HostAbsolutePath }>;

export type FileSearchRootState =
  | { kind: 'not-registered' }
  | { kind: 'starting' }
  | { kind: 'ready'; resource: RegisteredRoot }
  | { kind: 'start-failed'; error: FileSearchRegisterRootError }
  | { kind: 'stopping' }
  | {
      kind: 'stop-failed';
      resource: RegisteredRoot;
      error: FileSearchUnregisterRootError;
    };

type FileSearchRootRegistryOptions = {
  catalog: RootCatalogStore;
  resolver: NodeFileSearchRootResolver;
  createRoot: (record: StoredFileSearchRoot, scope: Scope) => RegisteredRoot;
  scope: Scope;
  onError?: (context: string, error: unknown) => void;
};

/** Owns durable registration and maintenance lifecycle for canonical file-search roots. */
export class FileSearchRootRegistry {
  private readonly lifecycle: LifecycleRegistry<
    RootStartInput,
    RegisteredRoot,
    FileSearchRegisterRootError,
    RootStopContext,
    FileSearchUnregisterRootError
  >;

  constructor(private readonly options: FileSearchRootRegistryOptions) {
    this.lifecycle = new LifecycleRegistry({
      label: 'file-search-roots',
      scope: options.scope,
      keyOf: (input) => input.rootKey,
      start: (input, scope) => this.startRoot(input, scope),
      stop: (rootKey, _registration, context) => this.stopRoot(rootKey, context),
      onObserverError: ({ error }) => this.report('file-search root observer failed', error),
    });

    for (const stored of options.catalog.listRoots()) this.restore(stored);
  }

  async registerRoot(
    input: FileSearchRootInput
  ): Promise<Result<void, FileSearchRegisterRootError>> {
    const rootKey = this.options.resolver.comparisonKey(input.root);
    try {
      const result = await this.lifecycle.start({ root: input.root, rootKey });
      return result.success ? ok() : err(result.error);
    } catch (error) {
      await this.lifecycle.forceRemove(rootKey, error);
      throw error;
    }
  }

  async unregisterRoot(
    input: FileSearchRootInput
  ): Promise<Result<void, FileSearchUnregisterRootError>> {
    const rootKey = this.options.resolver.comparisonKey(input.root);
    const before = this.lifecycle.state(rootKey);
    if (before.kind === 'disposed') throw new Error('File-search root registry is disposed');
    if (before.kind === 'idle' || before.kind === 'start-failed') {
      return this.removeFailedOrMissingRoot(rootKey, input.root);
    }

    const stopped = await this.lifecycle.stop(rootKey, { kind: 'unregister', root: input.root });
    if (!stopped.success) return stopped;

    const after = this.lifecycle.state(rootKey);
    if (after.kind === 'start-failed' || after.kind === 'starting') {
      return this.removeFailedOrMissingRoot(rootKey, input.root);
    }
    return ok();
  }

  state(root: HostAbsolutePath): FileSearchRootState {
    const rootKey = this.options.resolver.comparisonKey(root);
    const state = this.lifecycle.state(rootKey);
    switch (state.kind) {
      case 'idle':
        return { kind: 'not-registered' };
      case 'starting':
        return { kind: 'starting' };
      case 'ready':
        return { kind: 'ready', resource: state.value };
      case 'start-failed':
        return { kind: 'start-failed', error: state.error };
      case 'stopping':
        return { kind: 'stopping' };
      case 'stop-failed':
        return { kind: 'stop-failed', resource: state.value, error: state.error };
      case 'disposed':
        throw new Error('File-search root registry is disposed');
    }
  }

  resolveRegisteredRoot(
    root: HostAbsolutePath,
    options: { whenStarting: 'index-not-ready' }
  ): Result<RegisteredRoot, PathSearchError>;
  resolveRegisteredRoot(
    root: HostAbsolutePath,
    options: { whenStarting: 'root-not-registered' }
  ): Result<RegisteredRoot, ContentSearchError>;
  resolveRegisteredRoot(
    root: HostAbsolutePath,
    options: { whenStarting: 'index-not-ready' | 'root-not-registered' }
  ): Result<RegisteredRoot, PathSearchError | ContentSearchError> {
    const state = this.state(root);
    switch (state.kind) {
      case 'ready':
      case 'stop-failed':
        return ok(state.resource);
      case 'starting':
        return err(
          options.whenStarting === 'index-not-ready' ? indexNotReady(root) : rootNotRegistered(root)
        );
      case 'start-failed':
        return err(state.error);
      case 'not-registered':
      case 'stopping':
        return err(rootNotRegistered(root));
    }
  }

  dispose(): Promise<void> {
    return this.lifecycle.dispose();
  }

  private async startRoot(
    input: RootStartInput,
    scope: Scope
  ): Promise<Result<RegisteredRoot, FileSearchRegisterRootError>> {
    const resolved = await this.options.resolver.resolve(input.root);
    if (!resolved.success) return resolved;
    this.assertResolvedIdentity(input, resolved.data);

    let upserted: FileSearchRootUpsertResult;
    try {
      upserted = this.options.catalog.upsertRoot(resolved.data);
    } catch (error) {
      const expected = toExpectedFileSearchIoError(
        input.root,
        error,
        'Unable to persist file-search root'
      );
      if (expected) return err(expected);
      throw error;
    }

    try {
      return ok(this.options.createRoot(upserted.root, scope));
    } catch (error) {
      const expected = toExpectedRootError(
        input.root,
        error,
        'Unable to attach file-search maintenance'
      );
      if (upserted.kind === 'created') {
        try {
          this.options.catalog.deleteRoot(upserted.root.rootKey);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'File-search registration rollback failed'
          );
        }
      }
      if (expected) return err(expected);
      throw error;
    }
  }

  private stopRoot(
    rootKey: string,
    context: RootStopContext | undefined
  ): Result<void, FileSearchUnregisterRootError> {
    if (!context) return ok();
    try {
      this.options.catalog.deleteRoot(rootKey);
      return ok();
    } catch (error) {
      const expected = toExpectedFileSearchIoError(
        context.root,
        error,
        'Unable to unregister file-search root'
      );
      if (expected) return err(expected);
      throw error;
    }
  }

  private async removeFailedOrMissingRoot(
    rootKey: string,
    root: HostAbsolutePath
  ): Promise<Result<void, FileSearchUnregisterRootError>> {
    try {
      this.options.catalog.deleteRoot(rootKey);
    } catch (error) {
      const expected = toExpectedFileSearchIoError(
        root,
        error,
        'Unable to unregister file-search root'
      );
      if (expected) return err(expected);
      throw error;
    }
    await this.lifecycle.forceRemove(rootKey, new Error('File-search root unregistered'));
    return ok();
  }

  private restore(stored: StoredFileSearchRoot): void {
    const root = hostAbsolutePathFromNative(stored.rootPath);
    if (this.options.resolver.comparisonKey(root) !== stored.rootKey) {
      throw new Error(`Corrupt file-search root identity: ${stored.rootKey}`);
    }
    void this.lifecycle.start({ root, rootKey: stored.rootKey }).then(
      (result) => {
        if (!result.success) this.report('file-search root restoration failed', result.error);
      },
      (error: unknown) => {
        this.report('file-search root restoration crashed', error);
        void this.lifecycle.forceRemove(stored.rootKey, error);
      }
    );
  }

  private assertResolvedIdentity(input: RootStartInput, resolved: ResolvedFileSearchRoot): void {
    if (input.rootKey !== resolved.rootKey) {
      throw new Error('Resolved file-search root changed its canonical identity');
    }
  }

  private report(context: string, error: unknown): void {
    this.options.onError?.(context, error);
  }
}
