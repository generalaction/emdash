import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { IssueProvider, ScmProvider } from '@shared/automations/events';

export type ActionKind =
  | 'task.create'
  | 'issue.create'
  | 'issue.comment'
  | 'pr.comment'
  | 'notification.send';

export type TaskCreateAction = {
  kind: 'task.create';
  prompt: string;
  provider?: AgentProviderId;
  mode?: 'direct' | 'worktree';
};

export type IssueCreateAction = {
  kind: 'issue.create';
  provider: IssueProvider;
  title: string;
  body: string;
  labels?: string[];
  /**
   * Provider-specific scope for where the issue should be created.
   * - SCM (github/gitlab/forgejo): "owner/repo"; if omitted, derived from the project's remote
   * - jira: project key (e.g. "ENG")
   * - linear: team UUID or team key (e.g. "ENG")
   * - plain: not supported
   */
  target?: string;
};

export type IssueCommentAction = {
  kind: 'issue.comment';
  provider: IssueProvider;
  issueRef: string;
  body: string;
};

export type PrCommentAction = {
  kind: 'pr.comment';
  provider: ScmProvider;
  prRef: string;
  body: string;
};

export type NotificationSendAction = {
  kind: 'notification.send';
  title: string;
  body: string;
};

export type ActionSpec =
  | TaskCreateAction
  | IssueCreateAction
  | IssueCommentAction
  | PrCommentAction
  | NotificationSendAction;

export const ALL_ACTION_KINDS: readonly ActionKind[] = [
  'task.create',
  'issue.create',
  'issue.comment',
  'pr.comment',
  'notification.send',
] as const;

export function isValidAction(action: ActionSpec): boolean {
  switch (action.kind) {
    case 'task.create':
      return action.prompt.trim().length > 0;
    case 'issue.create':
      return action.title.trim().length > 0 && action.body.trim().length > 0;
    case 'issue.comment':
      return action.issueRef.trim().length > 0 && action.body.trim().length > 0;
    case 'pr.comment':
      return action.prRef.trim().length > 0 && action.body.trim().length > 0;
    case 'notification.send':
      return action.title.trim().length > 0 || action.body.trim().length > 0;
  }
}
