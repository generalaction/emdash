import type { IFilesRuntime, RelPath } from '@emdash/core/files';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    store.searchResults = [{ path: 'src/index.ts', filename: 'index.ts' }];
    const service = await createService(store);

    service.initialize();

    expect(store.evictedDays).toBe(14);
    expect(service.search('ws-1', 'index')).toEqual([
      { path: 'src/index.ts', filename: 'index.ts' },
    ]);
    expect(store.operations).toContain('search:index');
  });

  it('refreshes complete metadata on activation without enumerating', async () => {
    const store = new FakeStore();
    store.meta.set('ws-1', { status: 'complete', fileCount: 1, truncateReason: null });
    const service = await createService(store);

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      filesRuntime: filesRuntime(() => {
        throw new Error('should not enumerate');
      }),
    });

    expect(store.operations).toEqual(['refresh:ws-1']);
  });

  it('indexes from enumeration when metadata is missing', async () => {
    const store = new FakeStore();
    const service = await createService(store);

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      filesRuntime: filesRuntime(() => ['README.md', 'src/index.ts']),
    });

    expect([...store.pathSet('ws-1')].sort()).toEqual(['README.md', 'src/index.ts']);
    expect(store.meta.get('ws-1')).toEqual({
      status: 'complete',
      fileCount: 2,
      truncateReason: null,
    });
  });

  it('debounces and coalesces resync requests', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    store.meta.set('ws-1', { status: 'complete', fileCount: 1, truncateReason: null });
    const service = await createService(store, { reindexDebounceMs: 5 });

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      filesRuntime: filesRuntime(() => ['fresh.ts']),
    });
    service.onWorkspaceFileChange('ws-1', { kind: 'resync' });
    service.onWorkspaceFileChange('ws-1', { kind: 'resync' });

    await vi.advanceTimersByTimeAsync(5);

    expect(store.operations.filter((op) => op.startsWith('sync:'))).toEqual(['sync:fresh.ts']);
    expect(store.meta.get('ws-1')).toMatchObject({ status: 'complete', fileCount: 1 });
  });

  it('applies deletes before creates, ignores updates, and recounts once for subtree deletes', async () => {
    const store = new FakeStore();
    store.meta.set('ws-1', { status: 'complete', fileCount: 3, truncateReason: null });
    store.paths.set('ws-1', new Set(['changed.ts', 'dir/a.ts', 'old.ts']));
    const service = await createService(store);

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [
        { kind: 'create', path: 'new.ts', entryType: 'file' },
        { kind: 'update', path: 'missing.ts', entryType: 'file' },
        { kind: 'delete', path: 'old.ts', entryType: 'file' },
        { kind: 'delete', path: 'dir', entryType: 'unknown' },
      ],
    });

    expect([...store.pathSet('ws-1')].sort()).toEqual(['changed.ts', 'new.ts']);
    expect(store.operations).toEqual([
      'transaction',
      'count:ws-1',
      'deletePath:old.ts',
      'deleteSubtree:dir',
      'count:ws-1',
      'insert:new.ts',
      'count:ws-1',
      'record:complete:2',
    ]);
  });

  it('marks the index stale when creates would exceed the cap', async () => {
    vi.useFakeTimers();
    const store = new FakeStore();
    store.meta.set('ws-1', { status: 'complete', fileCount: 2, truncateReason: null });
    store.paths.set('ws-1', new Set(['a.ts', 'b.ts']));
    const service = await createService(store, { maxFiles: 2, reindexDebounceMs: 1_000 });

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      filesRuntime: filesRuntime(() => ['a.ts', 'b.ts', 'c.ts']),
    });
    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [
        { kind: 'delete', path: 'missing.ts', entryType: 'file' },
        { kind: 'create', path: 'c.ts', entryType: 'file' },
      ],
    });

    expect([...store.pathSet('ws-1')].sort()).toEqual(['a.ts', 'b.ts']);
    expect(store.meta.get('ws-1')).toMatchObject({ status: 'stale', fileCount: 2 });
  });

  it('ignores incremental changes while the current index is truncated', async () => {
    const store = new FakeStore();
    store.meta.set('ws-1', { status: 'truncated', fileCount: 2, truncateReason: 'maxEntries' });
    store.paths.set('ws-1', new Set(['a.ts', 'b.ts']));
    const service = await createService(store);

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [{ kind: 'create', path: 'c.ts', entryType: 'file' }],
    });

    expect([...store.pathSet('ws-1')].sort()).toEqual(['a.ts', 'b.ts']);
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

function filesRuntime(readPaths: () => readonly string[]): IFilesRuntime {
  return {
    openTree: async () => {
      throw new Error('openTree is not used by WorkspaceFileIndexService tests');
    },
    watchChanges: () => {
      throw new Error('watchChanges is not used by WorkspaceFileIndexService tests');
    },
    enumerate: () => ({
      success: true,
      data: (async function* () {
        for (const path of readPaths()) {
          yield path as RelPath;
        }
      })(),
    }),
    dispose: async () => {},
  };
}

class FakeStore implements IWorkspaceFileIndexStore {
  meta = new Map<string, FileIndexMeta>();
  paths = new Map<string, Set<string>>();
  operations: string[] = [];
  evictedDays: number | undefined;
  searchResults: FileHit[] = [];

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

  syncRows(workspaceId: string, paths: RelPath[]): void {
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
