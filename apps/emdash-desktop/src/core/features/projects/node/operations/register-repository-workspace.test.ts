import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRepositoryWorkspace } from './register-repository-workspace';

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
          get: () => results[0],
        }),
      }),
    }),
  };
}

function makeInsertChain(captureValues?: unknown[]) {
  return {
    values: (vals: unknown) => {
      captureValues?.push(vals);
      return {
        run: mocks.insertRun,
        returning: () => ({
          get: () => {
            mocks.insertRun();
            return vals;
          },
        }),
      };
    },
  };
}

function makeUpdateChain() {
  return {
    set: () => ({
      where: () => ({
        run: () => {
          mocks.updateRun();
          return { changes: 1 };
        },
      }),
    }),
  };
}

const db = {
  select: () => makeSelectChain(mocks.selectAll()),
  transaction: mocks.transaction,
} as never;

vi.mock('@emdash/shared/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

const localProject = {
  id: 'project-1',
  path: '/home/user/project',
  host: LOCAL_HOST_REF,
};

const sshProject = {
  id: 'project-2',
  path: '/home/user/project',
  host: hostRef('remote', 'conn-1'),
};

describe('registerRepositoryWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing repositoryWorkspaceId without entering a transaction', () => {
    mocks.selectAll.mockReturnValue([{ repositoryWorkspaceId: 'ws-existing-1' }]);

    const result = registerRepositoryWorkspace(db, localProject);

    expect(result).toBe('ws-existing-1');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('creates a new repository workspace inside a transaction when not set', () => {
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

    const result = registerRepositoryWorkspace(db, localProject);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(mocks.insertRun).toHaveBeenCalled();
    expect(mocks.updateRun).toHaveBeenCalled();

    const wsInsert = insertedValues[0] as Record<string, unknown>;
    expect(wsInsert.kind).toBe('repository');
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

    registerRepositoryWorkspace(db, sshProject);

    const wsInsert = insertedValues[0] as Record<string, unknown>;
    expect(wsInsert.kind).toBe('repository');
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

    const result = registerRepositoryWorkspace(db, localProject);

    expect(result).toBe('ws-race-winner');
    expect(mocks.insertRun).not.toHaveBeenCalled();
    expect(mocks.updateRun).not.toHaveBeenCalled();
  });

  it('reuses existing workspace row at the same host + path (orphan recovery)', () => {
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

    const result = registerRepositoryWorkspace(db, localProject);

    expect(result).toBe('ws-orphan-existing');
    expect(mocks.insertRun).not.toHaveBeenCalled();
    expect(mocks.updateRun).toHaveBeenCalled();
  });
});
