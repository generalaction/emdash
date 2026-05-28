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
let taskRows: { taskId: string; projectId: string }[] = [];
let projectRows: unknown[] = [];
let defaultWorktreeDirectory = '';
const workspaceRun = vi.fn();
const originalCwd = process.cwd();
const archiveTask = vi.hoisted(() => vi.fn());
const emit = vi.hoisted(() => vi.fn());

vi.mock('@main/db/client', () => ({
  sqlite: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM workspaces')) {
        return {
          all: () => rows,
          run: workspaceRun,
        };
      }
      if (sql.includes('FROM projects')) {
        return {
          all: () => projectRows,
          run: vi.fn(),
        };
      }
      if (sql.includes('FROM tasks')) {
        return {
          all: () => taskRows,
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

vi.mock('@main/lib/events', () => ({
  events: {
    emit,
    on: vi.fn(() => () => {}),
  },
}));

vi.mock('../tasks/operations/archiveTask', () => ({
  archiveTask,
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

  function setupDefaultLocalProject(): string {
    const root = path.join(defaultWorktreeDirectory, 'Project');
    fs.mkdirSync(root, { recursive: true });
    projectRows = [
      {
        projectId: 'project',
        projectName: 'Project',
        projectPath: path.join(tempDir, 'repo'),
        baseProjectSettingsJson: null,
      },
    ];
    return root;
  }

  function managedWorktreePath(name: string): string {
    return path.join(setupDefaultLocalProject(), name);
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-cleanup-'));
    defaultWorktreeDirectory = path.join(tempDir, 'default-worktrees');
    fs.mkdirSync(defaultWorktreeDirectory, { recursive: true });
    projectRows = [];
    taskRows = [];
    workspaceRun.mockClear();
    emit.mockClear();
    archiveTask.mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rows = [];
    taskRows = [];
    projectRows = [];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not remove an active worktree when archiving its task fails', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const worktreePath = path.join(tempDir, 'active-worktree');
    fs.mkdirSync(worktreePath);
    fs.writeFileSync(path.join(worktreePath, 'file.txt'), 'content');
    rows = [
      {
        workspaceId: 'active-workspace',
        path: worktreePath,
        workspaceUpdatedAt: '2026-05-01T00:00:00.000Z',
        taskId: 'active-task',
        taskName: 'Active task',
        taskBranch: 'feature/active',
        taskStatus: 'in-progress',
        taskUpdatedAt: '2026-05-01T00:00:00.000Z',
        lastInteractedAt: null,
        archivedAt: null,
        projectId: 'project',
        projectName: 'Project',
        projectPath: tempDir,
      },
    ];
    taskRows = [{ taskId: 'active-task', projectId: 'project' }];
    const archiveError = new Error('archive failed');
    archiveTask.mockRejectedValue(archiveError);
    const removeSpy = vi.spyOn(fs.promises, 'rm');

    const service = new WorktreeCleanupService();

    await expect(service.removeWorktreeById('active-workspace')).rejects.toThrow(archiveError);

    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(removeSpy).not.toHaveBeenCalled();
    removeSpy.mockRestore();
  });

  it('does not delete a shared worktree path while an active task still references it', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const worktreePath = managedWorktreePath('shared-worktree');
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

  it('does not manually delete a shared worktree path while an active task references it', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const worktreePath = managedWorktreePath('manual-shared-worktree');
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

    await expect(service.removeWorktreeById('archived-workspace')).rejects.toThrow('active-task');

    expect(fs.existsSync(worktreePath)).toBe(true);
  });

  it('does not automatically remove archived worktrees outside the managed root', async () => {
    const { WorktreeCleanupService } = await import('./service');
    setupDefaultLocalProject();
    const worktreePath = path.join(tempDir, 'external-worktree');
    fs.mkdirSync(worktreePath);
    fs.writeFileSync(path.join(worktreePath, 'file.txt'), 'content');

    rows = [
      {
        workspaceId: 'external-workspace',
        path: worktreePath,
        workspaceUpdatedAt: '2026-05-01T00:00:00.000Z',
        taskId: 'external-task',
        taskName: 'External task',
        taskBranch: 'feature/external',
        taskStatus: 'done',
        taskUpdatedAt: '2026-05-01T00:00:00.000Z',
        lastInteractedAt: null,
        archivedAt: '2026-05-02T00:00:00.000Z',
        projectId: 'project',
        projectName: 'Project',
        projectPath: tempDir,
      },
    ];

    const service = new WorktreeCleanupService();
    const summary = await service.listManagedWorktrees();
    const external = summary.worktrees.find(
      (worktree) => worktree.workspaceId === 'external-workspace'
    );

    expect(external?.status).toBe('archived');
    expect(external?.cleanupEligible).toBe(false);

    await service.cleanup();

    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(workspaceRun).not.toHaveBeenCalled();
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

  it('does not treat the managed project root itself as an orphan worktree', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const root = setupDefaultLocalProject();
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, 'README.md'), 'content');

    const service = new WorktreeCleanupService();
    const summary = await service.listManagedWorktrees({ forceRefresh: true });

    expect(summary.worktrees).toHaveLength(0);

    await service.cleanup();

    expect(fs.existsSync(root)).toBe(true);
  });

  it('deduplicates concurrent cleanup runs', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const worktreePath = managedWorktreePath('archived-worktree');
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

  it('includes node_modules when enforcing total size limits', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const worktreePath = path.join(tempDir, 'archived-worktree');
    fs.mkdirSync(path.join(worktreePath, 'node_modules', 'dependency'), { recursive: true });
    fs.writeFileSync(path.join(worktreePath, 'node_modules', 'dependency', 'bundle.js'), 'content');
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

    const service = new WorktreeCleanupService();
    const summary = await service.listManagedWorktrees({
      forceRefresh: true,
      awaitSizes: true,
    });

    // `du -sk` reports block-allocated size, which is >= apparent bytes — assert the
    // node_modules contents are at least counted (not skipped) without locking to a
    // byte-exact value the filesystem doesn't guarantee.
    expect(summary.totalSizeBytes).toBeGreaterThanOrEqual(Buffer.byteLength('content'));
  });

  it('does not clear the workspace record when directory removal fails', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const worktreePath = managedWorktreePath('archived-worktree');
    fs.mkdirSync(worktreePath);
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
    const removeError = new Error('permission denied');
    const removeSpy = vi.spyOn(fs.promises, 'rm').mockRejectedValue(removeError);

    const service = new WorktreeCleanupService();
    await expect(service.cleanup()).rejects.toThrow(removeError);

    expect(workspaceRun).not.toHaveBeenCalled();
    removeSpy.mockRestore();
  });

  it('does not refresh every worktree size when removing one worktree', async () => {
    const { managedWorktreeSizeUpdatedChannel } = await import('@shared/events/worktree-events');
    const { WorktreeCleanupService } = await import('./service');
    const firstPath = path.join(tempDir, 'first-worktree');
    const secondPath = path.join(tempDir, 'second-worktree');
    fs.mkdirSync(firstPath);
    fs.mkdirSync(secondPath);
    fs.writeFileSync(path.join(firstPath, 'file.txt'), 'first');
    fs.writeFileSync(path.join(secondPath, 'file.txt'), 'second');
    rows = [
      {
        workspaceId: 'first-workspace',
        path: firstPath,
        workspaceUpdatedAt: '2026-05-01T00:00:00.000Z',
        taskId: 'first-task',
        taskName: 'First task',
        taskBranch: 'feature/first',
        taskStatus: 'done',
        taskUpdatedAt: '2026-05-01T00:00:00.000Z',
        lastInteractedAt: null,
        archivedAt: '2026-05-02T00:00:00.000Z',
        projectId: 'project',
        projectName: 'Project',
        projectPath: tempDir,
      },
      {
        workspaceId: 'second-workspace',
        path: secondPath,
        workspaceUpdatedAt: '2026-05-03T00:00:00.000Z',
        taskId: 'second-task',
        taskName: 'Second task',
        taskBranch: 'feature/second',
        taskStatus: 'done',
        taskUpdatedAt: '2026-05-03T00:00:00.000Z',
        lastInteractedAt: null,
        archivedAt: '2026-05-04T00:00:00.000Z',
        projectId: 'project',
        projectName: 'Project',
        projectPath: tempDir,
      },
    ];

    const service = new WorktreeCleanupService();
    const before = await service.listManagedWorktrees({ forceRefresh: true, awaitSizes: true });
    const secondSize = before.worktrees.find(
      (worktree) => worktree.workspaceId === 'second-workspace'
    )?.sizeBytes;
    emit.mockClear();

    const after = await service.removeWorktreeById('first-workspace');
    const remaining = after.worktrees.find(
      (worktree) => worktree.workspaceId === 'second-workspace'
    );

    expect(emit).not.toHaveBeenCalledWith(managedWorktreeSizeUpdatedChannel, expect.anything());
    expect(remaining?.sizeBytes).toBe(secondSize);
    expect(after.totalSizeBytes).toBe(secondSize);
  });

  it('serializes manual removals so the cached summary does not restore stale rows', async () => {
    const { WorktreeCleanupService } = await import('./service');
    const root = setupDefaultLocalProject();
    const firstPath = path.join(root, 'orphan-one');
    const secondPath = path.join(root, 'orphan-two');
    fs.mkdirSync(path.join(firstPath, '.git'), { recursive: true });
    fs.mkdirSync(path.join(secondPath, '.git'), { recursive: true });
    fs.writeFileSync(path.join(firstPath, 'file.txt'), 'first');
    fs.writeFileSync(path.join(secondPath, 'file.txt'), 'second');

    const service = new WorktreeCleanupService();
    const before = await service.listManagedWorktrees({ forceRefresh: true, awaitSizes: true });
    const firstId = before.worktrees.find((worktree) => worktree.path === firstPath)?.workspaceId;
    const secondId = before.worktrees.find((worktree) => worktree.path === secondPath)?.workspaceId;

    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();

    if (!firstId || !secondId) {
      throw new Error('Expected orphan worktrees to be listed');
    }

    await Promise.all([service.removeWorktreeById(firstId), service.removeWorktreeById(secondId)]);

    const after = await service.listManagedWorktrees();

    expect(after.worktrees).toHaveLength(0);
    expect(fs.existsSync(firstPath)).toBe(false);
    expect(fs.existsSync(secondPath)).toBe(false);
  });
});
