import type { GitLabIssue } from '../../../integrations/impl/gitlab/types';
import type { IssueData } from '../../types';

export function toIssueData(issue: GitLabIssue, projectName: string | null): IssueData {
  const assignee = issue.assignees?.[0];
  const assigneeName = assignee?.name || assignee?.username;

  return {
    identifier: `#${issue.iid}`,
    title: issue.title,
    url: issue.web_url,
    description: issue.description || undefined,
    status: issue.state,
    assignees:
      assigneeName || assignee?.username ? [assigneeName ?? assignee?.username ?? ''] : undefined,
    project: projectName ?? undefined,
    updatedAt: issue.updated_at,
  };
}
