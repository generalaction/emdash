import os from 'os';
import path from 'path';
import type sqlite3Type from 'sqlite3';
import { log } from '../lib/logger';

export type CodexThread = {
  id: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

let codexStatePathOverride: string | null = null;

export function _setCodexStatePathForTest(nextPath: string | null): void {
  codexStatePathOverride = nextPath;
}

function resolveCodexStatePath(): string {
  return codexStatePathOverride || path.join(os.homedir(), '.codex', 'state_5.sqlite');
}

class CodexSessionService {
  private sqliteModulePromise: Promise<typeof sqlite3Type> | null = null;

  private async loadSqliteModule(): Promise<typeof sqlite3Type> {
    if (!this.sqliteModulePromise) {
      this.sqliteModulePromise = import('sqlite3').then(
        (mod) => mod as unknown as typeof sqlite3Type
      );
    }
    return this.sqliteModulePromise;
  }

  private async openDatabase(): Promise<sqlite3Type.Database> {
    const sqliteModule = await this.loadSqliteModule();
    const dbPath = resolveCodexStatePath();

    return await new Promise<sqlite3Type.Database>((resolve, reject) => {
      const db = new sqliteModule.Database(dbPath, sqliteModule.OPEN_READONLY, (err) => {
        if (err) {
          reject(err);
          return;
        }
        if (typeof db.configure === 'function') {
          db.configure('busyTimeout', 2_000);
        }
        resolve(db);
      });
    });
  }

  private async closeDatabase(db: sqlite3Type.Database): Promise<void> {
    await new Promise<void>((resolve) => {
      db.close(() => resolve());
    });
  }

  private async all<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[]
  ): Promise<T[]> {
    const db = await this.openDatabase();
    try {
      return await new Promise<T[]>((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve((rows as T[]) ?? []);
        });
      });
    } finally {
      await this.closeDatabase(db);
    }
  }

  private async get<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[]
  ): Promise<T | null> {
    const db = await this.openDatabase();
    try {
      return await new Promise<T | null>((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve((row as T | undefined) ?? null);
        });
      });
    } finally {
      await this.closeDatabase(db);
    }
  }

  private mapThreadRow(row: Record<string, unknown> | null): CodexThread | null {
    if (!row) return null;
    if (typeof row.id !== 'string' || typeof row.cwd !== 'string') {
      return null;
    }
    return {
      id: row.id,
      cwd: row.cwd,
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
      archived: Boolean(row.archived ?? 0),
    };
  }

  async findThreadById(threadId: string): Promise<CodexThread | null> {
    try {
      const row = await this.get<Record<string, unknown>>(
        'SELECT id, cwd, created_at, updated_at, archived FROM threads WHERE id = ? LIMIT 1',
        [threadId]
      );
      return this.mapThreadRow(row);
    } catch (error) {
      log.warn('CodexSessionService: failed to load thread by id', {
        threadId,
        error: String(error),
      });
      return null;
    }
  }

  async threadExistsForCwd(threadId: string, cwd: string): Promise<boolean> {
    const thread = await this.findThreadById(threadId);
    return !!thread && !thread.archived && thread.cwd === cwd;
  }

  async findRecentThreadsForCwd(cwd: string, sinceMs: number): Promise<CodexThread[]> {
    const sinceSeconds = Math.max(0, Math.floor(sinceMs / 1000));
    try {
      const rows = await this.all<Record<string, unknown>>(
        `SELECT id, cwd, created_at, updated_at, archived
         FROM threads
         WHERE cwd = ?
           AND archived = 0
           AND (updated_at >= ? OR created_at >= ?)
         ORDER BY updated_at DESC, created_at DESC`,
        [cwd, sinceSeconds, sinceSeconds]
      );
      return rows.map((row) => this.mapThreadRow(row)).filter((row): row is CodexThread => !!row);
    } catch (error) {
      log.warn('CodexSessionService: failed to load recent threads for cwd', {
        cwd,
        sinceMs,
        sinceSeconds,
        dbPath: resolveCodexStatePath(),
        error: String(error),
      });
      return [];
    }
  }

  async findLatestThreadForCwd(cwd: string): Promise<CodexThread | null> {
    try {
      const row = await this.get<Record<string, unknown>>(
        `SELECT id, cwd, created_at, updated_at, archived
         FROM threads
         WHERE cwd = ?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
        [cwd]
      );
      return this.mapThreadRow(row);
    } catch (error) {
      log.warn('CodexSessionService: failed to load latest thread for cwd', {
        cwd,
        dbPath: resolveCodexStatePath(),
        error: String(error),
      });
      return null;
    }
  }

  async findLatestRecentThreadForCwd(cwd: string, sinceMs: number): Promise<CodexThread | null> {
    const threads = await this.findRecentThreadsForCwd(cwd, sinceMs);
    return threads[0] ?? null;
  }
}

export const codexSessionService = new CodexSessionService();
