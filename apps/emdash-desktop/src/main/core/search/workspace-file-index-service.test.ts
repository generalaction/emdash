import { filesContract } from '@emdash/core/runtimes/files/api';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filesClientScope } from '@main/core/files/runtime-process/client';
import type * as FilesRuntimeClientModule from '@main/core/files/runtime-process/client';
import { portablePath } from '@shared/core/runtime/paths';
import type { WorkspaceFileIndexSource } from './workspace-file-index-service';
import type {
  FileHit,
  FileIndexMeta,
  IWorkspaceFileIndexStore,
} from './workspace-file-index-store';

const { runFilesJobMock } = vi.hoisted(() => ({ runFilesJobMock: vi.fn() }));

vi.mock('@main/core/files/runtime-process/client', async (importOriginal) => ({
  ...(await importOriginal<typeof FilesRuntimeClientModule>()),
  runFilesJob: runFilesJobMock,
}));

vi.mock('./workspace-file-index-store', () => ({
  WorkspaceFileIndexStore: class {},
}));

describe('WorkspaceFileIndexService', () => {
  beforeEach(() => {
    runFilesJobMock.mockReset();
  });

  it('delegates initialization and inactive-workspace searches to the store', async () => {
    const store = new MemoryIndexStore();
    store.rows.set('workspace', ['/repo/src/index.ts']);
    const service = await createService(store);

    service.initialize();

    expect(store.evictedDays).toBe(14);
    expect(service.search('workspace', 'index')).toEqual([
      { path: '/repo/src/index.ts', filename: 'index.ts' },
    ]);
    expect(service.searchFiles('workspace', 'index', 5)).toEqual([
      { path: '/repo/src/index.ts', filename: 'index.ts' },
    ]);
  });

  it('reindexes on activation even when a persisted index is complete', async () => {
    const store = new MemoryIndexStore();
    store.meta.set('workspace', completeMeta('/repo', 1));
    store.rows.set('workspace', ['/repo/stale.ts']);
    const service = await createService(store);
    const indexSource = source('/repo');
    runFilesJobMock.mockResolvedValue(enumeration(['fresh.ts']));

    await service.onWorkspaceActivated('workspace', indexSource);

    expect(store.rows.get('workspace')).toEqual(['/repo/fresh.ts']);
    expect(store.meta.get('workspace')).toEqual(completeMeta('/repo', 1));
    expect(runFilesJobMock).toHaveBeenCalledWith(
      filesContract.fs.enumerate,
      indexSource.files.client.fs.enumerate,
      { root: indexSource.files.root, relative: '' }
    );
  });

  it('deletes an index that belongs to an old workspace root', async () => {
    const store = new MemoryIndexStore();
    store.meta.set('workspace', completeMeta('/old-repo', 1));
    store.rows.set('workspace', ['/old-repo/stale.ts']);
    const service = await createService(store);
    runFilesJobMock.mockResolvedValue(enumeration(['fresh.ts']));

    await service.onWorkspaceActivated('workspace', source('/repo'));

    expect(store.deletedIndexes).toEqual(['workspace']);
    expect(store.rows.get('workspace')).toEqual(['/repo/fresh.ts']);
    expect(store.meta.get('workspace')).toEqual(completeMeta('/repo', 1));
  });

  it('records a truncated index when enumeration exceeds the file cap', async () => {
    const store = new MemoryIndexStore();
    const service = await createService(store, { maxFiles: 2 });
    runFilesJobMock.mockResolvedValue(enumeration(['a.ts', 'b.ts', 'c.ts']));

    await service.onWorkspaceActivated('workspace', source('/repo'));

    expect(store.rows.get('workspace')).toEqual(['/repo/a.ts', '/repo/b.ts']);
    expect(store.meta.get('workspace')).toEqual({
      rootPath: '/repo',
      status: 'truncated',
      fileCount: 2,
      truncateReason: 'maxEntries',
    });
  });

  it('leaves the existing index intact when enumeration fails', async () => {
    const store = new MemoryIndexStore();
    store.meta.set('workspace', completeMeta('/repo', 1));
    store.rows.set('workspace', ['/repo/existing.ts']);
    const service = await createService(store);
    runFilesJobMock.mockResolvedValue(
      err({ type: 'io', path: portablePath(''), message: 'enumeration failed' })
    );

    await service.onWorkspaceActivated('workspace', source('/repo'));

    expect(store.rows.get('workspace')).toEqual(['/repo/existing.ts']);
    expect(store.meta.get('workspace')).toEqual(completeMeta('/repo', 1));
  });

  it('refreshes a live workspace on search without a Files changes stream', async () => {
    const store = new MemoryIndexStore();
    runFilesJobMock
      .mockResolvedValueOnce(enumeration(['first.ts']))
      .mockResolvedValueOnce(enumeration(['first.ts', 'second.ts']));
    let now = 0;
    const service = await createService(store, {
      searchRefreshIntervalMs: 1,
      now: () => now,
    });

    await service.onWorkspaceActivated('workspace', source('/repo'));
    expect(store.rows.get('workspace')).toEqual(['/repo/first.ts']);

    now = 1;
    expect(service.searchFiles('workspace', 'second')).toEqual([]);
    await vi.waitFor(() => {
      expect(store.rows.get('workspace')).toContain('/repo/second.ts');
    });
    expect(service.searchFiles('workspace', 'second')).toEqual([
      { path: '/repo/second.ts', filename: 'second.ts' },
    ]);
    expect(runFilesJobMock).toHaveBeenCalledTimes(2);
  });

  it('reindexes the newest source when a workspace root changes mid-scan', async () => {
    const store = new MemoryIndexStore();
    const started = deferred<void>();
    const release = deferred<void>();
    const service = await createService(store);
    runFilesJobMock
      .mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
        return enumeration(['old.ts']);
      })
      .mockResolvedValueOnce(enumeration(['new.ts']));

    const firstActivation = service.onWorkspaceActivated('workspace', source('/first'));
    await started.promise;
    await service.onWorkspaceActivated('workspace', source('/second'));
    release.resolve();
    await firstActivation;

    expect(store.rows.get('workspace')).toEqual(['/second/new.ts']);
    expect(store.meta.get('workspace')?.rootPath).toBe('/second');
  });

  it('does not refresh searches after the workspace is deactivated', async () => {
    const store = new MemoryIndexStore();
    const service = await createService(store, { searchRefreshIntervalMs: 0 });
    runFilesJobMock.mockResolvedValue(enumeration(['a.ts']));

    await service.onWorkspaceActivated('workspace', source('/repo'));
    service.onWorkspaceDeactivated('workspace');
    service.searchFiles('workspace', 'a');

    expect(runFilesJobMock).toHaveBeenCalledTimes(1);
  });
});

type ServiceOptions = {
  maxFiles?: number;
  searchRefreshIntervalMs?: number;
  now?: () => number;
};

async function createService(store: MemoryIndexStore, options: ServiceOptions = {}) {
  const { WorkspaceFileIndexService } = await import('./workspace-file-index-service');
  return new WorkspaceFileIndexService({ store, ...options });
}

function source(rootPath: string): WorkspaceFileIndexSource {
  return {
    files: filesClientScope({ fs: { enumerate: {} } } as never, rootPath),
  };
}

function enumeration(paths: readonly string[]) {
  return ok({ paths: paths.map(portablePath) });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function completeMeta(rootPath: string, fileCount: number): FileIndexMeta {
  return { rootPath, status: 'complete', fileCount, truncateReason: null };
}

class MemoryIndexStore implements IWorkspaceFileIndexStore {
  readonly meta = new Map<string, FileIndexMeta>();
  readonly rows = new Map<string, string[]>();
  readonly deletedIndexes: string[] = [];
  evictedDays: number | undefined;

  transaction<T>(fn: () => T): T {
    return fn();
  }

  getMeta(workspaceId: string): FileIndexMeta | null {
    return this.meta.get(workspaceId) ?? null;
  }

  recordMeta(workspaceId: string, meta: FileIndexMeta): void {
    this.meta.set(workspaceId, meta);
  }

  refreshMetaTimestamp(): void {}

  syncRows(workspaceId: string, paths: string[]): void {
    this.rows.set(workspaceId, paths);
  }

  searchFiles(workspaceId: string, query: string, limit: number): FileHit[] {
    return this.hits(workspaceId, query).slice(0, limit);
  }

  search(workspaceId: string, query: string): FileHit[] {
    return this.hits(workspaceId, query);
  }

  insertPath(): boolean {
    return false;
  }

  deletePath(): boolean {
    return false;
  }

  deleteSubtree(): void {}

  countIndexedFiles(workspaceId: string): number {
    return this.rows.get(workspaceId)?.length ?? 0;
  }

  deleteIndex(workspaceId: string): void {
    this.deletedIndexes.push(workspaceId);
    this.rows.delete(workspaceId);
    this.meta.delete(workspaceId);
  }

  evict(staleDays: number): void {
    this.evictedDays = staleDays;
  }

  private hits(workspaceId: string, query: string): FileHit[] {
    return (this.rows.get(workspaceId) ?? [])
      .filter((path) => path.includes(query))
      .map((path) => ({ path, filename: path.slice(path.lastIndexOf('/') + 1) }));
  }
}
