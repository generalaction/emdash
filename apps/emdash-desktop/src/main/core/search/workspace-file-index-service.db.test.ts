import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkspaceFileEnumerator,
  WorkspaceFileIndexServiceOptions,
} from './workspace-file-index-service';

type LoadedService = Awaited<ReturnType<typeof loadService>>;
type FileIndexMetaRow = {
  root_path: string;
  status: string;
  file_count: number;
  truncate_reason: string | null;
};

let loadedService: LoadedService | undefined;

describe('WorkspaceFileIndexService', () => {
  afterEach(async () => {
    vi.useRealTimers();
    loadedService?.service.onWorkspaceDeactivated('ws-1');
    loadedService?.sqlite.close();
    if (loadedService) {
      await rm(loadedService.tempDir, { recursive: true, force: true });
    }
    loadedService = undefined;
    vi.resetModules();
    delete process.env.EMDASH_DB_FILE;
  });

  it('indexes files from core enumeration when a workspace is activated', async () => {
    loadedService = await loadService();
    const { service, sqlite } = loadedService;

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/README.md', '/repo/src/index.ts']),
    });

    expect(indexedPaths(sqlite)).toEqual(['/repo/README.md', '/repo/src/index.ts']);
    expect(indexMeta(sqlite)).toEqual({
      root_path: '/repo',
      status: 'complete',
      file_count: 2,
      truncate_reason: null,
    });
    expect(service.search('ws-1', 'index')).toEqual([
      { path: '/repo/src/index.ts', filename: 'index.ts' },
    ]);
  });

  it('applies path-changing file events incrementally', async () => {
    loadedService = await loadService();
    const { service, sqlite } = loadedService;

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/src/changed.ts', '/repo/src/old.ts']),
    });

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [
        { kind: 'create', path: '/repo/src/new.ts', entryType: 'file' },
        { kind: 'update', path: '/repo/src/changed.ts', entryType: 'file' },
        { kind: 'update', path: '/repo/src/missing.ts', entryType: 'file' },
        { kind: 'delete', path: '/repo/src/old.ts', entryType: 'file' },
      ],
    });

    expect(indexedPaths(sqlite)).toEqual(['/repo/src/changed.ts', '/repo/src/new.ts']);
    expect(indexMeta(sqlite)).toMatchObject({ status: 'complete', file_count: 2 });
  });

  it('removes descendants when a directory-like path is deleted', async () => {
    loadedService = await loadService();
    const { service, sqlite } = loadedService;

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/other.ts', '/repo/src/a.ts', '/repo/src/nested/b.ts']),
    });

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [{ kind: 'delete', path: '/repo/src', entryType: 'unknown' }],
    });

    expect(indexedPaths(sqlite)).toEqual(['/repo/other.ts']);
    expect(indexMeta(sqlite)).toMatchObject({ status: 'complete', file_count: 1 });
  });

  it('reindexes from core enumeration on resync', async () => {
    vi.useFakeTimers();
    loadedService = await loadService({ reindexDebounceMs: 1 });
    const { service, sqlite } = loadedService;
    let paths = ['/repo/stale.ts'];

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => paths),
    });
    expect(indexedPaths(sqlite)).toEqual(['/repo/stale.ts']);

    paths = ['/repo/fresh.ts'];
    service.onWorkspaceFileChange('ws-1', { kind: 'resync' });
    await vi.advanceTimersByTimeAsync(1);

    expect(indexedPaths(sqlite)).toEqual(['/repo/fresh.ts']);
    expect(indexMeta(sqlite)).toMatchObject({ status: 'complete', file_count: 1 });
  });

  it('records truncated full indexes as incomplete', async () => {
    loadedService = await loadService({ maxFiles: 2 });
    const { service, sqlite } = loadedService;

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts']),
    });

    expect(indexedPaths(sqlite)).toEqual(['/repo/a.ts', '/repo/b.ts']);
    expect(indexMeta(sqlite)).toEqual({
      root_path: '/repo',
      status: 'truncated',
      file_count: 2,
      truncate_reason: 'maxEntries',
    });

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [{ kind: 'create', path: '/repo/d.ts', entryType: 'file' }],
    });

    expect(indexedPaths(sqlite)).toEqual(['/repo/a.ts', '/repo/b.ts']);
    expect(indexMeta(sqlite)).toMatchObject({ status: 'truncated', file_count: 2 });
  });

  it('does not grow a complete index past the file cap', async () => {
    loadedService = await loadService({ maxFiles: 2 });
    const { service, sqlite } = loadedService;

    await service.onWorkspaceActivated('ws-1', {
      rootPath: '/repo',
      enumerate: enumerator(() => ['/repo/a.ts', '/repo/b.ts']),
    });

    service.onWorkspaceFileChange('ws-1', {
      kind: 'changes',
      changes: [{ kind: 'create', path: '/repo/c.ts', entryType: 'file' }],
    });

    expect(indexedPaths(sqlite)).toEqual(['/repo/a.ts', '/repo/b.ts']);
    expect(indexMeta(sqlite)).toMatchObject({ status: 'stale', file_count: 2 });
  });
});

async function loadService(options: WorkspaceFileIndexServiceOptions = {}) {
  vi.resetModules();
  const tempDir = await mkdtemp(join(tmpdir(), 'emdash-file-index-'));
  process.env.EMDASH_DB_FILE = join(tempDir, 'test.db');

  const [{ WorkspaceFileIndexService }, { sqlite }] = await Promise.all([
    import('./workspace-file-index-service'),
    import('@main/db/client'),
  ]);
  createFileIndexTables(sqlite);

  return {
    service: new WorkspaceFileIndexService(options),
    sqlite,
    tempDir,
  };
}

function createFileIndexTables(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE VIRTUAL TABLE workspace_file_index USING fts5(
      workspace_id UNINDEXED,
      path,
      filename,
      tokenize = 'trigram case_sensitive 0'
    );
    CREATE TABLE workspace_file_index_meta (
      workspace_id     TEXT PRIMARY KEY,
      indexed_at       INTEGER NOT NULL,
      root_path        TEXT NOT NULL,
      status           TEXT NOT NULL
        CHECK (status IN ('complete', 'stale', 'truncated')),
      file_count       INTEGER NOT NULL,
      truncate_reason  TEXT
        CHECK (truncate_reason IS NULL OR truncate_reason IN ('maxEntries', 'timeBudget'))
    );
  `);
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

function indexedPaths(sqlite: BetterSqlite3.Database): string[] {
  return (
    sqlite.prepare(`SELECT path FROM workspace_file_index ORDER BY path`).all() as Array<{
      path: string;
    }>
  ).map((row) => row.path);
}

function indexMeta(sqlite: BetterSqlite3.Database): FileIndexMetaRow | undefined {
  return sqlite
    .prepare(
      `SELECT root_path, status, file_count, truncate_reason
       FROM workspace_file_index_meta
       WHERE workspace_id = 'ws-1'`
    )
    .get() as FileIndexMetaRow | undefined;
}
