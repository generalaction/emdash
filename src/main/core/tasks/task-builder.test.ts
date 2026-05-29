import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { Conversation } from '@shared/conversations';
import { chatConversationRuntime } from '../conversations/chat/chat-conversation-runtime';
import { hydrateRestoredConversation } from './hydrate-restored-conversation';

const runtimeMocks = vi.hoisted(() => ({
  hydrateConversation: vi.fn(),
  abortHydratedConversation: vi.fn(),
}));

vi.mock('../conversations/chat/chat-conversation-runtime', () => ({
  chatConversationRuntime: {
    hydrateConversation: runtimeMocks.hydrateConversation,
    abortHydratedConversation: runtimeMocks.abortHydratedConversation,
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
    runtimeMocks.hydrateConversation.mockResolvedValue(undefined);
    runtimeMocks.abortHydratedConversation.mockResolvedValue(undefined);
  });

  it('hydrates terminal conversations through the PTY conversation provider', async () => {
    const provider = makeConversationProvider();
    const conversation = makeConversation();

    await hydrateRestoredConversation(conversation, provider);

    expect(provider.startSession).toHaveBeenCalledWith(conversation, undefined, true);
    expect(chatConversationRuntime.hydrateConversation).not.toHaveBeenCalled();
  });

  it('hydrates Codex chat conversations through the chat runtime only', async () => {
    const provider = makeConversationProvider();
    const conversation = makeConversation({ runtimeMode: 'chat' });

    await hydrateRestoredConversation(conversation, provider);

    expect(provider.startSession).not.toHaveBeenCalled();
    expect(chatConversationRuntime.hydrateConversation).toHaveBeenCalledWith(conversation);
  });
});
