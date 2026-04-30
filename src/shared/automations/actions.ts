import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Branch } from '@shared/git';
import type { CreateTaskStrategy, Issue } from '@shared/tasks';

export type ActionKind = 'task.create';

export type AutomationLinkedPullRequest = {
  prNumber: number;
  title: string;
  headRefName: string;
  headRepositoryUrl: string | null;
  isFork: boolean;
  isDraft: boolean;
  status: 'open' | 'closed' | 'merged';
};

export type TaskCreateAction = {
  kind: 'task.create';
  prompt: string;
  provider?: AgentProviderId;
  sourceBranch?: Branch;
  strategy?: CreateTaskStrategy;
  taskName?: string;
  linkedIssue?: Issue;
  linkedPullRequest?: AutomationLinkedPullRequest;
};

export type ActionSpec = TaskCreateAction;

export const ALL_ACTION_KINDS: readonly ActionKind[] = ['task.create'] as const;

export function isValidAction(action: ActionSpec): boolean {
  return action.prompt.trim().length > 0;
}
