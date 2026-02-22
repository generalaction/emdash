import { beforeEach, describe, expect, it, vi } from 'vitest';

type SchemaState = {
  tables: Set<string>;
  columnsByTable: Record<string, string[]>;
};

const schemaState: SchemaState = {
  tables: new Set<string>(),
  columnsByTable: {},
};

type SqlRow = Record<string, unknown>;
type AllCallback = (err: Error | null, rows?: SqlRow[]) => void;
type ExecCallback = (err: Error | null) => void;
type CloseCallback = (err: Error | null) => void;

class MockSqliteDatabase {
  constructor(_filePath: string, callback: (err: Error | null) => void) {
    callback(null);
  }

  all(query: string, callback: AllCallback): void {
    const trimmed = query.trim();
    const tableLookup = trimmed.match(/name='([^']+)'/);
    if (tableLookup) {
      const tableName = tableLookup[1];
      callback(null, schemaState.tables.has(tableName) ? [{ name: tableName }] : []);
      return;
    }

    const tableInfoLookup = trimmed.match(/^PRAGMA table_info\("([^"]+)"\)$/i);
    if (tableInfoLookup) {
      const tableName = tableInfoLookup[1];
      const columns = schemaState.columnsByTable[tableName] ?? [];
      callback(
        null,
        columns.map((name) => ({
          name,
        }))
      );
      return;
    }

    callback(null, []);
  }

  exec(_statement: string, callback: ExecCallback): void {
    callback(null);
  }

  close(callback: CloseCallback): void {
    callback(null);
  }
}

const captureDatabaseErrorMock = vi.fn();

vi.mock('sqlite3', () => ({
  Database: MockSqliteDatabase,
}));

vi.mock('../../main/db/path', () => ({
  resolveDatabasePath: () => '/tmp/emdash-init-test.db',
  resolveMigrationsPath: () => '/tmp/drizzle',
}));

vi.mock('../../main/errorTracking', () => ({
  errorTracking: {
    captureDatabaseError: (...args: unknown[]) => captureDatabaseErrorMock(...args),
  },
}));

vi.mock('../../main/db/drizzleClient', () => ({
  getDrizzleClient: vi.fn(),
}));

import { DatabaseSchemaMismatchError, DatabaseService } from '../../main/services/DatabaseService';

describe('DatabaseService.initialize schema contract handling', () => {
  let service: DatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EMDASH_DISABLE_NATIVE_DB;
    schemaState.tables = new Set(['projects', 'tasks', 'conversations']);
    schemaState.columnsByTable = {
      projects: ['id', 'name', 'path', 'git_remote', 'git_branch'],
      conversations: ['id', 'task_id'],
      tasks: ['id', 'project_id', 'name'],
    };

    service = new DatabaseService();
    vi.spyOn(
      service as unknown as {
        ensureMigrations: () => Promise<void>;
      },
      'ensureMigrations'
    ).mockResolvedValue(undefined);
  });

  it('rejects initialize with typed schema mismatch when projects.base_ref is missing', async () => {
    await expect(service.initialize()).rejects.toBeInstanceOf(DatabaseSchemaMismatchError);
    expect(captureDatabaseErrorMock).toHaveBeenCalledWith(
      expect.any(DatabaseSchemaMismatchError),
      'initialize_schema_contract',
      { db_path: '/tmp/emdash-init-test.db' }
    );

    await service.close();
  });

  it('resolves initialize when all required schema invariants exist', async () => {
    schemaState.columnsByTable.projects = [
      'id',
      'name',
      'path',
      'git_remote',
      'git_branch',
      'base_ref',
    ];

    await expect(service.initialize()).resolves.toBeUndefined();
    expect(captureDatabaseErrorMock).not.toHaveBeenCalled();

    await service.close();
  });

  it('tracks migration failures separately from schema contract failures', async () => {
    const migrationError = new Error('migration boom');
    vi.spyOn(
      service as unknown as {
        ensureMigrations: () => Promise<void>;
      },
      'ensureMigrations'
    ).mockRejectedValueOnce(migrationError);

    await expect(service.initialize()).rejects.toThrow('migration boom');
    expect(captureDatabaseErrorMock).toHaveBeenCalledWith(migrationError, 'initialize_migrations', {
      db_path: '/tmp/emdash-init-test.db',
    });

    await service.close();
  });
});
