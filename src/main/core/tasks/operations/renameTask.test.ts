import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '@main/db/schema';
import { toStoredBranch } from '../stored-branch';
import { renameTask } from './renameTask';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  getProject: vi.fn(),
  getAppSetting: vi.fn(),
  renameBranch: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: mocks.getProject,
  },
}));

vi.mock('../../settings/settings-service', () => ({
  appSettingsService: {
    get: mocks.getAppSetting,
  },
}));

function makeTaskRow(values: Partial<TaskRow>): TaskRow {
  return {
    id: values.id ?? 'task-1',
    projectId: values.projectId ?? 'project-1',
    name: values.name ?? 'old-title',
    status: values.status ?? 'in_progress',
    sourceBranch: values.sourceBranch ?? null,
    taskBranch: values.taskBranch ?? null,
    linkedIssue: values.linkedIssue ?? null,
    archivedAt: values.archivedAt ?? null,
    createdAt: values.createdAt ?? '2026-05-28 12:00:00',
    updatedAt: values.updatedAt ?? '2026-05-28 12:00:00',
    lastInteractedAt: values.lastInteractedAt ?? null,
    statusChangedAt: values.statusChangedAt ?? '2026-05-28 12:00:00',
    isPinned: values.isPinned ?? 0,
    workspaceProvider: values.workspaceProvider ?? null,
    workspaceId: values.workspaceId ?? null,
    workspaceProviderData: values.workspaceProviderData ?? null,
  };
}

function mockSelectRows(rows: unknown[]) {
  return mockSelectRowsSequence([rows]);
}

function mockSelectRowsSequence(rowsByCall: unknown[][]) {
  const calls = rowsByCall.map((rows) => {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => Object.assign(Promise.resolve(rows), { limit }));
    const from = vi.fn(() => ({ where }));
    return { from, where, limit };
  });
  const firstCall = calls[0];
  mocks.select.mockImplementation(() => {
    const call = calls.shift();
    if (!call) throw new Error('Unexpected select call');
    return { from: call.from };
  });
  return firstCall;
}

function mockUpdateRows(rows: TaskRow[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  mocks.update.mockReturnValue({ set });
  return { set, where, returning };
}

describe('renameTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProject.mockReturnValue({
      repository: {
        renameBranch: mocks.renameBranch,
      },
    });
    mocks.getAppSetting.mockResolvedValue({
      branchPrefix: 'emdash',
      appendRandomBranchSuffix: true,
    });
    mocks.renameBranch.mockResolvedValue({ success: true, data: undefined });
  });

  it('renames only Emdash task metadata and leaves the git branch unchanged', async () => {
    const originalRow = makeTaskRow({
      name: 'old-title',
      sourceBranch: toStoredBranch({ type: 'local', branch: 'main' }),
      taskBranch: 'jona/eng-1431-old-title',
      linkedIssue: JSON.stringify({
        provider: 'linear',
        url: 'https://linear.app/general-action/issue/ENG-1431',
        title: 'Old title',
        identifier: 'ENG-1431',
        branchName: 'jona/eng-1431-old-title',
      }),
    });
    const updatedRow = makeTaskRow({
      ...originalRow,
      name: 'new-title',
      taskBranch: 'jona/eng-1431-old-title',
    });

    mockSelectRows([originalRow]);
    const update = mockUpdateRows([updatedRow]);

    const result = await renameTask('project-1', 'task-1', 'new-title');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.task.name).toBe('new-title');
    expect(result.data.task.taskBranch).toBe('jona/eng-1431-old-title');
    expect(update.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ taskBranch: expect.anything() })
    );
    expect(mocks.renameBranch).not.toHaveBeenCalled();
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it('renames the local branch when requested and leaves remotes untouched', async () => {
    const originalRow = makeTaskRow({
      name: 'old-title',
      sourceBranch: toStoredBranch({ type: 'local', branch: 'main' }),
      taskBranch: 'emdash/old-title',
    });
    const updatedRow = makeTaskRow({
      ...originalRow,
      name: 'new-title',
      taskBranch: 'emdash/new-title',
    });

    mockSelectRowsSequence([
      [originalRow],
      [{ ...originalRow, id: 'task-1' }],
      [{ remoteUrl: 'https://github.com/example/repo.git' }],
      [],
    ]);
    const update = mockUpdateRows([updatedRow]);

    const result = await renameTask('project-1', 'task-1', 'new-title', {
      renameBranch: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.task.name).toBe('new-title');
    expect(result.data.task.taskBranch).toBe('emdash/new-title');
    expect(mocks.renameBranch).toHaveBeenCalledWith('emdash/old-title', 'emdash/new-title');
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'new-title',
        taskBranch: 'emdash/new-title',
      })
    );
  });

  it('does not rename branches with open pull requests', async () => {
    const originalRow = makeTaskRow({
      name: 'old-title',
      sourceBranch: toStoredBranch({ type: 'local', branch: 'main' }),
      taskBranch: 'emdash/open-pr-branch',
    });

    mockSelectRowsSequence([
      [originalRow],
      [{ ...originalRow, id: 'task-1' }],
      [{ remoteUrl: 'https://github.com/example/repo.git' }],
      [{ url: 'https://github.com/example/repo/pull/123' }],
    ]);

    const result = await renameTask('project-1', 'task-1', 'new-title', {
      renameBranch: true,
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'branch-has-open-pr', branch: 'emdash/open-pr-branch' },
    });
    expect(mocks.renameBranch).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not rename branches managed by Linear issues', async () => {
    const originalRow = makeTaskRow({
      name: 'old-title',
      sourceBranch: toStoredBranch({ type: 'local', branch: 'main' }),
      taskBranch: 'jona/eng-1431-old-title',
      linkedIssue: JSON.stringify({
        provider: 'linear',
        url: 'https://linear.app/general-action/issue/ENG-1431',
        title: 'Old title',
        identifier: 'ENG-1431',
        branchName: 'jona/eng-1431-old-title',
      }),
    });

    mockSelectRows([originalRow]);

    const result = await renameTask('project-1', 'task-1', 'new-title', {
      renameBranch: true,
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'branch-managed-by-linked-issue', provider: 'linear' },
    });
    expect(mocks.renameBranch).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns an error when local branch rename is requested for a shared branch', async () => {
    const originalRow = makeTaskRow({
      name: 'old-title',
      sourceBranch: toStoredBranch({ type: 'local', branch: 'main' }),
      taskBranch: 'emdash/shared-branch',
    });

    mockSelectRowsSequence([
      [originalRow],
      [originalRow, makeTaskRow({ id: 'task-2', taskBranch: 'emdash/shared-branch' })],
    ]);

    const result = await renameTask('project-1', 'task-1', 'new-title', {
      renameBranch: true,
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'branch-has-siblings', branch: 'emdash/shared-branch' },
    });
    expect(mocks.renameBranch).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns task-not-found when the task does not exist in the requested project', async () => {
    mockSelectRows([]);

    const result = await renameTask('project-1', 'missing-task', 'new-title');

    expect(result).toEqual({
      success: false,
      error: { type: 'task-not-found', taskId: 'missing-task' },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
