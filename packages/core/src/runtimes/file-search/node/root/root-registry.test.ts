import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootWatchError } from '../path/index/errors';
import type { RootIndex } from '../path/index/root-index';
import type { StoredFileSearchRoot } from '../storage/root-catalog-store';
import { SqliteFileSearchStore } from '../storage/sqlite-file-search-store';
import { hostPath as absolute } from '../testing/paths';
import type { RegisteredRoot } from './registered-root';
import { NodeFileSearchRootResolver } from './root-identity';
import { FileSearchRootRegistry } from './root-registry';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('FileSearchRootRegistry', () => {
  it('constructs a registered root from the persisted record and lifecycle scope', async () => {
    const rootPath = await createRoot();
    const createRegistered = vi.fn(fakeRoot);
    const { registry } = createRegistry({ createRoot: createRegistered });
    const root = absolute(rootPath);

    await expect(registry.registerRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(createRegistered).toHaveBeenCalledOnce();
    expect(createRegistered.mock.calls[0][0]).toMatchObject({ rootPath });
    expect(createRegistered.mock.calls[0][1].state).toBe('open');
    expect(registry.state(root).kind).toBe('ready');
  });

  it('keeps durable registrations when registry shutdown stops maintenance', async () => {
    const rootPath = await createRoot();
    const { registry, store } = createRegistry();
    await registry.registerRoot({ root: absolute(rootPath) });

    await registry.dispose();

    expect(store.listRoots()).toHaveLength(1);
  });

  it('explicitly removes a persisted root whose restoration failed to start', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const resolver = new NodeFileSearchRootResolver();
    const resolved = await resolver.resolve(root);
    if (!resolved.success) throw new Error('Expected root to resolve');
    const store = new SqliteFileSearchStore({ databasePath: ':memory:' });
    store.upsertRoot(resolved.data);
    await rm(rootPath, { recursive: true, force: true });
    const { registry } = createRegistry({ store });

    await vi.waitFor(() => expect(registry.state(root).kind).toBe('start-failed'));
    await expect(registry.unregisterRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(store.listRoots()).toEqual([]);
    expect(registry.state(root).kind).toBe('not-registered');
  });

  it('rolls back a new durable row when registered-root construction fails', async () => {
    const rootPath = await createRoot();
    const failure = Object.assign(new Error('root disappeared'), { code: 'ENOENT' });
    const { registry, store } = createRegistry({
      createRoot: () => {
        throw new RootWatchError('File-search watcher could not be created for the root', failure);
      },
    });

    await expect(registry.registerRoot({ root: absolute(rootPath) })).resolves.toMatchObject({
      success: false,
      error: { type: 'root-unavailable', reason: 'not-found' },
    });
    expect(store.listRoots()).toEqual([]);
  });

  it('throws when registration and its persistence rollback both fail', async () => {
    const rootPath = await createRoot();
    const attachmentFailure = Object.assign(new Error('root disappeared'), { code: 'ENOENT' });
    const rollbackFailure = Object.assign(new Error('database busy'), { code: 'SQLITE_BUSY' });
    const store = new SqliteFileSearchStore({ databasePath: ':memory:' });
    vi.spyOn(store, 'deleteRoot').mockImplementation(() => {
      throw rollbackFailure;
    });
    const { registry } = createRegistry({
      store,
      createRoot: () => {
        throw new RootWatchError(
          'File-search watcher could not be created for the root',
          attachmentFailure
        );
      },
    });

    const registration = registry.registerRoot({ root: absolute(rootPath) });
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
    createRoot?: (record: StoredFileSearchRoot, scope: Scope) => RegisteredRoot;
  } = {}
): { registry: FileSearchRootRegistry; store: SqliteFileSearchStore; scope: Scope } {
  const store = options.store ?? new SqliteFileSearchStore({ databasePath: ':memory:' });
  const scope = createScope({ label: 'root-registry-test' });
  const registry = new FileSearchRootRegistry({
    catalog: store,
    resolver: new NodeFileSearchRootResolver(),
    createRoot: options.createRoot ?? fakeRoot,
    scope,
  });
  cleanups.push(async () => {
    await registry.dispose();
    await scope.dispose();
    store.close();
  });
  return { registry, store, scope };
}

function fakeRoot(record: StoredFileSearchRoot, scope: Scope): RegisteredRoot {
  return { record, scope, index: {} as RootIndex };
}

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-root-registry-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}
