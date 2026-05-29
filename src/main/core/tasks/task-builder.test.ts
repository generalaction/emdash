import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { Conversation } from '@shared/conversations';
import { chatConversationRuntime } from '../conversations/chat/chat-conversation-runtime';
import { hydrateRestoredConversation } from './hydrate-restored-conversation';

const timelineMocks = vi.hoisted(() => ({
  cancelPendingPermissionRequests: vi.fn(),
  getLatestAssistantMessage: vi.fn(),
  recoverPendingUserMessages: vi.fn(),
  restoreCancelledPermissionRequests: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('../conversations/chat/chat-timeline-store', () => ({
  chatTimelineStore: {
    cancelPendingPermissionRequests: timelineMocks.cancelPendingPermissionRequests,
    getLatestAssistantMessage: timelineMocks.getLatestAssistantMessage,
    recoverPendingUserMessages: timelineMocks.recoverPendingUserMessages,
    restoreCancelledPermissionRequests: timelineMocks.restoreCancelledPermissionRequests,
  },
}));

vi.mock('@main/core/conversations/chat/chat-timeline-store', () => ({
  chatTimelineStore: {
    cancelPendingPermissionRequests: timelineMocks.cancelPendingPermissionRequests,
    getLatestAssistantMessage: timelineMocks.getLatestAssistantMessage,
    recoverPendingUserMessages: timelineMocks.recoverPendingUserMessages,
    restoreCancelledPermissionRequests: timelineMocks.restoreCancelledPermissionRequests,
  },
}));

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Conversation 1',
    lastInteractedAt: null,
    isInitialConversation: false,
    runtimeMode: 'terminal',
    ...overrides,
  };
}

function makeConversationProvider(): ConversationProvider {
  return {
    startSession: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn().mockResolvedValue(undefined),
    interruptSession: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
    destroyAll: vi.fn().mockResolvedValue(undefined),
    detachAll: vi.fn().mockResolvedValue(undefined),
  };
}

describe('hydrateRestoredConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timelineMocks.cancelPendingPermissionRequests.mockResolvedValue([]);
    timelineMocks.getLatestAssistantMessage.mockResolvedValue(undefined);
    timelineMocks.recoverPendingUserMessages.mockResolvedValue(undefined);
    timelineMocks.restoreCancelledPermissionRequests.mockResolvedValue([]);
  });

  afterEach(async () => {
    await chatConversationRuntime.dehydrateConversation('conversation-1', {
      restoreHydrationRecovery: false,
    });
  });

  it('hydrates terminal conversations through the PTY conversation provider', async () => {
    const provider = makeConversationProvider();
    const conversation = makeConversation();

    await hydrateRestoredConversation(conversation, provider);

    expect(provider.startSession).toHaveBeenCalledWith(conversation, undefined, true);
    expect(chatConversationRuntime.isActive(conversation.id)).toBe(false);
  });

  it('hydrates Codex chat conversations through the chat runtime', async () => {
    const provider = makeConversationProvider();
    const conversation = makeConversation({ runtimeMode: 'chat' });

    await hydrateRestoredConversation(conversation, provider);

    expect(provider.startSession).toHaveBeenCalledWith(conversation, undefined, true);
    expect(chatConversationRuntime.isActive(conversation.id)).toBe(true);
  });

  it('restores chat hydration permission recovery when restored backend start fails', async () => {
    const provider = makeConversationProvider();
    vi.mocked(provider.startSession).mockRejectedValueOnce(new Error('resume failed'));
    const conversation = makeConversation({ runtimeMode: 'chat' });
    timelineMocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Run command?',
        options: [{ id: 'approve', label: 'Approve', kind: 'primary' }],
        status: 'cancelled',
      },
    ]);

    await expect(hydrateRestoredConversation(conversation, provider)).rejects.toThrow(
      'resume failed'
    );

    expect(timelineMocks.restoreCancelledPermissionRequests).toHaveBeenCalledWith(conversation, [
      'permission-1',
    ]);
    expect(chatConversationRuntime.isActive(conversation.id)).toBe(false);
  });
});
