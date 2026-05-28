import { describe, expect, it, vi } from 'vitest';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { Conversation } from '@shared/conversations';
import { chatConversationRuntime } from '../conversations/chat/chat-conversation-runtime';
import { hydrateRestoredConversation } from './hydrate-restored-conversation';

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
    stopSession: vi.fn().mockResolvedValue(undefined),
    destroyAll: vi.fn().mockResolvedValue(undefined),
    detachAll: vi.fn().mockResolvedValue(undefined),
  };
}

describe('hydrateRestoredConversation', () => {
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

    expect(provider.startSession).not.toHaveBeenCalled();
    expect(chatConversationRuntime.isActive(conversation.id)).toBe(true);

    chatConversationRuntime.dehydrateConversation(conversation.id);
  });
});
