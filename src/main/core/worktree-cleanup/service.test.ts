import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockRow = {
  workspaceId: string;
  path: string | null;
  workspaceUpdatedAt: string;
  taskId: string | null;
  taskName: string | null;
  taskBranch: string | null;
  taskStatus: string | null;
  taskUpdatedAt: string | null;
  lastInteractedAt: string | null;
  archivedAt: string | null;
  projectId: string | null;
  projectName: string | null;
  projectPath: string | null;
};

let rows: MockRow[] = [];
let projectRows: unknown[] = [];
let defaultWorktreeDirectory = '';

vi.mock('@main/db/client', () => ({
  sqlite: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM workspaces')) {
        return {
          all: () => rows,
          run: vi.fn(),
        };
      }
      if (sql.includes('FROM projects')) {
        return {
          all: () => projectRows,
          run: vi.fn(),
        };
      }
      return {
        all: () => [],
        run: vi.fn(),
      };
    }),
  },
}));

vi.mock('../settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn((key: string) => {
      if (key === 'localProject') return Promise.resolve({ defaultWorktreeDirectory });
      if (key === 'worktreeCleanup')
        return Promise.resolve({
          autoCleanupEnabled: true,
          maxWorktrees: 0,
          maxTotalSizeGb: 0,
        });
      return Promise.resolve({});
    }),
  },
}));

describe('WorktreeCleanupService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-cleanup-'));
    defaultWorktreeDirectory = path.join(tempDir, 'default-worktrees');
    fs.mkdirSync(defaultWorktreeDirectory, { recursive: true });
    projectRows = [];
  });

  afterEach(() => {
    rows = [];
    projectRows = [];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not delete a shared worktree path while an active task still references it', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const worktreePath = path.join(tempDir, 'shared-worktree');
    fs.mkdirSync(worktreePath);
    fs.writeFileSync(path.join(worktreePath, 'file.txt'), 'content');

    rows = [
      {
        workspaceId: 'archived-workspace',
        path: worktreePath,
        workspaceUpdatedAt: '2026-05-01T00:00:00.000Z',
        taskId: 'archived-task',
        taskName: 'Archived task',
        taskBranch: 'feature/shared',
        taskStatus: 'done',
        taskUpdatedAt: '2026-05-01T00:00:00.000Z',
        lastInteractedAt: null,
        archivedAt: '2026-05-02T00:00:00.000Z',
        projectId: 'project',
        projectName: 'Project',
        projectPath: tempDir,
      },
      {
        workspaceId: 'active-workspace',
        path: worktreePath,
        workspaceUpdatedAt: '2026-05-03T00:00:00.000Z',
        taskId: 'active-task',
        taskName: 'Active task',
        taskBranch: 'feature/shared',
        taskStatus: 'in-progress',
        taskUpdatedAt: '2026-05-03T00:00:00.000Z',
        lastInteractedAt: null,
        archivedAt: null,
        projectId: 'project',
        projectName: 'Project',
        projectPath: tempDir,
      },
    ];

    const service = new WorktreeCleanupService();
    const summary = await service.listManagedWorktrees();
    const archived = summary.worktrees.find(
      (worktree) => worktree.workspaceId === 'archived-workspace'
    );

    expect(archived?.status).toBe('archived');
    expect(archived?.cleanupEligible).toBe(false);

    await service.cleanup();

    expect(fs.existsSync(worktreePath)).toBe(true);
  });
});
