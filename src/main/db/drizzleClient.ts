import type sqlite3Type from 'sqlite3';
import {
  type AsyncBatchRemoteCallback,
  type RemoteCallback,
  type SqliteRemoteDatabase,
  drizzle,
} from 'drizzle-orm/sqlite-proxy';

import * as schema from './schema';
import { resolveDatabasePath } from './path';

type AppSchema = typeof schema;

export type DrizzleDb = SqliteRemoteDatabase<AppSchema>;

interface InternalClient {
  client: DrizzleClient;
  owned: boolean;
}

export interface DrizzleClient {
  db: DrizzleDb;
  sqlite: sqlite3Type.Database;
  close: () => Promise<void>;
}

export interface CreateDrizzleClientOptions {
  database?: sqlite3Type.Database;
  filePath?: string;
  busyTimeoutMs?: number;
  cacheResult?: boolean;
}

let sqliteModulePromise: Promise<typeof sqlite3Type> | null = null;
let cachedInternal: InternalClient | null = null;

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

async function loadSqliteModule(): Promise<typeof sqlite3Type> {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import('sqlite3').then((mod) => mod as unknown as typeof sqlite3Type);
  }
  return sqliteModulePromise;
}

function normalizeParams(params: unknown[] | undefined): unknown[] {
  return Array.isArray(params) ? params : [];
}

function createCallbacks(db: sqlite3Type.Database) {
  const runStatement = (
    sql: string,
    params: unknown[]
  ): Promise<{ rows: unknown[]; lastID: number; changes: number }> =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          rows: [],
          lastID: this.lastID,
          changes: this.changes,
        });
      });
    });

  const allStatement = (sql: string, params: unknown[]): Promise<unknown[]> =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });

  const getStatement = (sql: string, params: unknown[]): Promise<unknown | undefined> =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ?? undefined);
        }
      });
    });

  const mapRowToValues = (row: unknown): unknown[] => {
    if (Array.isArray(row)) {
      return row;
    }
    if (row && typeof row === 'object') {
      return Object.values(row as Record<string, unknown>);
    }
    return [];
  };

  const remote: RemoteCallback = async (sql, params, method) => {
    const normalized = normalizeParams(params);

    switch (method) {
      case 'run': {
        const result = await runStatement(sql, normalized);
        return {
          rows: result.rows,
          lastID: result.lastID,
          changes: result.changes,
        } as any;
      }
      case 'all': {
        const rows = await allStatement(sql, normalized);
        return { rows: rows.map(mapRowToValues) } as any;
      }
      case 'get': {
        const row = await getStatement(sql, normalized);
        return {
          rows: row === undefined ? null : mapRowToValues(row),
        } as any;
      }
      case 'values': {
        const rows = await allStatement(sql, normalized);
        const values = rows.map((row) =>
          Array.isArray(row) ? row : Object.values(row as Record<string, unknown>)
        );
        return { rows: values } as any;
      }
      default: {
        throw new Error(`Unsupported sqlite method "${method}"`);
      }
    }
  };

  const batch: AsyncBatchRemoteCallback = async (operations) => {
    const results: any[] = [];
    for (const op of operations) {
      results.push(await remote(op.sql, op.params, op.method));
    }
    return results;
  };

  return { remote, batch };
}

async function openDatabase(
  filePath: string,
  busyTimeoutMs: number
): Promise<sqlite3Type.Database> {
  const sqliteModule = await loadSqliteModule();
  const db = await new Promise<sqlite3Type.Database>((resolve, reject) => {
    const instance = new sqliteModule.Database(filePath, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(instance);
      }
    });
  });

  if (typeof db.configure === 'function') {
    db.configure('busyTimeout', busyTimeoutMs);
  }

  return db;
}

export async function createDrizzleClient(
  options: CreateDrizzleClientOptions = {}
): Promise<DrizzleClient> {
  if (process.env.EMDASH_DISABLE_NATIVE_DB === '1') {
    throw new Error('Native SQLite database is disabled via EMDASH_DISABLE_NATIVE_DB=1');
  }

  const busyTimeout = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const db =
    options.database ??
    (await openDatabase(options.filePath ?? resolveDatabasePath(), busyTimeout));

  const { remote, batch } = createCallbacks(db);
  const drizzleDb = drizzle(remote, batch, { schema });

  const client: DrizzleClient = {
    db: drizzleDb,
    sqlite: db,
    close: () =>
      new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };

  const shouldCache = options.cacheResult ?? (!options.database && options.filePath === undefined);

  if (shouldCache) {
    cachedInternal = {
      client,
      owned: !options.database,
    };
  }

  return client;
}

export async function getDrizzleClient(): Promise<DrizzleClient> {
  if (cachedInternal) {
    return cachedInternal.client;
  }

  return await createDrizzleClient();
}

export async function resetDrizzleClient(): Promise<void> {
  if (!cachedInternal) return;

  if (cachedInternal.owned) {
    await cachedInternal.client.close().catch(() => {});
  }

  cachedInternal = null;
}
