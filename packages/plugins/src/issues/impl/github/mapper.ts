import type { GitHubIssue } from '../../../integrations/impl/github/types';
import type { IssueData } from '../../types';

export function toIssueData(issue: GitHubIssue): IssueData {
  return {
    identifier: `#${issue.number}`,
    title: issue.title,
    url: issue.html_url,
    description: issue.body ?? undefined,
    status: issue.state,
    assignees: (issue.assignees ?? []).map((assignee) => assignee?.login ?? '').filter(Boolean),
    updatedAt: issue.updated_at ?? undefined,
  };
}
