import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../main/db/path', () => ({
  resolveDatabasePath: () => '/tmp/emdash-schema-contract-test.db',
  resolveMigrationsPath: () => '/tmp/drizzle',
}));

vi.mock('../../main/errorTracking', () => ({
  errorTracking: {
    captureDatabaseError: vi.fn(),
  },
}));

vi.mock('../../main/db/drizzleClient', () => ({
  getDrizzleClient: vi.fn(),
  createDrizzleClient: vi.fn(),
  resetDrizzleClient: vi.fn(),
}));

import {
  DatabaseSchemaMismatchError,
  DatabaseService,
} from '../../main/_deprecated/services/DatabaseService';

describe('DatabaseService schema contract', () => {
  let service: DatabaseService;

  beforeEach(() => {
    delete process.env.EMDASH_DISABLE_NATIVE_DB;
    service = new DatabaseService();
  });

  it('passes when all required invariants exist', () => {
    vi.spyOn(service as any, 'tableExists').mockReturnValue(true);
    vi.spyOn(service as any, 'tableHasColumn').mockImplementation(
      (tableName: unknown, columnName: unknown) => {
        return (
          (tableName === 'projects' && columnName === 'base_ref') ||
          (tableName === 'conversations' && columnName === 'task_id')
        );
      }
    );

    expect(() => (service as any).validateSchemaContract()).not.toThrow();
  });

  it('throws typed mismatch error when projects.base_ref is missing', () => {
    vi.spyOn(service as any, 'tableExists').mockReturnValue(true);
    vi.spyOn(service as any, 'tableHasColumn').mockImplementation(
      (tableName: unknown, columnName: unknown) => {
        return tableName === 'conversations' && columnName === 'task_id';
      }
    );

    expect(() => (service as any).validateSchemaContract()).toThrow(DatabaseSchemaMismatchError);
    try {
      (service as any).validateSchemaContract();
    } catch (error) {
      expect(error).toMatchObject({
        name: 'DatabaseSchemaMismatchError',
        code: 'DB_SCHEMA_MISMATCH',
        dbPath: '/tmp/emdash-schema-contract-test.db',
        missingInvariants: ['projects.base_ref'],
      });
    }
  });

  it('collects multiple missing invariants', () => {
    vi.spyOn(service as any, 'tableExists').mockImplementation((tableName: unknown) => {
      return tableName !== 'tasks';
    });
    vi.spyOn(service as any, 'tableHasColumn').mockReturnValue(false);

    try {
      (service as any).validateSchemaContract();
      throw new Error('Expected schema mismatch to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseSchemaMismatchError);
      expect((error as DatabaseSchemaMismatchError).missingInvariants).toEqual([
        'projects.base_ref',
        'tasks table',
        'conversations.task_id',
      ]);
    }
  });
});
