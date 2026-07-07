import { describe, expect, it } from 'vitest';
import type { InitialConversationState } from '@renderer/features/tasks/task-config/initial-conversation-section';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { buildInitialConversation } from './build-create-task-params';

function makeInitialConversationState(
  provider: AgentProviderId,
  autoApprove: boolean,
  overrides: Partial<InitialConversationState> = {}
): InitialConversationState {
  return {
    provider,
    setProvider: () => {},
    prompt: 'Check this',
    setPrompt: () => {},
    issueContext: null,
    setIssueContext: () => {},
    autoApprove,
    setAutoApprove: () => {},
    issueContextEditorOpen: false,
    setIssueContextEditorOpen: () => {},
    model: null,
    setModel: () => {},
    useChatUi: false,
    setUseChatUi: () => {},
    issueMentionContexts: {},
    setIssueMentionContext: () => {},
    ...overrides,
  };
}

describe('buildInitialConversation', () => {
  it('uses the draft auto-approve value for supported providers', () => {
    expect(buildInitialConversation(makeInitialConversationState('claude', true))).toEqual(
      expect.objectContaining({ provider: 'claude', autoApprove: true })
    );
  });

  it('does not auto-approve unsupported providers', () => {
    expect(buildInitialConversation(makeInitialConversationState('jules', true))).toEqual(
      expect.objectContaining({ provider: 'jules', autoApprove: false })
    );
  });

  it('builds an ACP initial queue from prompt and stashed mention contexts', () => {
    const conversation = buildInitialConversation(
      makeInitialConversationState('claude', false, {
        useChatUi: true,
        prompt: 'Check (issue:github:123)',
        issueContext: 'Pinned issue context',
        issueMentionContexts: {
          'issue:github:123': 'Mention issue context',
        },
      })
    );

    expect(conversation?.type).toBe('acp');
    expect(conversation?.initialPrompt).toBeUndefined();
    expect(conversation?.initialQueue).toEqual([
      {
        text: 'Check (issue:github:123)',
        hiddenContext: 'Pinned issue context\n\nMention issue context',
      },
    ]);
  });
});
