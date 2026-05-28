import { describe, expect, it } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { resolveAgentSessionCommandArgs } from './resolve-agent-session-command';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    projectId: 'proj-1',
    taskId: 'task-1',
    providerId: 'droid',
    title: 'Test',
    lastInteractedAt: null,
    isInitialConversation: false,
    runtimeMode: 'terminal',
    ...overrides,
  };
}

describe('resolveAgentSessionCommandArgs', () => {
  it('uses stored Droid session id when resuming', () => {
    expect(
      resolveAgentSessionCommandArgs(
        makeConversation({ providerSessionId: '31477a03-961a-4451-82d4-efded56947fc' }),
        true
      )
    ).toEqual({ sessionId: '31477a03-961a-4451-82d4-efded56947fc', isResuming: true });
  });

  it('starts fresh when resuming Droid without a stored session id', () => {
    expect(resolveAgentSessionCommandArgs(makeConversation(), true)).toEqual({
      sessionId: 'conv-1',
      isResuming: false,
    });
  });

  it('keeps resume enabled when provider session ids are unavailable', () => {
    expect(
      resolveAgentSessionCommandArgs(makeConversation(), true, { requireProviderSessionId: false })
    ).toEqual({
      sessionId: 'conv-1',
      isResuming: true,
    });
  });

  it('passes through for non-Droid providers', () => {
    expect(
      resolveAgentSessionCommandArgs(
        makeConversation({
          providerId: 'claude',
          providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
        }),
        true
      )
    ).toEqual({ sessionId: 'conv-1', isResuming: true });
  });
});
