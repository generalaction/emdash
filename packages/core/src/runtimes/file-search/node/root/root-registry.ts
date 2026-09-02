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
  FileSearchAcquireRootError,
  FileSearchRegisterRootError,
  FileSearchRootInput,
  FileSearchUnregisterRootError,
} from '#runtimes/file-search/api';
import {
  exclusionPolicyConflict,
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

type RootResolutionError = FileSearchRegisterRootError | ReturnType<typeof rootNotRegistered>;

export type FileSearchRootLease = Readonly<{
  root: RegisteredRoot;
  release(): Promise<void>;
}>;

type LeaseEntry = { fingerprint: string; count: number };

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

/** Owns leased maintenance lifecycle and durable cataloging for canonical file-search roots. */
export class FileSearchRootRegistry {
  private readonly lifecycle: LifecycleRegistry<
    RootStartInput,
    RegisteredRoot,
    FileSearchRegisterRootError,
    void,
    FileSearchUnregisterRootError
  >;
  private readonly leases = new Map<string, LeaseEntry>();

  constructor(private readonly options: FileSearchRootRegistryOptions) {
    this.lifecycle = createLifecycleRegistry({
      label: 'file-search-roots',
      scope: options.scope,
      keyOf: (input) => input.rootKey,
      start: (input, scope) => this.startRoot(input, scope),
      stop: () => ok(),
      onObserverError: ({ error }) => this.report('file-search root observer failed', error),
    });
  }

  /**
   * Prunes catalog rows whose roots are definitively gone. Persisted rows are
   * cold caches, not registrations: construction starts no maintenance, and
   * this sweep only ever deletes rows — it never attaches watchers or scans.
   *
   * Settles when the sweep finishes and never rejects; failures are reported
   * through `onError`. Callers that do not care about completion may void it.
   */
  startCatalogValidation(): Promise<void> {
    const run = this.options.scope.run('file-search-catalog-validation', (signal) =>
      this.validateCatalog(signal)
    );
    return run.value().catch((error: unknown) => {
      if (!this.options.scope.signal.aborted) {
        this.report('file-search catalog validation failed', error);
      }
    });
  }

  /**
   * Acquires one lease on a root's active maintenance. The first lease starts
   * maintenance, identical policies share it, and a concurrent conflicting
   * policy is rejected with a typed error instead of silently rebuilding.
   */
  async acquireRoot(
    input: FileSearchRootInput
  ): Promise<Result<FileSearchRootLease, FileSearchAcquireRootError>> {
    const rootKey = this.options.resolver.comparisonKey(input.root);
    const exclusionPatterns = canonicalExclusionPatterns(
      input.exclusions ?? this.options.defaultExclusionPatterns
    );
    const fingerprint = JSON.stringify(exclusionPatterns);

    const existing = this.leases.get(rootKey);
    if (existing && existing.fingerprint !== fingerprint) {
      return err(exclusionPolicyConflict(input.root));
    }
    const entry = existing ?? { fingerprint, count: 0 };
    entry.count += 1;
    this.leases.set(rootKey, entry);
    const firstLease = entry.count === 1;

    let registered: RegisteredRoot;
    try {
      const started = await this.lifecycle.start({ root: input.root, rootKey, exclusionPatterns });
      if (!started.success) {
        this.abandonLease(rootKey, entry);
        return err(started.error);
      }
      registered = started.data;
      if (firstLease && started.data.exclusionsFingerprint !== fingerprint) {
        await this.lifecycle.stop(rootKey, undefined);
        const rebuilt = await this.lifecycle.start({
          root: input.root,
          rootKey,
          exclusionPatterns,
        });
        if (!rebuilt.success) {
          this.abandonLease(rootKey, entry);
          return err(rebuilt.error);
        }
        registered = rebuilt.data;
      }
    } catch (error) {
      this.abandonLease(rootKey, entry);
      await this.lifecycle.forceRemove(rootKey, error);
      throw error;
    }

    return ok({ root: registered, release: this.createRelease(rootKey, entry) });
  }

  /**
   * Deletes a root's durable cache: stops any active maintenance, invalidates
   * outstanding leases, and removes the catalog row. Not part of the ordinary
   * activation/deactivation lifecycle — the root can be re-leased and rebuilt.
   */
  async evictRoot(
    input: FileSearchRootInput
  ): Promise<Result<void, FileSearchUnregisterRootError>> {
    const rootKey = this.options.resolver.comparisonKey(input.root);
    if (this.lifecycle.state(rootKey).kind === 'disposed') {
      throw new Error('File-search root registry is disposed');
    }
    this.leases.delete(rootKey);
    await this.lifecycle.stop(rootKey, undefined);
    try {
      this.options.catalog.deleteRoot(rootKey);
    } catch (error) {
      const expected = toExpectedStoreError(input.root, error, 'Unable to evict file-search root');
      if (expected) return err(expected);
      throw error;
    }
    await this.lifecycle.forceRemove(rootKey, new Error('File-search root evicted'));
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

  private abandonLease(rootKey: string, entry: LeaseEntry): void {
    if (this.leases.get(rootKey) !== entry) return;
    entry.count -= 1;
    if (entry.count <= 0) this.leases.delete(rootKey);
  }

  private createRelease(rootKey: string, entry: LeaseEntry): () => Promise<void> {
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      if (this.leases.get(rootKey) !== entry) return;
      entry.count -= 1;
      if (entry.count > 0) return;
      this.leases.delete(rootKey);
      if (this.lifecycle.state(rootKey).kind === 'disposed') return;
      await this.lifecycle.stop(rootKey, undefined);
    };
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
