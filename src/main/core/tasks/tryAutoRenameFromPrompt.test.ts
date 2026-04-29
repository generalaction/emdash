import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tryAutoRenameFromPrompt } from './tryAutoRenameFromPrompt';

const mocks = vi.hoisted(() => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  whereMock: vi.fn(),
  limitMock: vi.fn(),
  autoRenameMock: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.selectMock,
  },
}));

vi.mock('@main/core/conversations/autoRenameTaskFromPrompt', () => ({
  autoRenameTaskFromPrompt: mocks.autoRenameMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectMock.mockReturnValue({ from: mocks.fromMock });
  mocks.fromMock.mockReturnValue({ where: mocks.whereMock });
  mocks.whereMock.mockReturnValue({ limit: mocks.limitMock });
  mocks.autoRenameMock.mockResolvedValue(undefined);
});

describe('tryAutoRenameFromPrompt', () => {
  it('delegates to autoRenameTaskFromPrompt when the task has exactly one conversation', async () => {
    mocks.limitMock.mockResolvedValue([{ id: 'c1' }]);

    await tryAutoRenameFromPrompt('p1', 't1', 'fix the bug');

    expect(mocks.autoRenameMock).toHaveBeenCalledWith({
      projectId: 'p1',
      taskId: 't1',
      isFirstInTask: true,
      initialPrompt: 'fix the bug',
    });
  });

  it('skips when the task has no conversations', async () => {
    mocks.limitMock.mockResolvedValue([]);

    await tryAutoRenameFromPrompt('p1', 't1', 'fix the bug');

    expect(mocks.autoRenameMock).not.toHaveBeenCalled();
  });

  it('skips when the task already has more than one conversation', async () => {
    mocks.limitMock.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

    await tryAutoRenameFromPrompt('p1', 't1', 'fix the bug');

    expect(mocks.autoRenameMock).not.toHaveBeenCalled();
  });
});
