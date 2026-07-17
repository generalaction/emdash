import { nextDefaultConversationTitle } from '@renderer/features/conversations/conversation-title-utils';
import type { InitialConversationState } from '@renderer/features/tasks/task-config/initial-conversation-section';
import type { PullRequest } from '@root/src/core/services/pull-requests/api';
import { extractIssueMentionTargets } from '@shared/core/issues/issue-context';
import type { TaskConfig } from '@shared/core/tasks/task-config';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';
import { buildFinalPrompt } from './initial-conversation-text';
import type { LinkedType } from './use-create-task-state';

function buildInitialQueue(state: InitialConversationState) {
  const text = state.prompt.trim();
  if (!text) return undefined;

  const hiddenContextParts: string[] = [];
  if (state.issueContext?.trim()) {
    hiddenContextParts.push(state.issueContext.trim());
  }

  const targets = extractIssueMentionTargets(state.prompt);
  for (const target of targets) {
    const context = state.issueMentionContexts[target.token];
    if (context?.trim()) hiddenContextParts.push(context.trim());
  }

  const hiddenContext = hiddenContextParts.join('\n\n').trim();
  return [
    {
      text: state.prompt,
      ...(hiddenContext && { hiddenContext }),
    },
  ];
}

export function buildInitialConversation(
  state: InitialConversationState
): NonNullable<TaskConfig['initialConversation']> | undefined {
  const { provider } = state;
  if (!provider) return undefined;
  const type = state.useChatUi ? 'acp' : 'pty';

  return {
    id: crypto.randomUUID(),
    provider,
    title: nextDefaultConversationTitle(provider, []),
    ...(type === 'acp'
      ? { initialQueue: buildInitialQueue(state) }
      : state.initialPromptSupported
        ? { initialPrompt: buildFinalPrompt(state.issueContext, state.prompt) }
        : {}),
    autoApprove: state.autoApprove,
    model: state.model ?? undefined,
    type,
  };
}

export function deriveInitialStatus(
  linkedType: LinkedType,
  linkedPR: PullRequest | null
): TaskLifecycleStatus | undefined {
  if (linkedType !== 'pr' || !linkedPR) return undefined;
  return linkedPR.status === 'open' && !linkedPR.isDraft ? 'review' : undefined;
}
