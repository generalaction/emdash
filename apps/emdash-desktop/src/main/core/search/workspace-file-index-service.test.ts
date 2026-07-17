import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceFileEnumerator } from './workspace-file-index-service';
import type {
  FileHit,
  FileIndexMeta,
  IWorkspaceFileIndexStore,
} from './workspace-file-index-store';

vi.mock('./workspace-file-index-store', () => ({
  WorkspaceFileIndexStore: class {},
}));

describe('WorkspaceFileIndexService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('delegates initialize and search to the store', async () => {
    const store = new FakeStore();
    store.searchResults = [{ path: '/repo/src/index.ts', filename: 'index.ts' }];
    store.searchFilesResults = [{ path: '/repo/src/app.ts', filename: 'app.ts' }];
    const service = await createService(store);

    service.initialize();

    expect(store.evictedDays).toBe(14);
    expect(service.search('ws-1', 'index')).toEqual([
      { path: '/repo/src/index.ts', filename: 'index.ts' },
    ]);
    expect(service.searchFiles('ws-1', 'ap', 5)).toEqual([
      { path: '/repo/src/app.ts', filename: 'app.ts' },
    ]);
    expect(store.operations).toContain('search:index');
    expect(store.operations).toContain('searchFiles:ap:5');
  });

  it('refreshes complete metadata on activation without enumerating', async () => {
    const store = new FakeStore();
    store.meta.set('ws-1', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });
    const service = await createService(store);

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => {
        throw new Error('should not enumerate');
      }),
    });

    expect(store.operations).toEqual(['refresh:ws-1']);
  });

  it('reindexes when a complete index belongs to an old workspace root', async () => {
    const store = new FakeStore();
    store.meta.set('ws-1', {
      rootPath: '/old-repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });
    store.paths.set('ws-1', new Set(['/old-repo/stale.ts']));
    const service = await createService(store);

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/fresh.ts']),
    });

    expect([...store.pathSet('ws-1')]).toEqual(['/repo/fresh.ts']);
    expect(store.meta.get('ws-1')).toEqual({
      rootPath: '/repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });
    expect(store.operations).toContain('deleteIndex:ws-1');
  });

  it('indexes from enumeration when metadata is missing', async () => {
    const store = new FakeStore();
    const service = await createService(store);

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/README.md', '/repo/src/index.ts']),
    });

    expect([...store.pathSet('ws-1')].sort()).toEqual(['/repo/README.md', '/repo/src/index.ts']);
    expect(store.meta.get('ws-1')).toEqual({
      rootPath: '/repo',
      status: 'complete',
      fileCount: 2,
      truncateReason: null,
    });
  });

  it('debounces and coalesces resync requests', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    store.meta.set('ws-1', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });
    const service = await createService(store, { reindexDebounceMs: 5 });

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/fresh.ts']),
    });
    service.onWorkspaceFileChange('ws-1', { kind: 'resync' });
    service.onWorkspaceFileChange('ws-1', { kind: 'resync' });

    await vi.advanceTimersByTimeAsync(5);

    expect(store.operations.filter((op) => op.startsWith('sync:'))).toEqual([
      'sync:/repo/fresh.ts',
    ]);
    expect(store.meta.get('ws-1')).toMatchObject({ status: 'complete', fileCount: 1 });
  });

  it('ignores update-only batches without touching the path index', async () => {
    const store = new FakeStore();
    store.meta.set('ws-1', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });
    store.paths.set('ws-1', new Set(['/repo/changed.ts']));
    const service = await createService(store);

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [{ kind: 'update', path: '/repo/changed.ts', entryType: 'file' }],
    });

    expect(store.operations).toEqual([]);
  });

  it('reindexes an active workspace when an update-only batch finds missing metadata', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    const service = await createService(store, { reindexDebounceMs: 5 });

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/changed.ts']),
    });
    service.deleteIndex('ws-1');
    store.operations = [];

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [{ kind: 'update', path: '/repo/changed.ts', entryType: 'file' }],
    });
    await vi.advanceTimersByTimeAsync(5);

    expect([...store.pathSet('ws-1')]).toEqual(['/repo/changed.ts']);
    expect(store.operations).toEqual(['transaction', 'sync:/repo/changed.ts', 'record:complete:1']);
  });

  it('applies deletes before creates, ignores updates, and recounts once for subtree deletes', async () => {
    const store = new FakeStore();
    store.meta.set('ws-1', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 3,
      truncateReason: null,
    });
    store.paths.set('ws-1', new Set(['/repo/changed.ts', '/repo/dir/a.ts', '/repo/old.ts']));
    const service = await createService(store);

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [
        { kind: 'create', path: '/repo/new.ts', entryType: 'file' },
        { kind: 'update', path: '/repo/missing.ts', entryType: 'file' },
        { kind: 'delete', path: '/repo/old.ts', entryType: 'file' },
        { kind: 'delete', path: '/repo/dir', entryType: 'unknown' },
      ],
    });

    expect([...store.pathSet('ws-1')].sort()).toEqual(['/repo/changed.ts', '/repo/new.ts']);
    expect(store.operations).toEqual([
      'transaction',
      'count:ws-1',
      'deletePath:/repo/old.ts',
      'deleteSubtree:/repo/dir',
      'count:ws-1',
      'insert:/repo/new.ts',
      'count:ws-1',
      'record:complete:2',
    ]);
  });

  it('marks the index stale when creates would exceed the cap', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    store.meta.set('ws-1', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 2,
      truncateReason: null,
    });
    store.paths.set('ws-1', new Set(['/repo/a.ts', '/repo/b.ts']));
    const service = await createService(store, { maxFiles: 2, reindexDebounceMs: 1_000 });

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts']),
    });
    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [
        { kind: 'delete', path: '/repo/missing.ts', entryType: 'file' },
        { kind: 'create', path: '/repo/c.ts', entryType: 'file' },
      ],
    });

    expect([...store.pathSet('ws-1')].sort()).toEqual(['/repo/a.ts', '/repo/b.ts']);
    expect(store.meta.get('ws-1')).toMatchObject({ status: 'stale', fileCount: 2 });
  });

  it('marks the index stale for symlink changes instead of indexing them incrementally', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    store.meta.set('ws-1', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });
    store.paths.set('ws-1', new Set(['/repo/a.ts']));
    const service = await createService(store, { reindexDebounceMs: 1_000 });

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/a.ts']),
    });
    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [{ kind: 'create', path: '/repo/link', entryType: 'symlink' }],
    });

    expect([...store.pathSet('ws-1')]).toEqual(['/repo/a.ts']);
    expect(store.meta.get('ws-1')).toMatchObject({ status: 'stale', fileCount: 1 });
  });

  it('ignores incremental changes while the current index is truncated', async () => {
    const store = new FakeStore();
    store.meta.set('ws-1', {
      rootPath: '/repo',
      status: 'truncated',
      fileCount: 2,
      truncateReason: 'maxEntries',
    });
    store.paths.set('ws-1', new Set(['/repo/a.ts', '/repo/b.ts']));
    const service = await createService(store);

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [{ kind: 'create', path: '/repo/c.ts', entryType: 'file' }],
    });

    expect([...store.pathSet('ws-1')].sort()).toEqual(['/repo/a.ts', '/repo/b.ts']);
    expect(store.operations).toEqual([]);
  });
});

async function createService(
  store: FakeStore,
  options: { maxFiles?: number; reindexDebounceMs?: number } = {}
) {
  const { WorkspaceFileIndexService } = await import('./workspace-file-index-service');
  return new WorkspaceFileIndexService({ store, ...options });
}

function enumerator(readPaths: () => readonly string[]): WorkspaceFileEnumerator {
  return () => ({
    success: true as const,
    data: (async function* () {
      for (const path of readPaths()) {
        yield path;
      }
    })(),
  });
}

class FakeStore implements IWorkspaceFileIndexStore {
  meta = new Map<string, FileIndexMeta>();
  paths = new Map<string, Set<string>>();
  operations: string[] = [];
  evictedDays: number | undefined;
  searchResults: FileHit[] = [];
  searchFilesResults: FileHit[] = [];

  transaction<T>(fn: () => T): T {
    this.operations.push('transaction');
    return fn();
  }

  getMeta(workspaceId: string): FileIndexMeta | null {
    return this.meta.get(workspaceId) ?? null;
  }

  recordMeta(workspaceId: string, meta: FileIndexMeta): void {
    this.operations.push(`record:${meta.status}:${meta.fileCount}`);
    this.meta.set(workspaceId, meta);
  }

  refreshMetaTimestamp(workspaceId: string): void {
    this.operations.push(`refresh:${workspaceId}`);
  }

  syncRows(workspaceId: string, paths: string[]): void {
    this.operations.push(`sync:${paths.join(',')}`);
    this.paths.set(workspaceId, new Set(paths));
  }

  insertPath(workspaceId: string, path: string): boolean {
    this.operations.push(`insert:${path}`);
    const paths = this.pathSet(workspaceId);
    const alreadyIndexed = paths.has(path);
    paths.add(path);
    return !alreadyIndexed;
  }

  deletePath(workspaceId: string, path: string): boolean {
    this.operations.push(`deletePath:${path}`);
    return this.pathSet(workspaceId).delete(path);
  }

  deleteSubtree(workspaceId: string, path: string): void {
    this.operations.push(`deleteSubtree:${path}`);
    const paths = this.pathSet(workspaceId);
    for (const indexedPath of [...paths]) {
      if (indexedPath === path || indexedPath.startsWith(`${path}/`)) {
        paths.delete(indexedPath);
      }
    }
  }

  countIndexedFiles(workspaceId: string): number {
    this.operations.push(`count:${workspaceId}`);
    return this.pathSet(workspaceId).size;
  }

  search(_workspaceId: string, query: string): FileHit[] {
    this.operations.push(`search:${query}`);
    return this.searchResults;
  }

  searchFiles(_workspaceId: string, query: string, limit: number): FileHit[] {
    this.operations.push(`searchFiles:${query}:${limit}`);
    return this.searchFilesResults;
  }

  deleteIndex(workspaceId: string): void {
    this.operations.push(`deleteIndex:${workspaceId}`);
    this.paths.delete(workspaceId);
    this.meta.delete(workspaceId);
  }

  evict(staleDays: number): void {
    this.evictedDays = staleDays;
  }

  pathSet(workspaceId: string): Set<string> {
    let paths = this.paths.get(workspaceId);
    if (!paths) {
      paths = new Set();
      this.paths.set(workspaceId, paths);
    }
    return paths;
  }
}
