import { asAgentProviderId, type AgentProviderId } from '@emdash/plugins/agents/types';
import { describe, expect, it } from 'vitest';
import { emptyProviderSettings } from '@core/features/conversations/api/provider-settings';
import type { InitialConversationState } from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import { buildInitialConversation } from './build-create-task-params';

const agent = asAgentProviderId;

function makeInitialConversationState(
  provider: AgentProviderId,
  autoApprove: boolean,
  overrides: Partial<InitialConversationState> = {}
): InitialConversationState {
  return {
    provider,
    settingsReady: true,
    settings: emptyProviderSettings,
    options: {},
    setOption: () => {},
    flushSettings: async () => {},
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
    initialPromptSupported: true,
    issueMentionContexts: {},
    setIssueMentionContext: () => {},
    ...overrides,
  };
}

describe('buildInitialConversation', () => {
  it('uses the draft auto-approve value for supported providers', () => {
    expect(buildInitialConversation(makeInitialConversationState(agent('claude'), true))).toEqual(
      expect.objectContaining({ provider: 'claude', autoApprove: true })
    );
  });

  it('preserves a capability-gated false auto-approve value', () => {
    expect(buildInitialConversation(makeInitialConversationState(agent('jules'), false))).toEqual(
      expect.objectContaining({ provider: 'jules', autoApprove: false })
    );
  });

  it('builds an ACP initial queue from prompt and stashed mention contexts', () => {
    const conversation = buildInitialConversation(
      makeInitialConversationState(agent('claude'), false, {
        useChatUi: true,
        prompt: 'Check (issue:github:123)',
        model: 'ignored-plugin-model',
        options: { model: 'astra', reasoning_effort: 'xhigh' },
        issueContext: 'Pinned issue context',
        issueMentionContexts: {
          'issue:github:123': 'Mention issue context',
        },
      })
    );

    expect(conversation?.type).toBe('acp');
    expect(conversation?.options).toEqual({ model: 'astra', reasoning_effort: 'xhigh' });
    expect(conversation?.model).toBeUndefined();
    expect(conversation?.initialPrompt).toBeUndefined();
    expect(conversation?.initialQueue).toEqual([
      {
        text: 'Check (issue:github:123)',
        hiddenContext: 'Pinned issue context\n\nMention issue context',
      },
    ]);
  });

  it('adds a hidden naming instruction while preserving the ACP prompt and issue contexts', () => {
    const prompt = '  Check (issue:github:123)  ';
    const conversation = buildInitialConversation(
      makeInitialConversationState(agent('claude'), false, {
        useChatUi: true,
        prompt,
        issueContext: 'Pinned issue context',
        issueMentionContexts: {
          'issue:github:123': 'Mention issue context',
        },
      }),
      true
    );

    expect(conversation?.initialQueue).toEqual([
      {
        text: prompt,
        hiddenContext:
          'Pinned issue context\n\nMention issue context\n\nUse a concise conversation title describing this work in no more than five words.',
      },
    ]);
  });

  it.each([undefined, false])('omits the naming instruction when opt-in is %s', (optIn) => {
    const conversation = buildInitialConversation(
      makeInitialConversationState(agent('claude'), false, { useChatUi: true }),
      optIn
    );

    expect(conversation?.initialQueue).toEqual([{ text: 'Check this' }]);
  });

  it('does not send an ACP prompt just to request a name', () => {
    const conversation = buildInitialConversation(
      makeInitialConversationState(agent('claude'), false, {
        useChatUi: true,
        prompt: '   ',
      }),
      true
    );

    expect(conversation?.initialQueue).toBeUndefined();
  });

  it('leaves the PTY prompt unchanged when naming is enabled', () => {
    const conversation = buildInitialConversation(
      makeInitialConversationState(agent('claude'), false, {
        issueContext: 'Pinned issue context',
      }),
      true
    );

    expect(conversation?.initialPrompt).toBe('Pinned issue context\n\nCheck this');
    expect(conversation?.initialQueue).toBeUndefined();
  });

  it('does not create a conversation for naming when no provider is selected', () => {
    expect(
      buildInitialConversation(
        makeInitialConversationState(agent('claude'), false, { provider: null }),
        true
      )
    ).toBeUndefined();
  });

  it('omits PTY initial prompt when the selected agent cannot receive one', () => {
    const conversation = buildInitialConversation(
      makeInitialConversationState(agent('jules'), false, {
        initialPromptSupported: false,
      })
    );

    expect(conversation?.type).toBe('pty');
    expect(conversation?.initialPrompt).toBeUndefined();
  });
});
