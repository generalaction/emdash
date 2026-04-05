import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectResults: unknown[][] = [];
const insertValuesMock = vi.fn();
const updateValuesMock = vi.fn();
const updateWhereMock = vi.fn();

const mockDb = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve((selectResults.shift() as unknown[]) ?? []),
      }),
    }),
  })),
  insert: vi.fn(() => ({
    values: (values: unknown) => {
      insertValuesMock(values);
      return Promise.resolve();
    },
  })),
  update: vi.fn(() => ({
    set: (values: unknown) => {
      updateValuesMock(values);
      return {
        where: (...args: unknown[]) => {
          updateWhereMock(...args);
          return Promise.resolve();
        },
      };
    },
  })),
};

vi.mock('../../main/db/path', () => ({
  resolveDatabasePath: () => '/tmp/emdash-save-project-test.db',
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

import { DatabaseService, type Project } from '../../main/services/DatabaseService';

describe('DatabaseService.saveProject', () => {
  let service: DatabaseService;

  const baseProject: Omit<Project, 'createdAt' | 'updatedAt'> = {
    id: 'project-1',
    name: 'Project One',
    path: '/tmp/project-one',
    isRemote: true,
    sshConnectionId: 'ssh-1',
    remotePath: '/srv/project-one',
    gitPlatform: 'github',
    gitInfo: {
      isGitRepo: true,
      remote: 'origin',
      branch: 'main',
      baseRef: 'origin/main',
    },
    githubInfo: {
      repository: 'org/project-one',
      connected: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    service = new DatabaseService();
  });

  it('throws a typed conflict instead of overwriting an existing project', async () => {
    selectResults.push([]);
    selectResults.push([
      {
        id: 'project-existing',
        name: 'Existing Project',
        path: '/srv/project-one',
      },
    ]);

    await expect(service.saveProject(baseProject)).rejects.toEqual(
      expect.objectContaining({
        name: 'ProjectConflictError',
        code: 'PROJECT_CONFLICT',
        existingProjectId: 'project-existing',
        existingProjectName: 'Existing Project',
        projectPath: '/srv/project-one',
      })
    );

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateValuesMock).not.toHaveBeenCalled();
  });

  it('updates an existing project row when the same project id is resaved', async () => {
    selectResults.push([
      {
        id: 'project-1',
        path: '/tmp/project-one',
      },
    ]);
    selectResults.push([
      {
        id: 'project-1',
        name: 'Project One',
        path: '/srv/project-one',
      },
    ]);

    await expect(service.saveProject(baseProject)).resolves.toBeUndefined();

    expect(updateValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'project-1',
        name: 'Project One',
        path: '/tmp/project-one',
        sshConnectionId: 'ssh-1',
        remotePath: '/srv/project-one',
      })
    );
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('inserts a new project without mutating an existing row', async () => {
    selectResults.push([]);
    selectResults.push([]);

    await expect(service.saveProject(baseProject)).resolves.toBeUndefined();

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'project-1',
        path: '/tmp/project-one',
      })
    );
    expect(updateValuesMock).not.toHaveBeenCalled();
  });

  it('allows the same project id to move to a new path when there is no collision', async () => {
    selectResults.push([
      {
        id: 'project-1',
        path: '/tmp/project-one',
      },
    ]);
    selectResults.push([]);

    const movedProject = {
      ...baseProject,
      path: '/tmp/project-one-renamed',
    };

    await expect(service.saveProject(movedProject)).resolves.toBeUndefined();

    expect(updateValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/tmp/project-one-renamed',
      })
    );
  });
});
