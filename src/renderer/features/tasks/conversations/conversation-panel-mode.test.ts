import { describe, expect, it } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { getConversationPanelMode } from './conversation-panel-mode';

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

describe('getConversationPanelMode', () => {
  it('uses the chat panel for persisted chat conversations with an implemented runtime', () => {
    expect(getConversationPanelMode(makeConversation({ runtimeMode: 'chat' }))).toBe('chat');
  });

  it('falls back to terminal without an active conversation or implemented chat runtime', () => {
    expect(getConversationPanelMode(undefined)).toBe('terminal');
    expect(
      getConversationPanelMode(
        makeConversation({
          providerId: 'grok',
          runtimeMode: 'chat',
        })
      )
    ).toBe('terminal');
  });
});
