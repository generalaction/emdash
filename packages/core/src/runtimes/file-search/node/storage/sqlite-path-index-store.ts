import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  parsePortableRelativePath,
  portableRelativePathBasename,
  type PortableRelativePath,
} from '@primitives/path/api';
import type { PathEntryKind, PathSearchHit } from '@runtimes/file-search/api';
import type {
  FileSearchRootUpsertResult,
  PathIndexBuild,
  PathIndexEntry,
  PathIndexPatch,
  PathIndexStore,
  PathIndexStoreSearchResult,
  StoredFileSearchRoot,
} from '@runtimes/file-search/node/storage/path-index-store';

import { initializeFileSearchSchema } from './schema';

type RootRow = {
  id: number;
  root_key: string;
  root_path: string;
  current_generation: number | null;
};

type PathRow = {
  relative_path: string;
  kind: string;
};

type SqlitePathIndexStoreOptions = Readonly<{
  databasePath: string;
}>;

/** Synchronous by design: this Adapter runs inside the dedicated file-search worker. */
export class SqlitePathIndexStore implements PathIndexStore {
  private readonly database: DatabaseSync;
  private readonly activeBuildRootIds = new Set<number>();
  private closed = false;

  constructor(options: SqlitePathIndexStoreOptions) {
    if (options.databasePath !== ':memory:') {
      if (!path.isAbsolute(options.databasePath)) {
        throw new Error('File-search database path must be absolute or :memory:');
      }
      mkdirSync(path.dirname(options.databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(options.databasePath);
    try {
      this.database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
      `);
      initializeFileSearchSchema(this.database);
    } catch (error) {
      try {
        this.database.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          'File-search database initialization cleanup failed'
        );
      }
      throw error;
    }
  }

  listRoots(): StoredFileSearchRoot[] {
    this.assertOpen();
    const rows = this.database
      .prepare(
        `SELECT id, root_key, root_path, current_generation
         FROM registered_roots
         ORDER BY id`
      )
      .all() as RootRow[];
    return rows.map(toStoredRoot);
  }

  upsertRoot(input: { rootKey: string; rootPath: string }): FileSearchRootUpsertResult {
    this.assertOpen();
    const existing = this.rootByKey(input.rootKey);
    if (!existing) {
      const result = this.database
        .prepare(
          `INSERT INTO registered_roots (root_key, root_path, current_generation)
           VALUES (?, ?, NULL)`
        )
        .run(input.rootKey, input.rootPath);
      return {
        kind: 'created',
        root: { id: Number(result.lastInsertRowid), ...input },
      };
    }

    if (existing.root_path === input.rootPath) {
      return { kind: 'unchanged', root: toStoredRoot(existing) };
    }
    throw new Error(`Corrupt file-search root identity: ${input.rootKey}`);
  }

  deleteRoot(rootKey: string): void {
    this.assertOpen();
    this.database.prepare(`DELETE FROM registered_roots WHERE root_key = ?`).run(rootKey);
  }

  beginBuild(rootId: number): PathIndexBuild {
    this.assertOpen();
    if (this.activeBuildRootIds.has(rootId)) {
      throw new Error(`File-search root already has an active build: ${rootId}`);
    }
    const root = this.rootById(rootId);
    if (!root) throw new Error(`Cannot build an unknown file-search root: ${rootId}`);
    this.activeBuildRootIds.add(rootId);

    const generation = (root.current_generation ?? 0) + 1;
    try {
      this.database
        .prepare(
          `DELETE FROM path_entries
           WHERE root_id = ? AND (? IS NULL OR generation <> ?)`
        )
        .run(rootId, root.current_generation, root.current_generation);
    } catch (error) {
      this.activeBuildRootIds.delete(rootId);
      throw error;
    }

    let state: 'open' | 'published' | 'discarded' = 'open';
    const assertBuildOpen = (): void => {
      if (state !== 'open') throw new Error(`Path-index build is already ${state}`);
      this.assertOpen();
    };

    return {
      append: (entries) => {
        assertBuildOpen();
        this.transaction(() => this.insertEntries(rootId, generation, entries));
      },
      publish: (finalPatches) => {
        assertBuildOpen();
        this.transaction(() => {
          this.applyPatches(rootId, generation, finalPatches);
          const updated = this.database
            .prepare(
              `UPDATE registered_roots
               SET current_generation = ?
               WHERE id = ?`
            )
            .run(generation, rootId);
          if (updated.changes !== 1) {
            throw new Error(`File-search root disappeared during build: ${rootId}`);
          }
          this.database
            .prepare(`DELETE FROM path_entries WHERE root_id = ? AND generation <> ?`)
            .run(rootId, generation);
        });
        state = 'published';
        this.activeBuildRootIds.delete(rootId);
      },
      discard: () => {
        if (state !== 'open') return;
        this.assertOpen();
        try {
          this.database
            .prepare(`DELETE FROM path_entries WHERE root_id = ? AND generation = ?`)
            .run(rootId, generation);
        } finally {
          state = 'discarded';
          this.activeBuildRootIds.delete(rootId);
        }
      },
    };
  }

  applyPublishedPatches(rootId: number, patches: readonly PathIndexPatch[]): void {
    this.assertOpen();
    if (patches.length === 0) return;
    const root = this.rootById(rootId);
    if (!root) throw new Error(`Cannot patch an unknown file-search root: ${rootId}`);
    if (root.current_generation === null) {
      throw new Error(`Cannot patch file-search root ${rootId} before its first generation`);
    }
    this.transaction(() => this.applyPatches(rootId, root.current_generation!, patches));
  }

  searchPaths(
    rootKey: string,
    query: string,
    kinds: readonly PathEntryKind[],
    limit: number
  ): PathIndexStoreSearchResult {
    this.assertOpen();
    const root = this.rootByKey(rootKey);
    if (!root || root.current_generation === null) return { kind: 'not-ready' };

    const normalizedQuery = query.trim();
    const rows = normalizedQuery
      ? this.searchMatchingPaths(root, normalizedQuery, kinds, limit)
      : this.listPaths(root, kinds, limit);
    return { kind: 'ready', hits: rows.map(toPathSearchHit) };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private listPaths(root: RootRow, kinds: readonly PathEntryKind[], limit: number): PathRow[] {
    const kindClause = placeholders(kinds.length);
    return this.database
      .prepare(
        `SELECT relative_path, kind
         FROM path_entries
         WHERE root_id = ? AND generation = ? AND kind IN (${kindClause})
         ORDER BY relative_path COLLATE NOCASE, relative_path
         LIMIT ?`
      )
      .all(root.id, root.current_generation, ...kinds, limit) as PathRow[];
  }

  private searchMatchingPaths(
    root: RootRow,
    query: string,
    kinds: readonly PathEntryKind[],
    limit: number
  ): PathRow[] {
    const terms = pathSearchTerms(query);
    if (terms.length === 0) return this.searchPathsBySubstring(root, [query], kinds, limit);
    if (terms.some((term) => term.length < 3)) {
      return this.searchPathsBySubstring(root, terms, kinds, limit);
    }

    const kindClause = placeholders(kinds.length);
    const matchExpression = terms.map(quoteFtsTerm).join(' AND ');
    return this.database
      .prepare(
        `SELECT relative_path, kind
         FROM path_entries_fts
         WHERE path_entries_fts MATCH ?
           AND root_id = ?
           AND generation = ?
           AND kind IN (${kindClause})
         ORDER BY bm25(path_entries_fts, 0, 0, 0, 1, 2), relative_path COLLATE NOCASE
         LIMIT ?`
      )
      .all(matchExpression, root.id, root.current_generation, ...kinds, limit) as PathRow[];
  }

  private searchPathsBySubstring(
    root: RootRow,
    terms: readonly string[],
    kinds: readonly PathEntryKind[],
    limit: number
  ): PathRow[] {
    const kindClause = placeholders(kinds.length);
    const termClause = terms
      .map(() => '(instr(lower(name), lower(?)) > 0 OR instr(lower(relative_path), lower(?)) > 0)')
      .join(' AND ');
    const termParameters = terms.flatMap((term) => [term, term]);
    return this.database
      .prepare(
        `SELECT relative_path, kind
         FROM path_entries
         WHERE root_id = ?
           AND generation = ?
           AND kind IN (${kindClause})
           AND ${termClause}
         ORDER BY length(name), relative_path COLLATE NOCASE, relative_path
         LIMIT ?`
      )
      .all(root.id, root.current_generation, ...kinds, ...termParameters, limit) as PathRow[];
  }

  private applyPatches(
    rootId: number,
    generation: number,
    patches: readonly PathIndexPatch[]
  ): void {
    for (const patch of patches) {
      switch (patch.kind) {
        case 'upsert':
          this.insertEntries(rootId, generation, [patch.entry]);
          break;
        case 'delete-subtree':
          this.deleteSubtree(rootId, generation, patch.path);
          break;
        case 'replace-subtree':
          this.assertReplacementEntries(patch.path, patch.entries);
          this.deleteSubtree(rootId, generation, patch.path);
          this.insertEntries(rootId, generation, patch.entries);
          break;
      }
    }
  }

  private insertEntries(
    rootId: number,
    generation: number,
    entries: readonly PathIndexEntry[]
  ): void {
    if (entries.length === 0) return;
    const statement = this.database.prepare(
      `INSERT INTO path_entries (root_id, generation, relative_path, name, kind)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (root_id, generation, relative_path) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind`
    );
    for (const entry of entries) {
      statement.run(
        rootId,
        generation,
        entry.path,
        portableRelativePathBasename(entry.path),
        entry.kind
      );
    }
  }

  private deleteSubtree(rootId: number, generation: number, subtree: PortableRelativePath): void {
    if (subtree === '') {
      this.database
        .prepare(`DELETE FROM path_entries WHERE root_id = ? AND generation = ?`)
        .run(rootId, generation);
      return;
    }
    this.database
      .prepare(
        `DELETE FROM path_entries
         WHERE root_id = ?
           AND generation = ?
           AND (relative_path = ? OR relative_path LIKE ? ESCAPE '\\')`
      )
      .run(rootId, generation, subtree, `${escapeLike(subtree)}/%`);
  }

  private assertReplacementEntries(
    subtree: PortableRelativePath,
    entries: readonly PathIndexEntry[]
  ): void {
    const prefix = subtree ? `${subtree}/` : '';
    for (const entry of entries) {
      if (subtree === '' || entry.path === subtree || entry.path.startsWith(prefix)) continue;
      throw new Error(`Replacement entry '${entry.path}' is outside subtree '${subtree}'`);
    }
  }

  private rootByKey(rootKey: string): RootRow | undefined {
    return this.database
      .prepare(
        `SELECT id, root_key, root_path, current_generation
         FROM registered_roots
         WHERE root_key = ?`
      )
      .get(rootKey) as RootRow | undefined;
  }

  private rootById(rootId: number): RootRow | undefined {
    return this.database
      .prepare(
        `SELECT id, root_key, root_path, current_generation
         FROM registered_roots
         WHERE id = ?`
      )
      .get(rootId) as RootRow | undefined;
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const value = operation();
      this.database.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'File-search database rollback failed');
      }
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('File-search database is closed');
  }
}

function toStoredRoot(row: RootRow): StoredFileSearchRoot {
  return { id: Number(row.id), rootKey: row.root_key, rootPath: row.root_path };
}

function toPathSearchHit(row: PathRow): PathSearchHit {
  const parsed = parsePortableRelativePath(row.relative_path);
  if (!parsed.success || (row.kind !== 'file' && row.kind !== 'directory')) {
    throw new Error(`Corrupt path-index row: ${row.relative_path}`);
  }
  return { path: parsed.data, kind: row.kind };
}

function pathSearchTerms(query: string): string[] {
  return query
    .split(/[\s\-_/]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

function quoteFtsTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

function placeholders(count: number): string {
  if (count < 1) throw new Error('At least one path kind is required');
  return Array.from({ length: count }, () => '?').join(', ');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
