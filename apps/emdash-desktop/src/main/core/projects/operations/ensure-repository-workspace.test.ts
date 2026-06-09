import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
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

function makeSingleSelectChain(result: unknown) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([result]),
      }),
    }),
  };
}

function makeInsertChain() {
  return {
    values: () => ({ execute: () => Promise.resolve() }),
  };
}

function makeUpdateChain() {
  return {
    set: () => ({
      where: () => Promise.resolve(),
    }),
  };
}

describe('ensureRepositoryWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue(makeInsertChain());
    mocks.update.mockReturnValue(makeUpdateChain());
  });

  it('returns existing repositoryWorkspaceId without DB writes when already set', async () => {
    mocks.select.mockReturnValue(makeSingleSelectChain({ repositoryWorkspaceId: 'ws-existing-1' }));

    const result = await ensureRepositoryWorkspace(localProject);

    expect(result).toBe('ws-existing-1');
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('creates a new project-root workspace and updates the project when not set', async () => {
    mocks.select.mockReturnValue(makeSingleSelectChain({ repositoryWorkspaceId: null }));
    const insertedValues: unknown[] = [];
    mocks.insert.mockReturnValue({
      values: (vals: unknown) => {
        insertedValues.push(vals);
        return { execute: () => Promise.resolve() };
      },
    });

    const result = await ensureRepositoryWorkspace(localProject);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(mocks.update).toHaveBeenCalled();

    const wsInsert = insertedValues[0] as Record<string, unknown>;
    expect(wsInsert.kind).toBe('project-root');
    expect(wsInsert.location).toBe('local');
    expect(wsInsert.path).toBe(localProject.path);
    expect(wsInsert.sshConnectionId).toBeNull();
  });

  it('sets location=remote and sshConnectionId for SSH projects', async () => {
    mocks.select.mockReturnValue(makeSingleSelectChain({ repositoryWorkspaceId: null }));
    const insertedValues: unknown[] = [];
    mocks.insert.mockReturnValue({
      values: (vals: unknown) => {
        insertedValues.push(vals);
        return { execute: () => Promise.resolve() };
      },
    });

    await ensureRepositoryWorkspace(sshProject);

    const wsInsert = insertedValues[0] as Record<string, unknown>;
    expect(wsInsert.kind).toBe('project-root');
    expect(wsInsert.location).toBe('remote');
    expect(wsInsert.sshConnectionId).toBe('conn-1');
  });

  it('is idempotent — second call returns same ID without inserting again', async () => {
    // First call returns null → creates workspace
    mocks.select.mockReturnValueOnce(makeSingleSelectChain({ repositoryWorkspaceId: null }));
    const insertedValues: unknown[] = [];
    mocks.insert.mockReturnValue({
      values: (vals: unknown) => {
        insertedValues.push(vals);
        return { execute: () => Promise.resolve() };
      },
    });

    const firstId = await ensureRepositoryWorkspace(localProject);

    // Second call returns the ID we just set
    mocks.select.mockReturnValueOnce(makeSingleSelectChain({ repositoryWorkspaceId: firstId }));

    const secondId = await ensureRepositoryWorkspace(localProject);

    expect(secondId).toBe(firstId);
    expect(insertedValues).toHaveLength(1); // Only one workspace insert
  });
});
