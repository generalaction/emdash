import type { Result } from '@emdash/shared';
import type { IssueListError } from '@core/primitives/issue-providers/api';

export const DEFAULT_JIRA_SYNC_JQL =
  'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';

export type JiraSyncSummary = {
  created: number;
  refreshed: number;
  skipped: number;
  failures: { identifier: string; message: string }[];
};

export type JiraSyncResult = Result<JiraSyncSummary, IssueListError>;
