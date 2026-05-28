import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dehydrateConversation } from './dehydrateConversation';

const mocks = vi.hoisted(() => ({
  dehydrateRuntime: vi.fn(),
  resolveTask: vi.fn(),
  stopSession: vi.fn(),
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

vi.mock('./chat/chat-conversation-runtime', () => ({
  chatConversationRuntime: {
    dehydrateConversation: mocks.dehydrateRuntime,
  },
}));

describe('dehydrateConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stopSession.mockResolvedValue(undefined);
    mocks.resolveTask.mockReturnValue({
      conversations: {
        stopSession: mocks.stopSession,
      },
    });
  });

  it('removes chat runtime state after the backend session stops', async () => {
    await dehydrateConversation('project-1', 'task-1', 'conversation-1');

    expect(mocks.stopSession).toHaveBeenCalledWith('conversation-1');
    expect(mocks.stopSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dehydrateRuntime.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('keeps chat runtime state when backend stop fails', async () => {
    mocks.stopSession.mockRejectedValue(new Error('stop failed'));

    await expect(dehydrateConversation('project-1', 'task-1', 'conversation-1')).rejects.toThrow(
      'stop failed'
    );

    expect(mocks.dehydrateRuntime).not.toHaveBeenCalled();
  });
});
