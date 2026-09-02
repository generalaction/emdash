import { err, ok, type Result } from '@emdash/shared';
import {
  createConcurrencyLimiter,
  createLifecycleRegistry,
  type LifecycleRegistry,
  type Scope,
} from '@emdash/shared/concurrency';
import { canonicalExclusionPatterns } from '#primitives/exclusion-policy/api';
import type { HostAbsolutePath } from '#primitives/path/api';
import type {
  FileSearchRegisterRootError,
  FileSearchRootInput,
  FileSearchUnregisterRootError,
} from '#runtimes/file-search/api';
import {
  rootNotRegistered,
  toExpectedRootOrIndexError,
  toExpectedStoreError,
} from '../error-mapping';
import type { FileSearchExclusions } from '../exclusions';
import { hostAbsolutePathFromNative } from '../native-paths';
import type { RegisteredRoot, StoredFileSearchRoot } from './registered-root';
import type { NodeFileSearchRootResolver, ResolvedFileSearchRoot } from './root-identity';

/** Keeps catalog validation background work that cannot crowd out active registrations. */
const MAX_CONCURRENT_VALIDATION_PROBES = 2;

type RootStartInput = Readonly<{
  root: HostAbsolutePath;
  rootKey: string;
  /** Canonical (sorted + deduped) exclusion patterns used to build the index. */
  exclusionPatterns: readonly string[];
}>;

type RootStopContext = Readonly<{ kind: 'unregister'; root: HostAbsolutePath }>;

type RootResolutionError = FileSearchRegisterRootError | ReturnType<typeof rootNotRegistered>;

export type FileSearchRootUpsertResult = Readonly<{
  kind: 'created' | 'unchanged';
  root: StoredFileSearchRoot;
}>;

/** Persistence view owned by registered-root lifecycle policy. */
export interface RootCatalogStore {
  listRoots(): StoredFileSearchRoot[];
  upsertRoot(input: { rootKey: string; rootPath: string }): FileSearchRootUpsertResult;
  deleteRoot(rootKey: string): void;
}

type FileSearchRootRegistryOptions = {
  catalog: RootCatalogStore;
  resolver: NodeFileSearchRootResolver;
  createRoot: (
    record: StoredFileSearchRoot,
    scope: Scope,
    exclusions: FileSearchExclusions,
    exclusionsFingerprint: string
  ) => RegisteredRoot;
  /** Compile a canonical pattern list into a matcher. */
  compileExclusions(patterns: readonly string[]): FileSearchExclusions;
  /** Patterns used when input has no exclusions. */
  defaultExclusionPatterns: readonly string[];
  probeRootMissing?: (root: HostAbsolutePath) => Promise<boolean>;
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
    this.lifecycle = createLifecycleRegistry({
      label: 'file-search-roots',
      scope: options.scope,
      keyOf: (input) => input.rootKey,
      start: (input, scope) => this.startRoot(input, scope),
      stop: (rootKey, _registration, context) => this.stopRoot(rootKey, context),
      onObserverError: ({ error }) => this.report('file-search root observer failed', error),
    });
  }

  /**
   * Prunes catalog rows whose roots are definitively gone. Persisted rows are
   * cold caches, not registrations: construction starts no maintenance, and
   * this sweep only ever deletes rows — it never attaches watchers or scans.
   */
  startCatalogValidation(): void {
    const run = this.options.scope.run('file-search-catalog-validation', (signal) =>
      this.validateCatalog(signal)
    );
    void run.value().catch((error: unknown) => {
      if (!this.options.scope.signal.aborted) {
        this.report('file-search catalog validation failed', error);
      }
    });
  }

  async registerRoot(
    input: FileSearchRootInput
  ): Promise<Result<void, FileSearchRegisterRootError>> {
    const rootKey = this.options.resolver.comparisonKey(input.root);
    const exclusionPatterns = canonicalExclusionPatterns(
      input.exclusions ?? this.options.defaultExclusionPatterns
    );
    const fingerprint = JSON.stringify(exclusionPatterns);

    try {
      const result = await this.lifecycle.start({
        root: input.root,
        rootKey,
        exclusionPatterns,
      });
      if (!result.success) return err(result.error);

      // If the ready root was built with different exclusions (e.g. restored from
      // disk with defaults before settings loaded), rebuild it with the new patterns.
      if (result.data.exclusionsFingerprint !== fingerprint) {
        // Stop without deleting the catalog row (no context → stopRoot skips delete).
        await this.lifecycle.stop(rootKey, undefined);
        const rebuild = await this.lifecycle.start({
          root: input.root,
          rootKey,
          exclusionPatterns,
        });
        if (!rebuild.success) return err(rebuild.error);
      }

      return ok();
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

  resolveRegisteredRoot(root: HostAbsolutePath): Result<RegisteredRoot, RootResolutionError> {
    const rootKey = this.options.resolver.comparisonKey(root);
    const state = this.lifecycle.state(rootKey);
    switch (state.kind) {
      case 'ready':
      case 'stop-failed':
        return ok(state.value);
      case 'start-failed':
        return err(state.error);
      case 'idle':
      case 'starting':
      case 'stopping':
        return err(rootNotRegistered(root));
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
  ): Promise<Result<RegisteredRoot, FileSearchRegisterRootError>> {
    const resolved = await this.options.resolver.resolve(input.root);
    if (!resolved.success) return resolved;
    this.assertResolvedIdentity(input, resolved.data);

    let upserted: FileSearchRootUpsertResult;
    try {
      upserted = this.options.catalog.upsertRoot(resolved.data);
    } catch (error) {
      const expected = toExpectedStoreError(
        input.root,
        error,
        'Unable to persist file-search root'
      );
      if (expected) return err(expected);
      throw error;
    }

    const fingerprint = JSON.stringify(input.exclusionPatterns);
    const exclusions = this.options.compileExclusions(input.exclusionPatterns);

    try {
      return ok(this.options.createRoot(upserted.root, scope, exclusions, fingerprint));
    } catch (error) {
      const expected = toExpectedRootOrIndexError(
        input.root,
        error,
        'Unable to attach file-search maintenance',
        'root'
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
      const expected = toExpectedStoreError(
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
      const expected = toExpectedStoreError(root, error, 'Unable to unregister file-search root');
      if (expected) return err(expected);
      throw error;
    }
    await this.lifecycle.forceRemove(rootKey, new Error('File-search root unregistered'));
    return ok();
  }

  private async validateCatalog(signal: AbortSignal): Promise<void> {
    const limiter = createConcurrencyLimiter(MAX_CONCURRENT_VALIDATION_PROBES);
    await Promise.all(
      this.options.catalog.listRoots().map(async (stored) => {
        try {
          await limiter.run(signal, () => this.validateCatalogRow(stored));
        } catch (error) {
          // One unreadable row must not stop the sweep from reaching the rest.
          if (this.options.scope.signal.aborted || signal.aborted) return;
          this.report('file-search catalog validation failed', error);
        }
      })
    );
  }

  private async validateCatalogRow(stored: StoredFileSearchRoot): Promise<void> {
    // Registered roots own their rows; the sweep only inspects cold ones.
    if (this.lifecycle.state(stored.rootKey).kind !== 'idle') return;
    const missing = await this.probeRootMissing(hostAbsolutePathFromNative(stored.rootPath));
    if (!missing) return;
    // Re-check after the probe: a root registered mid-probe must not be pruned.
    if (this.lifecycle.state(stored.rootKey).kind !== 'idle') return;
    this.options.catalog.deleteRoot(stored.rootKey);
  }

  private async probeRootMissing(root: HostAbsolutePath): Promise<boolean> {
    if (this.options.probeRootMissing) return this.options.probeRootMissing(root);
    const resolved = await this.options.resolver.resolve(root);
    if (resolved.success) return false;
    const error = resolved.error;
    return (
      error.type === 'root-unavailable' &&
      (error.reason === 'not-found' || error.reason === 'not-a-directory')
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
