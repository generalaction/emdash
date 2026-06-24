import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import { dehydrateConversation } from './dehydrateConversation';

const resolveTask = vi.hoisted(() => vi.fn());

vi.mock('../projects/utils', () => ({
  resolveTask,
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
  },
}));

const { events } = await import('@main/lib/events');

describe('dehydrateConversation', () => {
  beforeEach(() => {
    resolveTask.mockReset();
    vi.mocked(events.emit).mockClear();
  });

  it('emits agent exit when detaching terminates the agent', async () => {
    resolveTask.mockReturnValue({
      conversations: {
        detachSession: vi.fn(async () => true),
      },
    });

    await dehydrateConversation('project-1', 'task-1', 'conversation-1');

    expect(events.emit).toHaveBeenCalledWith(agentSessionExitedChannel, {
      conversationId: 'conversation-1',
      taskId: 'task-1',
    });
  });

  it('does not emit agent exit when detaching leaves the agent running', async () => {
    resolveTask.mockReturnValue({
      conversations: {
        detachSession: vi.fn(async () => false),
      },
    });

    await dehydrateConversation('project-1', 'task-1', 'conversation-1');

    expect(events.emit).not.toHaveBeenCalled();
  });
});
