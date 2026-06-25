import { basename } from 'node:path';
import type { RelPath } from '@emdash/core/files';
import { sqlite } from '@main/db/client';
import { log } from '@main/lib/logger';

export type FileHit = { path: string; filename: string };
export type FileIndexStatus = 'complete' | 'stale' | 'truncated';
export type FileIndexTruncateReason = 'maxEntries' | 'timeBudget';
export type FileIndexMeta = {
  status: FileIndexStatus;
  fileCount: number;
  truncateReason: FileIndexTruncateReason | null;
};

export interface IWorkspaceFileIndexStore {
  transaction<T>(fn: () => T): T;
  getMeta(workspaceId: string): FileIndexMeta | null;
  recordMeta(workspaceId: string, meta: FileIndexMeta): void;
  refreshMetaTimestamp(workspaceId: string): void;
  syncRows(workspaceId: string, paths: RelPath[]): void;
  insertPath(workspaceId: string, path: string): boolean;
  deletePath(workspaceId: string, path: string): boolean;
  deleteSubtree(workspaceId: string, path: string): void;
  countIndexedFiles(workspaceId: string): number;
  search(workspaceId: string, query: string): FileHit[];
  deleteIndex(workspaceId: string): void;
  evict(staleDays: number): void;
}

export class WorkspaceFileIndexStore implements IWorkspaceFileIndexStore {
  transaction<T>(fn: () => T): T {
    return sqlite.transaction(fn)();
  }

  getMeta(workspaceId: string): FileIndexMeta | null {
    try {
      const row = sqlite
        .prepare(
          `SELECT status, file_count, truncate_reason
           FROM workspace_file_index_meta
           WHERE workspace_id = ?`
        )
        .get(workspaceId) as
        | { status: string; file_count: number; truncate_reason: string | null }
        | undefined;

      if (!row || !isFileIndexStatus(row.status)) return null;
      return {
        status: row.status,
        fileCount: row.file_count,
        truncateReason: isFileIndexTruncateReason(row.truncate_reason) ? row.truncate_reason : null,
      };
    } catch (e) {
      log.warn('WorkspaceFileIndexStore: getMeta failed', { workspaceId, error: String(e) });
      return null;
    }
  }

  recordMeta(workspaceId: string, meta: FileIndexMeta): void {
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO workspace_file_index_meta (
           workspace_id,
           indexed_at,
           status,
           file_count,
           truncate_reason
         )
         VALUES (?, unixepoch(), ?, ?, ?)`
      )
      .run(workspaceId, meta.status, meta.fileCount, meta.truncateReason);
  }

  refreshMetaTimestamp(workspaceId: string): void {
    try {
      sqlite
        .prepare(
          `UPDATE workspace_file_index_meta
           SET indexed_at = unixepoch()
           WHERE workspace_id = ?`
        )
        .run(workspaceId);
    } catch (e) {
      log.warn('WorkspaceFileIndexStore: refreshMetaTimestamp failed', {
        workspaceId,
        error: String(e),
      });
    }
  }

  syncRows(workspaceId: string, paths: RelPath[]): void {
    const existingPaths = this.indexedPathSet(workspaceId);
    const desiredPaths = new Set<string>(paths);
    const deletePath = sqlite.prepare(
      `DELETE FROM workspace_file_index WHERE workspace_id = ? AND path = ?`
    );
    const insertPath = sqlite.prepare(
      `INSERT INTO workspace_file_index(workspace_id, path, filename) VALUES (?, ?, ?)`
    );

    for (const path of existingPaths) {
      if (!desiredPaths.has(path)) deletePath.run(workspaceId, path);
    }

    for (const path of paths) {
      if (!existingPaths.has(path)) insertPath.run(workspaceId, path, basename(path));
    }
  }

  insertPath(workspaceId: string, path: string): boolean {
    if (this.hasIndexedPath(workspaceId, path)) return false;
    sqlite
      .prepare(`INSERT INTO workspace_file_index(workspace_id, path, filename) VALUES (?, ?, ?)`)
      .run(workspaceId, path, basename(path));
    return true;
  }

  deletePath(workspaceId: string, path: string): boolean {
    const result = sqlite
      .prepare(`DELETE FROM workspace_file_index WHERE workspace_id = ? AND path = ?`)
      .run(workspaceId, path);
    return result.changes > 0;
  }

  deleteSubtree(workspaceId: string, path: string): void {
    sqlite
      .prepare(
        `DELETE FROM workspace_file_index
         WHERE workspace_id = ?
           AND (path = ? OR path LIKE ? ESCAPE '\\')`
      )
      .run(workspaceId, path, `${escapeSqliteLike(path)}/%`);
  }

  countIndexedFiles(workspaceId: string): number {
    const row = sqlite
      .prepare(`SELECT COUNT(*) AS count FROM workspace_file_index WHERE workspace_id = ?`)
      .get(workspaceId) as { count: number };
    return row.count;
  }

  search(workspaceId: string, query: string): FileHit[] {
    const terms = query
      .trim()
      .split(/[\s\-_/]+/)
      .filter((t) => t.length >= 3);

    if (terms.length === 0) return [];

    const ftsQuery = terms.map((t) => `"${t}"`).join(' AND ');
    try {
      return sqlite
        .prepare(
          `SELECT path, filename
           FROM workspace_file_index
           WHERE workspace_file_index MATCH ?
             AND workspace_id = ?
           ORDER BY bm25(workspace_file_index, 1.0, 2.0)
           LIMIT 20`
        )
        .all(ftsQuery, workspaceId) as FileHit[];
    } catch (e) {
      log.warn('WorkspaceFileIndexStore: search failed', { workspaceId, error: String(e) });
      return [];
    }
  }

  deleteIndex(workspaceId: string): void {
    try {
      sqlite.transaction(() => {
        sqlite.prepare(`DELETE FROM workspace_file_index WHERE workspace_id = ?`).run(workspaceId);
        sqlite
          .prepare(`DELETE FROM workspace_file_index_meta WHERE workspace_id = ?`)
          .run(workspaceId);
      })();
      log.info('WorkspaceFileIndexStore: deleted index', { workspaceId });
    } catch (e) {
      log.warn('WorkspaceFileIndexStore: deleteIndex failed', { workspaceId, error: String(e) });
    }
  }

  evict(staleDays: number): void {
    this.evictStale(staleDays);
    this.evictOrphans();
  }

  private indexedPathSet(workspaceId: string): Set<string> {
    const rows = sqlite
      .prepare(`SELECT path FROM workspace_file_index WHERE workspace_id = ?`)
      .all(workspaceId) as Array<{ path: string }>;
    return new Set(rows.map((row) => row.path));
  }

  private hasIndexedPath(workspaceId: string, path: string): boolean {
    return Boolean(
      sqlite
        .prepare(`SELECT 1 FROM workspace_file_index WHERE workspace_id = ? AND path = ? LIMIT 1`)
        .get(workspaceId, path)
    );
  }

  private evictStale(staleDays: number): void {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - staleDays * 86400;
      const stale = sqlite
        .prepare(`SELECT workspace_id FROM workspace_file_index_meta WHERE indexed_at < ?`)
        .all(cutoff) as Array<{ workspace_id: string }>;

      if (stale.length === 0) return;

      sqlite.transaction(() => {
        const delIndex = sqlite.prepare(`DELETE FROM workspace_file_index WHERE workspace_id = ?`);
        const delMeta = sqlite.prepare(
          `DELETE FROM workspace_file_index_meta WHERE workspace_id = ?`
        );
        for (const row of stale) {
          delIndex.run(row.workspace_id);
          delMeta.run(row.workspace_id);
        }
      })();
      log.info('WorkspaceFileIndexStore: evicted stale indexes', { count: stale.length });
    } catch (e) {
      log.warn('WorkspaceFileIndexStore: evictStale failed', { error: String(e) });
    }
  }

  private evictOrphans(): void {
    try {
      const orphans = sqlite
        .prepare(
          `SELECT m.workspace_id
           FROM workspace_file_index_meta m
           LEFT JOIN workspaces w ON w.id = m.workspace_id
           WHERE w.id IS NULL`
        )
        .all() as Array<{ workspace_id: string }>;

      if (orphans.length === 0) return;

      sqlite.transaction(() => {
        const delIndex = sqlite.prepare(`DELETE FROM workspace_file_index WHERE workspace_id = ?`);
        const delMeta = sqlite.prepare(
          `DELETE FROM workspace_file_index_meta WHERE workspace_id = ?`
        );
        for (const row of orphans) {
          delIndex.run(row.workspace_id);
          delMeta.run(row.workspace_id);
        }
      })();

      log.info('WorkspaceFileIndexStore: evicted orphan indexes', { count: orphans.length });
    } catch (e) {
      log.warn('WorkspaceFileIndexStore: evictOrphans failed', { error: String(e) });
    }
  }
}

function escapeSqliteLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function isFileIndexStatus(value: string): value is FileIndexStatus {
  return value === 'complete' || value === 'stale' || value === 'truncated';
}

function isFileIndexTruncateReason(value: string | null): value is FileIndexTruncateReason {
  return value === 'maxEntries' || value === 'timeBudget';
}
