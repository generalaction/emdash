import { nextDefaultConversationTitle } from '@renderer/features/conversations/conversation-title-utils';
import type { LoopPlanDraft } from '@renderer/features/loops/loop-plan-model';
import type { InitialConversationState } from '@renderer/features/tasks/task-config/initial-conversation-section';
import { extractIssueMentionTargets } from '@shared/core/issues/issue-context';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
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
      : { initialPrompt: buildFinalPrompt(state.issueContext, state.prompt) }),
    autoApprove: state.autoApprove,
    model: state.model ?? undefined,
    type,
  };
}

export function buildInitialConversationForTask(
  state: InitialConversationState,
  loopEnabled: boolean
): NonNullable<TaskConfig['initialConversation']> | undefined {
  return loopEnabled ? undefined : buildInitialConversation(state);
}

export type LoopTaskAuthoringInput = {
  name: string;
  model: string;
  planSource: string;
  validationCommands: string[];
  terminalGates: { review: boolean; e2e: boolean };
  browserPreview: { enabled: boolean };
  workPhases: { name: string; goal: string }[];
  acceptanceCriteria: string[];
};

export function buildLoopTaskAuthoringInput(
  taskName: string,
  draft: LoopPlanDraft,
  model: string
): LoopTaskAuthoringInput {
  return {
    name: `${taskName.trim()} Loop`,
    model: model.trim(),
    planSource: draft.planSource.trim(),
    validationCommands: draft.validationCommands.map((command) => command.trim()).filter(Boolean),
    terminalGates: { ...draft.terminalGates },
    browserPreview: { enabled: draft.terminalGates.e2e },
    workPhases: draft.workPhases.map((phase) => ({
      name: phase.name.trim(),
      goal: phase.goal.trim(),
    })),
    acceptanceCriteria: draft.acceptanceCriteria
      .map((criterion) => criterion.trim())
      .filter(Boolean),
  };
}

export function deriveInitialStatus(
  linkedType: LinkedType,
  linkedPR: PullRequest | null
): TaskLifecycleStatus | undefined {
  if (linkedType !== 'pr' || !linkedPR) return undefined;
  return linkedPR.status === 'open' && !linkedPR.isDraft ? 'review' : undefined;
}
