import { asAgentProviderId, type AgentProviderId } from '@emdash/plugins/agents/types';
import { describe, expect, it } from 'vitest';
import { createDefaultLoopPlanDraft } from '@renderer/features/loops/loop-plan-model';
import type { InitialConversationState } from '@renderer/features/tasks/task-config/initial-conversation-section';
import {
  buildInitialConversation,
  buildInitialConversationForTask,
  buildLoopTaskAuthoringInput,
} from './build-create-task-params';

const agent = asAgentProviderId;

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

  it('suppresses the ordinary initial conversation for Loop tasks', () => {
    const state = makeInitialConversationState(agent('codex'), true);
    expect(buildInitialConversationForTask(state, true)).toBeUndefined();
    expect(buildInitialConversationForTask(state, false)?.provider).toBe('codex');
  });

  it('builds the explicit v2 authoring contract without inferring project commands', () => {
    const draft = {
      ...createDefaultLoopPlanDraft(),
      enabled: true,
      goal: 'Ship it',
      planSource: '## Build',
      validationCommands: [' pnpm test ', ''],
      acceptanceCriteria: [' The page renders ', ''],
      workPhases: [{ id: 'work-1', kind: 'work' as const, name: ' Build ', goal: ' Ship it ' }],
      terminalGates: { review: true, e2e: true },
    };

    expect(buildLoopTaskAuthoringInput(' Feature ', draft)).toEqual({
      name: 'Feature Loop',
      model: 'gpt-5.6-sol',
      planSource: '## Build',
      validationCommands: ['pnpm test'],
      terminalGates: { review: true, e2e: true },
      browserPreview: { enabled: true },
      workPhases: [{ name: 'Build', goal: 'Ship it' }],
      acceptanceCriteria: ['The page renders'],
    });
  });
});
