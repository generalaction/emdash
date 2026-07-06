import { describe, expect, it } from 'vitest';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { InitialConversationState } from '../conversations/initial-conversation-section';
import { buildInitialConversation } from './build-create-task-params';

function makeInitialConversationState(
  provider: AgentProviderId,
  autoApprove: boolean
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
});
