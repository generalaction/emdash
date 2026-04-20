import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal DB mock: tracks the latest update call so we can assert on it.
let lastUpdateSet: Record<string, unknown> = {};
let lastUpdateWhere: unknown = null;
const selectResults: unknown[][] = [];

const mockDb = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve((selectResults.shift() as unknown[]) ?? []),
      }),
    }),
  })),
  insert: vi.fn(() => ({
    values: () => Promise.resolve(),
  })),
  update: vi.fn(() => ({
    set: (values: Record<string, unknown>) => {
      lastUpdateSet = values;
      return {
        where: (whereClause: unknown) => {
          lastUpdateWhere = whereClause;
          return Promise.resolve();
        },
      };
    },
  })),
};

vi.mock('../../main/db/path', () => ({
  resolveDatabasePath: () => '/tmp/emdash-archive-conv-test.db',
  resolveMigrationsPath: () => '/tmp/drizzle',
}));

vi.mock('../../main/errorTracking', () => ({
  errorTracking: {
    captureDatabaseError: vi.fn(),
  },
}));

vi.mock('../../main/db/drizzleClient', () => ({
  getDrizzleClient: () => Promise.resolve({ db: mockDb }),
}));

import { DatabaseService } from '../../main/services/DatabaseService';

describe('DatabaseService.archiveConversation', () => {
  let service: DatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    lastUpdateSet = {};
    lastUpdateWhere = null;
    service = new DatabaseService();
  });

  it('sets archivedAt to a non-null ISO timestamp', async () => {
    await service.archiveConversation('conv-1');

    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(lastUpdateSet).toMatchObject({
      archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('does not touch the messages table on archive', async () => {
    await service.archiveConversation('conv-1');

    // Only one update call — the conversations table.
    // If messages were touched we'd see a second update or insert.
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe('DatabaseService.unarchiveConversation', () => {
  let service: DatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    lastUpdateSet = {};
    lastUpdateWhere = null;
    service = new DatabaseService();
  });

  it('sets archivedAt to null', async () => {
    // The select after update returns the unarchived row
    selectResults.push([
      {
        id: 'conv-1',
        taskId: 'task-1',
        title: 'Test Chat',
        provider: 'claude',
        isActive: 0,
        isMain: 0,
        displayOrder: 0,
        metadata: null,
        archivedAt: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);

    const result = await service.unarchiveConversation('conv-1');

    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(lastUpdateSet).toMatchObject({ archivedAt: null });
    expect(result).not.toBeNull();
    expect(result?.id).toBe('conv-1');
    expect(result?.archivedAt).toBeNull();
  });

  it('returns null when the row is not found after unarchive', async () => {
    selectResults.push([]); // empty result set

    const result = await service.unarchiveConversation('conv-missing');

    expect(result).toBeNull();
  });
});
