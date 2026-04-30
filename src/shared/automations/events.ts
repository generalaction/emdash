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
  | 'issue.commented';

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

export type AutomationEvent =
  | {
      kind: 'pr.opened' | 'pr.merged' | 'pr.closed' | 'pr.review_requested';
      projectId: string;
      payload: PrPayload;
      occurredAt: number;
    }
  | {
      kind: 'ci.failed' | 'ci.succeeded';
      projectId: string;
      payload: CiPayload;
      occurredAt: number;
    }
  | {
      kind: 'issue.opened' | 'issue.closed' | 'issue.assigned' | 'issue.commented';
      projectId: string;
      payload: IssuePayload;
      occurredAt: number;
    };

export type EventTriggerFilters = {
  branches?: string[];
  authorsInclude?: string[];
  authorsExclude?: string[];
};

export function isPrEventKind(kind: AutomationEventKind): boolean {
  return (
    kind === 'pr.opened' ||
    kind === 'pr.merged' ||
    kind === 'pr.closed' ||
    kind === 'pr.review_requested'
  );
}

export function isCiEventKind(kind: AutomationEventKind): boolean {
  return kind === 'ci.failed' || kind === 'ci.succeeded';
}

export function isIssueEventKind(kind: AutomationEventKind): boolean {
  return (
    kind === 'issue.opened' ||
    kind === 'issue.closed' ||
    kind === 'issue.assigned' ||
    kind === 'issue.commented'
  );
}
