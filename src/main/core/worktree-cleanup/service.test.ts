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
const originalCwd = process.cwd();

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
    process.chdir(originalCwd);
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

  it('does not scan cwd-relative roots when no default worktree directory is configured', async () => {
    const { WorktreeCleanupService } = await import('./service');
    defaultWorktreeDirectory = '';
    process.chdir(tempDir);

    const root = path.join(tempDir, 'Project');
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    projectRows = [
      {
        projectId: 'project',
        projectName: 'Project',
        projectPath: path.join(tempDir, 'repo'),
        baseProjectSettingsJson: null,
      },
    ];

    const service = new WorktreeCleanupService();
    const summary = await service.listManagedWorktrees({ forceRefresh: true });

    expect(summary.worktrees).toHaveLength(0);
  });

  it('deduplicates concurrent cleanup runs', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const worktreePath = path.join(tempDir, 'archived-worktree');
    fs.mkdirSync(worktreePath);
    fs.writeFileSync(path.join(worktreePath, 'file.txt'), 'content');
    rows = [
      {
        workspaceId: 'archived-workspace',
        path: worktreePath,
        workspaceUpdatedAt: '2026-05-01T00:00:00.000Z',
        taskId: 'archived-task',
        taskName: 'Archived task',
        taskBranch: 'feature/archive',
        taskStatus: 'done',
        taskUpdatedAt: '2026-05-01T00:00:00.000Z',
        lastInteractedAt: null,
        archivedAt: '2026-05-02T00:00:00.000Z',
        projectId: 'project',
        projectName: 'Project',
        projectPath: tempDir,
      },
    ];
    const removeSpy = vi.spyOn(fs.promises, 'rm');

    const service = new WorktreeCleanupService();
    const [first, second] = await Promise.all([service.cleanup(), service.cleanup()]);

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(first.cleanedCount).toBe(1);
    expect(second.cleanedCount).toBe(1);
    expect(first.worktrees).toHaveLength(0);
    expect(second.worktrees).toHaveLength(0);
    removeSpy.mockRestore();
  });
});
