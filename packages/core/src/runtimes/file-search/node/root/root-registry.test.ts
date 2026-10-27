import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreHandle } from '#primitives/sqlite-store/api';
import { RootWatchError } from '../path/index/errors';
import type { RootIndex } from '../path/index/root-index';
import { SqliteFileSearchStore } from '../storage/sqlite-file-search-store';
import { fileSearchStore, type FileSearchDb } from '../storage/store';
import { hostPath as absolute } from '../testing/paths';
import type { RegisteredRoot, StoredFileSearchRoot } from './registered-root';
import { NodeFileSearchRootResolver } from './root-identity';
import { FileSearchRootRegistry } from './root-registry';

const cleanups: Array<() => void | Promise<void>> = [];
const storeHandles = new WeakMap<
  SqliteFileSearchStore,
  StoreHandle<FileSearchDb, Database.Database>
>();

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('FileSearchRootRegistry', () => {
  it('constructs a registered root from the persisted record and lifecycle scope', async () => {
    const rootPath = await createRoot();
    const createRegistered = vi.fn(fakeRoot);
    const { registry } = createRegistry({ createRoot: createRegistered });
    const root = absolute(rootPath);

    await expect(registry.acquireRoot({ root })).resolves.toMatchObject({ success: true });
    expect(createRegistered).toHaveBeenCalledOnce();
    expect(createRegistered.mock.calls[0][0]).toMatchObject({ rootPath });
    expect(createRegistered.mock.calls[0][1].state).toBe('open');
    expect(registry.resolveRegisteredRoot(root)).toMatchObject({ success: true });
  });

  it('rebuilds the index when a released root is re-leased with different exclusions', async () => {
    const rootPath = await createRoot();
    const createRegistered = vi.fn(fakeRoot);
    const { registry } = createRegistry({ createRoot: createRegistered });
    const root = absolute(rootPath);

    const first = await registry.acquireRoot({ root });
    if (!first.success) throw new Error('Expected lease to acquire');
    expect(createRegistered).toHaveBeenCalledTimes(1);
    await first.data.release();

    // A new lease with different exclusions rebuilds under the new policy.
    const second = await registry.acquireRoot({ root, exclusions: ['node_modules'] });
    expect(second).toMatchObject({ success: true });
    expect(createRegistered).toHaveBeenCalledTimes(2);

    // Catalog row must be preserved (not re-created).
    expect(registry.resolveRegisteredRoot(root)).toMatchObject({ success: true });
  });

  it('shares the index across leases with the same exclusion set (order-insensitive)', async () => {
    const rootPath = await createRoot();
    const createRegistered = vi.fn(fakeRoot);
    const { registry } = createRegistry({ createRoot: createRegistered });
    const root = absolute(rootPath);

    await registry.acquireRoot({ root, exclusions: ['dist', 'build'] });
    await registry.acquireRoot({ root, exclusions: ['build', 'dist'] });

    // Same canonical set — no stop+start should occur.
    expect(createRegistered).toHaveBeenCalledTimes(1);
  });

  it('keeps durable registrations when registry shutdown stops maintenance', async () => {
    const rootPath = await createRoot();
    const { registry, store } = createRegistry();
    await registry.acquireRoot({ root: absolute(rootPath) });

    await registry.dispose();

    expect(store.listRoots()).toHaveLength(1);
  });

  it('starts no maintenance for persisted rows and keeps them as cold cache', async () => {
    const rootPath = await createRoot();
    const store = await createPersistedStore(rootPath);
    const createRegistered = vi.fn(fakeRoot);
    const { registry } = createRegistry({ store, createRoot: createRegistered });

    expect(createRegistered).not.toHaveBeenCalled();
    expect(registry.resolveRegisteredRoot(absolute(rootPath))).toMatchObject({
      success: false,
      error: { type: 'root-not-registered' },
    });
    expect(store.listRoots()).toHaveLength(1);
  });

  it('prunes catalog rows for definitively missing roots during validation', async () => {
    const rootPath = await createRoot();
    const store = await createPersistedStore(rootPath);
    await rm(rootPath, { recursive: true, force: true });
    const createRegistered = vi.fn(fakeRoot);
    const { registry } = createRegistry({ store, createRoot: createRegistered });

    await registry.startCatalogValidation();

    expect(store.listRoots()).toEqual([]);
    expect(createRegistered).not.toHaveBeenCalled();
  });

  it('retains catalog rows when the validation probe fails transiently', async () => {
    const rootPath = await createRoot();
    const store = await createPersistedStore(rootPath);
    await rm(rootPath, { recursive: true, force: true });
    // A transient failure (permissions, I/O) is not proof the root is gone.
    const probeRootMissing = vi.fn(async () => false);
    const { registry } = createRegistry({ store, probeRootMissing });

    await registry.startCatalogValidation();

    expect(probeRootMissing).toHaveBeenCalledOnce();
    expect(store.listRoots()).toHaveLength(1);
  });

  it('never prunes a root that registers while its validation probe is in flight', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const store = await createPersistedStore(rootPath);
    let enterProbe: () => void = () => {};
    const probeEntered = new Promise<void>((resolve) => {
      enterProbe = resolve;
    });
    let reportMissing: (missing: boolean) => void = () => {};
    const probeRootMissing = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          reportMissing = resolve;
          enterProbe();
        })
    );
    const { registry } = createRegistry({ store, probeRootMissing });

    const sweep = registry.startCatalogValidation();
    await probeEntered;
    await registry.acquireRoot({ root });
    // A stale "missing" verdict must lose to the registration that now owns the row.
    reportMissing(true);
    await sweep;

    expect(store.listRoots()).toHaveLength(1);
    expect(registry.resolveRegisteredRoot(root)).toMatchObject({ success: true });
  });

  it('deletes a cold persisted row on evict without starting maintenance', async () => {
    const rootPath = await createRoot();
    const store = await createPersistedStore(rootPath);
    const createRegistered = vi.fn(fakeRoot);
    const { registry } = createRegistry({ store, createRoot: createRegistered });

    await expect(registry.evictRoot({ root: absolute(rootPath) })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(store.listRoots()).toEqual([]);
    expect(createRegistered).not.toHaveBeenCalled();
  });

  it('shares maintenance across identical leases and stops after the last release', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const createRegistered = vi.fn(fakeRoot);
    const { registry, store } = createRegistry({ createRoot: createRegistered });

    const first = await registry.acquireRoot({ root });
    const second = await registry.acquireRoot({ root });
    if (!first.success || !second.success) throw new Error('Expected leases to acquire');
    expect(createRegistered).toHaveBeenCalledOnce();

    await first.data.release();
    expect(registry.resolveRegisteredRoot(root)).toMatchObject({ success: true });

    await second.data.release();
    expect(registry.resolveRegisteredRoot(root)).toMatchObject({
      success: false,
      error: { type: 'root-not-registered' },
    });
    // Releasing the last lease keeps the catalog row as cold cache.
    expect(store.listRoots()).toHaveLength(1);
  });

  it('rejects a concurrent conflicting exclusion policy with a typed error', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const { registry } = createRegistry();

    const holder = await registry.acquireRoot({ root, exclusions: ['dist'] });
    if (!holder.success) throw new Error('Expected lease to acquire');

    await expect(registry.acquireRoot({ root, exclusions: ['build'] })).resolves.toMatchObject({
      success: false,
      error: { type: 'exclusion-policy-conflict' },
    });
    // The rejected attempt must not disturb the holder's maintenance.
    expect(registry.resolveRegisteredRoot(root)).toMatchObject({ success: true });
    await holder.data.release();
  });

  it('hands over deterministically when release precedes a different-policy acquire', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const createRegistered = vi.fn(fakeRoot);
    const { registry } = createRegistry({ createRoot: createRegistered });

    const first = await registry.acquireRoot({ root, exclusions: ['dist'] });
    if (!first.success) throw new Error('Expected lease to acquire');
    // Initiate the release without awaiting it: the count drops in its
    // synchronous prefix, so the acquire below must queue behind the in-flight
    // stop and start fresh under the new policy instead of conflicting.
    const releasing = first.data.release();
    const second = await registry.acquireRoot({ root, exclusions: ['build'] });
    await releasing;

    expect(second).toMatchObject({ success: true });
    expect(createRegistered).toHaveBeenCalledTimes(2);
    if (second.success) await second.data.release();
  });

  it('invalidates outstanding leases when the root is evicted', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const { registry, store } = createRegistry();
    const lease = await registry.acquireRoot({ root });
    if (!lease.success) throw new Error('Expected lease to acquire');

    await expect(registry.evictRoot({ root })).resolves.toEqual({ success: true, data: undefined });
    expect(store.listRoots()).toEqual([]);
    expect(registry.resolveRegisteredRoot(root)).toMatchObject({
      success: false,
      error: { type: 'root-not-registered' },
    });

    // A stale release after eviction is a no-op, not a second stop.
    await lease.data.release();
    expect(store.listRoots()).toEqual([]);
  });

  it('rolls back a new durable row when registered-root construction fails', async () => {
    const rootPath = await createRoot();
    const failure = Object.assign(new Error('root disappeared'), { code: 'ENOENT' });
    const { registry, store } = createRegistry({
      createRoot: (_record, _scope, _exclusions, _fingerprint) => {
        throw new RootWatchError('File-search watcher could not be created for the root', failure);
      },
    });

    await expect(registry.acquireRoot({ root: absolute(rootPath) })).resolves.toMatchObject({
      success: false,
      error: { type: 'root-unavailable', reason: 'not-found' },
    });
    expect(store.listRoots()).toEqual([]);
  });

  it('throws when registration and its persistence rollback both fail', async () => {
    const rootPath = await createRoot();
    const attachmentFailure = Object.assign(new Error('root disappeared'), { code: 'ENOENT' });
    const rollbackFailure = Object.assign(new Error('database busy'), { code: 'SQLITE_BUSY' });
    const store = createStore();
    vi.spyOn(store, 'deleteRoot').mockImplementation(() => {
      throw rollbackFailure;
    });
    const { registry } = createRegistry({
      store,
      createRoot: (_record, _scope, _exclusions, _fingerprint) => {
        throw new RootWatchError(
          'File-search watcher could not be created for the root',
          attachmentFailure
        );
      },
    });

    const registration = registry.acquireRoot({ root: absolute(rootPath) });
    await expect(registration).rejects.toBeInstanceOf(AggregateError);
    await expect(registration).rejects.toMatchObject({
      errors: [{ cause: attachmentFailure }, rollbackFailure],
    });
    expect(store.listRoots()).toHaveLength(1);
  });
});

function createRegistry(
  options: {
    store?: SqliteFileSearchStore;
    createRoot?: (
      record: StoredFileSearchRoot,
      scope: Scope,
      exclusions: unknown,
      fingerprint: string
    ) => RegisteredRoot;
    probeRootMissing?: () => Promise<boolean>;
  } = {}
): { registry: FileSearchRootRegistry; store: SqliteFileSearchStore; scope: Scope } {
  const store = options.store ?? createStore();
  const scope = createScope({ label: 'root-registry-test' });
  const registry = new FileSearchRootRegistry({
    catalog: store,
    resolver: new NodeFileSearchRootResolver(),
    createRoot: options.createRoot ?? fakeRoot,
    compileExclusions: () => ({
      excludes: () => false,
      ripgrepGlobs: () => [],
      watchIgnoreGlobs: () => [],
    }),
    defaultExclusionPatterns: [],
    probeRootMissing: options.probeRootMissing,
    scope,
  });
  cleanups.push(async () => {
    await registry.dispose();
    await scope.dispose();
    storeHandles.get(store)?.close();
  });
  return { registry, store, scope };
}

async function createPersistedStore(rootPath: string): Promise<SqliteFileSearchStore> {
  const resolved = await new NodeFileSearchRootResolver().resolve(absolute(rootPath));
  if (!resolved.success) throw new Error('Expected root to resolve');
  const store = createStore();
  store.upsertRoot(resolved.data);
  return store;
}

function createStore(): SqliteFileSearchStore {
  const handle = fileSearchStore.open(':memory:');
  const store = new SqliteFileSearchStore(handle);
  storeHandles.set(store, handle);
  return store;
}

function fakeRoot(
  record: StoredFileSearchRoot,
  scope: Scope,
  _exclusions: unknown,
  exclusionsFingerprint: string
): RegisteredRoot {
  return { record, scope, index: {} as RootIndex, exclusionsFingerprint };
}

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-root-registry-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}
