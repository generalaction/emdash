import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { ConversationStore } from './conversation-manager';

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: vi.fn(() => vi.fn()) },
  rpc: { conversations: { getConversationsForTask: vi.fn() } },
}));

function makeConversation(): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'claude',
    title: 'Claude',
    lastInteractedAt: null,
    isInitialConversation: false,
  };
}

describe('ConversationStore', () => {
  it('keeps permission prompts until an explicit start event resumes work', () => {
    const store = new ConversationStore(makeConversation());

    store.setAwaitingInput('permission_prompt');
    store.setWorking();

    expect(store.status).toBe('awaiting-input');
    expect(store.lastNotificationType).toBe('permission_prompt');

    store.setWorking({ clearPermissionPrompt: true });

    expect(store.status).toBe('working');
    expect(store.lastNotificationType).toBeNull();
  });
});
