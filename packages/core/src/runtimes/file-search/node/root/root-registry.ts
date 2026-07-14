import { err, ok, type Result } from '@emdash/shared';
import { LifecycleRegistry, type Scope } from '@emdash/shared/concurrency';
import type { HostAbsolutePath } from '@primitives/path/api';
import type {
  FileSearchRegisterRootError,
  FileSearchRootInput,
  FileSearchUnregisterRootError,
} from '@runtimes/file-search/api';
import type { IWatchService } from '@services/fs-watch/api';
import { hostAbsolutePathFromNative } from '../allocation/paths';
import type { FileSearchRootResolver, ResolvedFileSearchRoot } from '../allocation/root-identity';
import { toExpectedFileSearchIoError, toExpectedRootError } from '../api/errors';
import type { ConcurrencyLimiter } from '../concurrency-limiter';
import type { FileContentSearcher } from '../content/content-searcher';
import type { FileSearchExclusions } from '../exclusions';
import type { PathScanner } from '../path-index/scanner';
import type {
  FileSearchRootUpsertResult,
  PathIndexStore,
  StoredFileSearchRoot,
} from '../storage/path-index-store';
import { FileSearchRootResource, type RegisteredFileSearchRoot } from './root-resource';

type RootStartInput = Readonly<{
  root: HostAbsolutePath;
  rootKey: string;
}>;

type RootStopContext = Readonly<{ kind: 'unregister'; root: HostAbsolutePath }>;

export type FileSearchRootState =
  | Readonly<{ kind: 'not-registered' }>
  | Readonly<{ kind: 'starting' }>
  | Readonly<{ kind: 'ready'; resource: RegisteredFileSearchRoot }>
  | Readonly<{ kind: 'start-failed'; error: FileSearchRegisterRootError }>
  | Readonly<{ kind: 'stopping' }>
  | Readonly<{
      kind: 'stop-failed';
      resource: RegisteredFileSearchRoot;
      error: FileSearchUnregisterRootError;
    }>;

type FileSearchRootRegistryOptions = Readonly<{
  store: PathIndexStore;
  watcher: IWatchService;
  scanner: PathScanner;
  resolver: FileSearchRootResolver;
  exclusions: FileSearchExclusions;
  scanLimiter: ConcurrencyLimiter;
  contentLimiter: ConcurrencyLimiter;
  contentSearcher: FileContentSearcher;
  scope: Scope;
  onError?: (context: string, error: unknown) => void;
}>;

export interface FileSearchRootLookup {
  state(root: HostAbsolutePath): FileSearchRootState;
}

/** Owns durable registration and maintenance lifecycle for canonical file-search roots. */
export class FileSearchRootRegistry implements FileSearchRootLookup {
  private readonly lifecycle: LifecycleRegistry<
    RootStartInput,
    RegisteredFileSearchRoot,
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

    for (const stored of options.store.listRoots()) this.restore(stored);
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

  dispose(): Promise<void> {
    return this.lifecycle.dispose();
  }

  private async startRoot(
    input: RootStartInput,
    scope: Scope
  ): Promise<Result<RegisteredFileSearchRoot, FileSearchRegisterRootError>> {
    const resolved = await this.options.resolver.resolve(input.root);
    if (!resolved.success) return resolved;
    this.assertResolvedIdentity(input, resolved.data);

    let upserted: FileSearchRootUpsertResult;
    try {
      upserted = this.options.store.upsertRoot(resolved.data);
    } catch (error) {
      const expected = toExpectedFileSearchIoError(
        input.root,
        error,
        'Unable to persist file-search root'
      );
      if (expected) return err(expected);
      throw error;
    }

    let resource: FileSearchRootResource;
    try {
      resource = new FileSearchRootResource({
        root: upserted.root,
        store: this.options.store,
        watcher: this.options.watcher,
        scanner: this.options.scanner,
        exclusions: this.options.exclusions,
        scope,
        scanLimiter: this.options.scanLimiter,
        contentLimiter: this.options.contentLimiter,
        contentSearcher: this.options.contentSearcher,
        onError: this.options.onError,
      });
    } catch (error) {
      const expected = toExpectedRootError(
        input.root,
        error,
        'Unable to attach file-search maintenance'
      );
      if (upserted.kind === 'created') {
        try {
          this.options.store.deleteRoot(upserted.root.rootKey);
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
    return ok(resource);
  }

  private stopRoot(
    rootKey: string,
    context: RootStopContext | undefined
  ): Result<void, FileSearchUnregisterRootError> {
    if (!context) return ok();
    try {
      this.options.store.deleteRoot(rootKey);
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
      this.options.store.deleteRoot(rootKey);
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
