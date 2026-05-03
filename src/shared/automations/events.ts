export type AutomationEventKind = 'pr.opened' | 'pr.merged' | 'pr.closed' | 'issue.opened';

export type PrPayload = {
  ref: string;
  title: string;
  url: string;
  author: string;
  number: number;
  branch: string;
  baseBranch: string;
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
      kind: 'pr.opened' | 'pr.merged' | 'pr.closed';
      projectId: string;
      payload: PrPayload;
      occurredAt: number;
    }
  | {
      kind: 'issue.opened';
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
  return kind === 'pr.opened' || kind === 'pr.merged' || kind === 'pr.closed';
}

export function isIssueEventKind(kind: AutomationEventKind): boolean {
  return kind === 'issue.opened';
}
