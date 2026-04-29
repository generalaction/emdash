export const ALL_INTEGRATION_PROVIDERS = [
  'github',
  'gitlab',
  'forgejo',
  'jira',
  'linear',
  'plain',
] as const;
export type IntegrationProvider = (typeof ALL_INTEGRATION_PROVIDERS)[number];

export const SCM_PROVIDERS = ['github', 'gitlab', 'forgejo'] as const;
export type ScmProvider = (typeof SCM_PROVIDERS)[number];

export const ISSUE_PROVIDERS = ALL_INTEGRATION_PROVIDERS;
export type IssueProvider = IntegrationProvider;

export type AutomationEventKind =
  | 'pr.opened'
  | 'pr.merged'
  | 'pr.closed'
  | 'pr.review_requested'
  | 'ci.failed'
  | 'ci.succeeded'
  | 'issue.opened'
  | 'issue.closed'
  | 'issue.assigned'
  | 'issue.commented'
  | 'task.created'
  | 'task.completed'
  | 'task.failed'
  | 'agent.session_exited'
  | 'agent.permission_prompt'
  | 'git.ref_changed';

export const ALL_EVENT_KINDS: readonly AutomationEventKind[] = [
  'pr.opened',
  'pr.merged',
  'pr.closed',
  'pr.review_requested',
  'ci.failed',
  'ci.succeeded',
  'issue.opened',
  'issue.closed',
  'issue.assigned',
  'issue.commented',
  'task.created',
  'task.completed',
  'task.failed',
  'agent.session_exited',
  'agent.permission_prompt',
  'git.ref_changed',
] as const;

export type PrPayload = {
  ref: string;
  title: string;
  url: string;
  author: string;
  number: number;
  branch: string;
  baseBranch: string;
};

export type CiPayload = {
  ref: string;
  url: string;
  workflow: string;
  conclusion: 'failure' | 'success' | 'cancelled' | 'timed_out';
  branch: string;
};

export type IssuePayload = {
  ref: string;
  title: string;
  url: string;
  author: string;
  number: string;
  body: string;
  labels: string[];
  assignee: string | null;
};

export type TaskPayload = {
  taskId: string;
  projectId: string;
  name?: string;
  status: string;
};

export type AgentPayload = {
  taskId: string;
  projectId: string;
  conversationId: string;
  exitCode?: number;
  message?: string;
};

export type GitPayload = {
  projectId: string;
  branch: string;
  changeType: 'local' | 'remote' | 'config';
};

export type AutomationEvent =
  | {
      kind: 'pr.opened' | 'pr.merged' | 'pr.closed' | 'pr.review_requested';
      provider: ScmProvider;
      projectId: string;
      payload: PrPayload;
      occurredAt: number;
    }
  | {
      kind: 'ci.failed' | 'ci.succeeded';
      provider: ScmProvider;
      projectId: string;
      payload: CiPayload;
      occurredAt: number;
    }
  | {
      kind: 'issue.opened' | 'issue.closed' | 'issue.assigned' | 'issue.commented';
      provider: IssueProvider;
      projectId: string;
      payload: IssuePayload;
      occurredAt: number;
    }
  | {
      kind: 'task.created' | 'task.completed' | 'task.failed';
      provider: 'internal';
      projectId: string;
      payload: TaskPayload;
      occurredAt: number;
    }
  | {
      kind: 'agent.session_exited' | 'agent.permission_prompt';
      provider: 'internal';
      projectId: string;
      payload: AgentPayload;
      occurredAt: number;
    }
  | {
      kind: 'git.ref_changed';
      provider: 'internal';
      projectId: string;
      payload: GitPayload;
      occurredAt: number;
    };

export type EventProviderScope = IntegrationProvider | 'internal';
