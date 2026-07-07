import { nextDefaultConversationTitle } from '@renderer/features/conversations/conversation-title-utils';
import type { InitialConversationState } from '@renderer/features/tasks/task-config/initial-conversation-section';
import { providerSupportsAutoApprove } from '@shared/core/agents/agent-auto-approve';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import type { TaskConfig } from '@shared/core/tasks/task-config';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';
import { buildFinalPrompt } from './initial-conversation-text';
import type { LinkedType } from './use-create-task-state';

export function buildInitialConversation(
  state: InitialConversationState
): NonNullable<TaskConfig['initialConversation']> | undefined {
  const { provider } = state;
  if (!provider) return undefined;

  return {
    id: crypto.randomUUID(),
    provider,
    title: nextDefaultConversationTitle(provider, []),
    initialPrompt: buildFinalPrompt(state.issueContext, state.prompt),
    autoApprove: providerSupportsAutoApprove(provider) && state.autoApprove,
    model: state.model ?? undefined,
    type: state.useChatUi ? 'acp' : 'pty',
  };
}

export function deriveInitialStatus(
  linkedType: LinkedType,
  linkedPR: PullRequest | null
): TaskLifecycleStatus | undefined {
  if (linkedType !== 'pr' || !linkedPR) return undefined;
  return linkedPR.status === 'open' && !linkedPR.isDraft ? 'review' : undefined;
}
