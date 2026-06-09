import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';

const mocks = vi.hoisted(() => ({
  selectAll: vi.fn(),
  insertRun: vi.fn(),
  updateRun: vi.fn(),
  transaction: vi.fn(),
}));

function makeSelectChain(results: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => ({
          all: () => results,
        }),
      }),
    }),
  };
}

function makeInsertChain(captureValues?: unknown[]) {
  return {
    values: (vals: unknown) => {
      captureValues?.push(vals);
      return { run: mocks.insertRun };
    },
  };
}

function makeUpdateChain() {
  return {
    set: () => ({
      where: () => ({
        run: mocks.updateRun,
      }),
    }),
  };
}

vi.mock('@main/db/client', () => ({
  db: {
    select: () => makeSelectChain(mocks.selectAll()),
    transaction: mocks.transaction,
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

const localProject = {
  type: 'local' as const,
  id: 'project-1',
  name: 'My Project',
  path: '/home/user/project',
  baseRef: 'main',
  repositoryWorkspaceId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const sshProject = {
  type: 'ssh' as const,
  id: 'project-2',
  name: 'SSH Project',
  path: '/home/user/project',
  baseRef: 'main',
  connectionId: 'conn-1',
  repositoryWorkspaceId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ensureRepositoryWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing repositoryWorkspaceId without entering a transaction', () => {
    mocks.selectAll.mockReturnValue([{ repositoryWorkspaceId: 'ws-existing-1' }]);

    const result = ensureRepositoryWorkspace(localProject);

    expect(result).toBe('ws-existing-1');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('creates a new project-root workspace inside a transaction when not set', () => {
    mocks.selectAll.mockReturnValue([{ repositoryWorkspaceId: null }]);

    const insertedValues: unknown[] = [];

    mocks.transaction.mockImplementation((fn: (tx: unknown) => unknown) => {
      const tx = {
        select: () => makeSelectChain([{ repositoryWorkspaceId: null }]),
        insert: () => makeInsertChain(insertedValues),
        update: () => makeUpdateChain(),
      };
      // First tx.select for re-check returns null
      // Second tx.select for existing key returns empty
      let selectCallCount = 0;
      tx.select = () => {
        selectCallCount++;
        if (selectCallCount === 1) return makeSelectChain([{ repositoryWorkspaceId: null }]);
        return makeSelectChain([]);
      };
      return fn(tx);
    });

    const result = ensureRepositoryWorkspace(localProject);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(mocks.insertRun).toHaveBeenCalled();
    expect(mocks.updateRun).toHaveBeenCalled();

    const wsInsert = insertedValues[0] as Record<string, unknown>;
    expect(wsInsert.kind).toBe('project-root');
    expect(wsInsert.location).toBe('local');
    expect(wsInsert.path).toBe(localProject.path);
    expect(wsInsert.sshConnectionId).toBeNull();
  });

  it('sets location=remote and sshConnectionId for SSH projects', () => {
    mocks.selectAll.mockReturnValue([{ repositoryWorkspaceId: null }]);

    const insertedValues: unknown[] = [];

    mocks.transaction.mockImplementation((fn: (tx: unknown) => unknown) => {
      let selectCallCount = 0;
      const tx = {
        select: () => {
          selectCallCount++;
          if (selectCallCount === 1) return makeSelectChain([{ repositoryWorkspaceId: null }]);
          return makeSelectChain([]);
        },
        insert: () => makeInsertChain(insertedValues),
        update: () => makeUpdateChain(),
      };
      return fn(tx);
    });

    ensureRepositoryWorkspace(sshProject);

    const wsInsert = insertedValues[0] as Record<string, unknown>;
    expect(wsInsert.kind).toBe('project-root');
    expect(wsInsert.location).toBe('remote');
    expect(wsInsert.sshConnectionId).toBe('conn-1');
  });

  it('is idempotent — returns existing ID from transaction re-check without inserting', () => {
    mocks.selectAll.mockReturnValue([{ repositoryWorkspaceId: null }]);

    mocks.transaction.mockImplementation((fn: (tx: unknown) => unknown) => {
      const tx = {
        select: () => makeSelectChain([{ repositoryWorkspaceId: 'ws-race-winner' }]),
        insert: () => makeInsertChain(),
        update: () => makeUpdateChain(),
      };
      return fn(tx);
    });

    const result = ensureRepositoryWorkspace(localProject);

    expect(result).toBe('ws-race-winner');
    expect(mocks.insertRun).not.toHaveBeenCalled();
    expect(mocks.updateRun).not.toHaveBeenCalled();
  });

  it('reuses existing workspace row when key already exists (orphan recovery)', () => {
    mocks.selectAll.mockReturnValue([{ repositoryWorkspaceId: null }]);

    mocks.transaction.mockImplementation((fn: (tx: unknown) => unknown) => {
      let selectCallCount = 0;
      const tx = {
        select: () => {
          selectCallCount++;
          if (selectCallCount === 1) return makeSelectChain([{ repositoryWorkspaceId: null }]);
          return makeSelectChain([{ id: 'ws-orphan-existing' }]);
        },
        insert: () => makeInsertChain(),
        update: () => makeUpdateChain(),
      };
      return fn(tx);
    });

    const result = ensureRepositoryWorkspace(localProject);

    expect(result).toBe('ws-orphan-existing');
    expect(mocks.insertRun).not.toHaveBeenCalled();
    expect(mocks.updateRun).toHaveBeenCalled();
  });
});
