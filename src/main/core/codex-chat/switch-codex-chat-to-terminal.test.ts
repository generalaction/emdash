import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  hydrateConversation: vi.fn(),
  emit: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  selectFrom: vi.fn(),
  selectWhere: vi.fn(),
  selectLimit: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock('./codex-chat-service', () => ({
  codexChatService: { dispose: mocks.dispose },
}));

vi.mock('@main/core/conversations/hydrateConversation', () => ({
  hydrateConversation: mocks.hydrateConversation,
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: mocks.emit },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
  },
}));

import { switchCodexChatToTerminal } from './switch-codex-chat-to-terminal';

function setupDb(config = JSON.stringify({ uiMode: 'native-chat' })) {
  mocks.selectLimit.mockResolvedValue([{ config }]);
  mocks.selectWhere.mockReturnValue({ limit: mocks.selectLimit });
  mocks.selectFrom.mockReturnValue({ where: mocks.selectWhere });
  mocks.select.mockReturnValue({ from: mocks.selectFrom });

  mocks.updateWhere.mockResolvedValue(undefined);
  mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  mocks.update.mockReturnValue({ set: mocks.updateSet });
}

describe('switchCodexChatToTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDb();
  });

  it('waits for native chat disposal before hydrating the terminal PTY', async () => {
    let releaseDispose!: () => void;
    mocks.dispose.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseDispose = resolve;
      })
    );

    const switching = switchCodexChatToTerminal('project-1', 'task-1', 'conv-1');
    await Promise.resolve();

    expect(mocks.dispose).toHaveBeenCalledWith('conv-1');
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.hydrateConversation).not.toHaveBeenCalled();

    releaseDispose();
    await switching;

    expect(mocks.select).toHaveBeenCalled();
    expect(mocks.hydrateConversation).toHaveBeenCalledWith('project-1', 'task-1', 'conv-1');
  });
});
