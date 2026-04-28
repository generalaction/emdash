import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoRenameTaskFromPrompt,
  resetAutoRenamedTasksForTesting,
} from './autoRenameTaskFromPrompt';

const mocks = vi.hoisted(() => ({
  getMock: vi.fn(),
  generateTaskNameMock: vi.fn(),
  renameTaskMock: vi.fn(),
  logWarnMock: vi.fn(),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: mocks.getMock,
  },
}));

vi.mock('@main/core/tasks/generateTaskName', () => ({
  generateTaskName: mocks.generateTaskNameMock,
}));

vi.mock('@main/core/tasks/renameTask', () => ({
  renameTask: mocks.renameTaskMock,
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: mocks.logWarnMock,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetAutoRenamedTasksForTesting();
  mocks.getMock.mockResolvedValue({ autoRenameFromFirstPrompt: true });
  mocks.generateTaskNameMock.mockReturnValue('fix-dark-mode-toggle');
  mocks.renameTaskMock.mockResolvedValue(undefined);
});

describe('autoRenameTaskFromPrompt', () => {
  it('renames the task when toggle is on, first conversation, and prompt is non-empty', async () => {
    await autoRenameTaskFromPrompt({
      projectId: 'p1',
      taskId: 't1',
      isFirstInTask: true,
      initialPrompt: 'fix the dark-mode toggle',
    });

    expect(mocks.generateTaskNameMock).toHaveBeenCalledWith({
      title: 'fix the dark-mode toggle',
    });
    expect(mocks.renameTaskMock).toHaveBeenCalledWith('p1', 't1', 'fix-dark-mode-toggle');
  });

  it('does not rename when the toggle is off', async () => {
    mocks.getMock.mockResolvedValue({ autoRenameFromFirstPrompt: false });

    await autoRenameTaskFromPrompt({
      projectId: 'p1',
      taskId: 't1',
      isFirstInTask: true,
      initialPrompt: 'fix the dark-mode toggle',
    });

    expect(mocks.generateTaskNameMock).not.toHaveBeenCalled();
    expect(mocks.renameTaskMock).not.toHaveBeenCalled();
  });

  it('does not rename when this is not the first conversation in the task', async () => {
    await autoRenameTaskFromPrompt({
      projectId: 'p1',
      taskId: 't1',
      isFirstInTask: false,
      initialPrompt: 'fix the dark-mode toggle',
    });

    expect(mocks.getMock).not.toHaveBeenCalled();
    expect(mocks.renameTaskMock).not.toHaveBeenCalled();
  });

  it('does not rename when the initial prompt is empty or whitespace', async () => {
    await autoRenameTaskFromPrompt({
      projectId: 'p1',
      taskId: 't1',
      isFirstInTask: true,
      initialPrompt: '   ',
    });

    await autoRenameTaskFromPrompt({
      projectId: 'p1',
      taskId: 't1',
      isFirstInTask: true,
      initialPrompt: undefined,
    });

    expect(mocks.getMock).not.toHaveBeenCalled();
    expect(mocks.renameTaskMock).not.toHaveBeenCalled();
  });

  it('swallows renameTask errors and logs a warning', async () => {
    mocks.renameTaskMock.mockRejectedValue(new Error('boom'));

    await expect(
      autoRenameTaskFromPrompt({
        projectId: 'p1',
        taskId: 't1',
        isFirstInTask: true,
        initialPrompt: 'fix the dark-mode toggle',
      })
    ).resolves.toBeUndefined();

    expect(mocks.logWarnMock).toHaveBeenCalledTimes(1);
    expect(mocks.logWarnMock.mock.calls[0][0]).toMatch(/auto-rename/i);
  });

  it('only renames the same task once per app session', async () => {
    await autoRenameTaskFromPrompt({
      projectId: 'p1',
      taskId: 't1',
      isFirstInTask: true,
      initialPrompt: 'first prompt',
    });
    await autoRenameTaskFromPrompt({
      projectId: 'p1',
      taskId: 't1',
      isFirstInTask: true,
      initialPrompt: 'second prompt',
    });

    expect(mocks.renameTaskMock).toHaveBeenCalledTimes(1);
  });

  it('skips renameTask when generateTaskName returns an empty string', async () => {
    mocks.generateTaskNameMock.mockReturnValue('');

    await autoRenameTaskFromPrompt({
      projectId: 'p1',
      taskId: 't1',
      isFirstInTask: true,
      initialPrompt: 'something',
    });

    expect(mocks.renameTaskMock).not.toHaveBeenCalled();
  });
});
