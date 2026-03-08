import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSchemaMismatchError, DatabaseService } from '../services/DatabaseService';

// vi.mock factories are hoisted before class definitions, so the mock class
// must be defined via vi.hoisted() to be available when the factory runs.
const { schemaState, MockSqliteDatabase } = vi.hoisted(() => {
  type SqlRow = Record<string, unknown>;

  const schemaState = {
    tables: new Set<string>(),
    columnsByTable: {} as Record<string, string[]>,
  };

  class MockStatement {
    constructor(private query: string) {}

    all(): SqlRow[] {
      const trimmed = this.query.trim();

      const tableLookup = trimmed.match(/name='([^']+)'/);
      if (tableLookup) {
        const tableName = tableLookup[1];
        return schemaState.tables.has(tableName) ? [{ name: tableName }] : [];
      }

      const tableInfoLookup = trimmed.match(/^PRAGMA table_info\("([^"]+)"\)$/i);
      if (tableInfoLookup) {
        const tableName = tableInfoLookup[1];
        const columns = schemaState.columnsByTable[tableName] ?? [];
        return columns.map((name) => ({ name }));
      }

      return [];
    }
  }

  class MockSqliteDatabase {
    constructor(_filePath: string) {}

    pragma(_statement: string): unknown {
      return null;
    }

    prepare(query: string): MockStatement {
      return new MockStatement(query);
    }

    exec(_statement: string): void {}

    close(): void {}
  }

  return { schemaState, MockSqliteDatabase };
});

const migrateMock = vi.hoisted(() => vi.fn());

vi.mock('better-sqlite3', () => ({ default: MockSqliteDatabase }));

vi.mock('drizzle-orm/better-sqlite3/migrator', () => ({ migrate: migrateMock }));

vi.mock('../../main/db/path', () => ({
  resolveDatabasePath: () => '/tmp/emdash-init-test.db',
  resolveMigrationsPath: () => '/tmp/drizzle',
}));

const captureDatabaseErrorMock = vi.fn();

vi.mock('../../main/errorTracking', () => ({
  errorTracking: {
    captureDatabaseError: (...args: unknown[]) => captureDatabaseErrorMock(...args),
  },
}));

vi.mock('../../main/db/drizzleClient', () => ({
  getDrizzleClient: vi.fn(),
  createDrizzleClient: vi.fn().mockReturnValue({ db: {}, sqlite: {}, close: vi.fn() }),
  resetDrizzleClient: vi.fn(),
}));

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
  });

  it('rejects initialize with typed schema mismatch when projects.base_ref is missing', async () => {
    await expect(service.initialize()).rejects.toBeInstanceOf(DatabaseSchemaMismatchError);
    expect(captureDatabaseErrorMock).toHaveBeenCalledWith(
      expect.any(DatabaseSchemaMismatchError),
      'initialize_schema_contract',
      { db_path: '/tmp/emdash-init-test.db' }
    );

    service.close();
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

    service.close();
  });

  it('tracks migration failures separately from schema contract failures', async () => {
    const migrationError = new Error('migration boom');
    migrateMock.mockImplementationOnce(() => {
      throw migrationError;
    });

    await expect(service.initialize()).rejects.toThrow('migration boom');
    expect(captureDatabaseErrorMock).toHaveBeenCalledWith(migrationError, 'initialize_migrations', {
      db_path: '/tmp/emdash-init-test.db',
    });

    service.close();
  });
});
