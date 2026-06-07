import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import type { TaskConfig } from '@shared/core/tasks/task-config';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';
import { nextDefaultConversationTitle } from '../conversations/conversation-title-utils';
import type { InitialConversationState } from '../conversations/initial-conversation-section';
import { buildFinalPrompt } from './initial-conversation-text';
import type { LinkedType } from './use-create-task-state';

export function buildInitialConversation(
  state: InitialConversationState,
  getAutoApproveDefault: (provider: AgentProviderId) => boolean
): NonNullable<TaskConfig['initialConversation']> | undefined {
  const { provider } = state;
  if (!provider) return undefined;

  return {
    id: crypto.randomUUID(),
    provider,
    title: nextDefaultConversationTitle(provider, []),
    initialPrompt: buildFinalPrompt(state.issueContext, state.prompt),
    autoApprove: getAutoApproveDefault(provider),
  };
}

export function deriveInitialStatus(
  linkedType: LinkedType,
  linkedPR: PullRequest | null
): TaskLifecycleStatus | undefined {
  if (linkedType !== 'pr' || !linkedPR) return undefined;
  return linkedPR.status === 'open' && !linkedPR.isDraft ? 'review' : undefined;
}
