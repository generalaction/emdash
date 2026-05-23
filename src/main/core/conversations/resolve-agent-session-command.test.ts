import { describe, expect, it } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { resolveAgentSessionCommandArgs } from './resolve-agent-session-command';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    projectId: 'proj-1',
    taskId: 'task-1',
    providerId: 'opencode',
    title: 'Test',
    lastInteractedAt: null,
    isInitialConversation: false,
    ...overrides,
  };
}

describe('resolveAgentSessionCommandArgs', () => {
  it('uses stored OpenCode session id when resuming', () => {
    expect(
      resolveAgentSessionCommandArgs(makeConversation({ providerSessionId: 'ses_abc123' }), true)
    ).toEqual({ sessionId: 'ses_abc123', isResuming: true });
  });

  it('starts fresh when resuming OpenCode without a stored session id', () => {
    expect(resolveAgentSessionCommandArgs(makeConversation(), true)).toEqual({
      sessionId: 'conv-1',
      isResuming: false,
    });
  });

  it('passes through for non-OpenCode providers', () => {
    expect(
      resolveAgentSessionCommandArgs(
        makeConversation({ providerId: 'claude', providerSessionId: 'ses_ignored' }),
        true
      )
    ).toEqual({ sessionId: 'conv-1', isResuming: true });
  });
});
