import { describe, expect, it } from 'vitest';
import { getProvider } from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import { buildAgentSessionCommand } from './impl/agent-command';
import { resolveAgentSessionCommandArgs } from './resolve-agent-session-command';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    projectId: 'proj-1',
    taskId: 'task-1',
    providerId: 'droid',
    title: 'Test',
    runtime: 'terminal',
    lastInteractedAt: null,
    isInitialConversation: false,
    ...overrides,
  };
}

describe('resolveAgentSessionCommandArgs', () => {
  it('uses stored Codex session id when resuming', () => {
    expect(
      resolveAgentSessionCommandArgs(
        makeConversation({
          providerId: 'codex',
          providerSessionId: '019c95f6-cd96-7812-ba15-574286674599',
        }),
        true
      )
    ).toEqual({ sessionId: '019c95f6-cd96-7812-ba15-574286674599', isResuming: true });
  });

  it('starts fresh instead of resuming Codex --last without a stored session id', () => {
    expect(resolveAgentSessionCommandArgs(makeConversation({ providerId: 'codex' }), true)).toEqual(
      {
        sessionId: 'conv-1',
        isResuming: false,
      }
    );
  });

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

  it('builds a Claude replacement resume command from the logical conversation id', () => {
    const conversation = makeConversation({
      id: '6fac6620-9fa8-4604-b7e0-1fe361589104',
      providerId: 'claude',
    });
    const spawnPlan = resolveAgentSessionCommandArgs(conversation, true);

    expect(
      buildAgentSessionCommand({
        providerId: conversation.providerId,
        providerConfig: getProvider(conversation.providerId),
        autoApprove: false,
        sessionId: spawnPlan.sessionId,
        providerSessionId: conversation.providerSessionId,
        isResuming: spawnPlan.isResuming,
      })
    ).toEqual({
      command: 'claude',
      args: ['--resume', conversation.id],
    });
  });

  it('builds a Codex replacement resume command from the stored provider session id', () => {
    const conversation = makeConversation({
      id: '6fac6620-9fa8-4604-b7e0-1fe361589104',
      providerId: 'codex',
      providerSessionId: 'provider-session-1',
    });
    const spawnPlan = resolveAgentSessionCommandArgs(conversation, true);

    expect(
      buildAgentSessionCommand({
        providerId: conversation.providerId,
        providerConfig: getProvider(conversation.providerId),
        autoApprove: false,
        sessionId: spawnPlan.sessionId,
        providerSessionId: conversation.providerSessionId,
        isResuming: spawnPlan.isResuming,
      })
    ).toEqual({
      command: 'codex',
      args: ['resume', 'provider-session-1'],
    });
  });
});
