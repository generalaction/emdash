import type { ForgejoIssue } from '../../../integrations/impl/forgejo/types';
import type { IssueData } from '../../types';

export function toIssueData(issue: ForgejoIssue, repoName: string): IssueData {
  const assignee = issue.assignee;
  const assigneeName = assignee?.full_name || assignee?.login;
  const assigneeLogin = assignee?.login || assignee?.full_name;

  return {
    identifier: `#${issue.number ?? 0}`,
    title: issue.title ?? '',
    url: issue.html_url ?? '',
    description: issue.body ?? undefined,
    status: issue.state ?? undefined,
    assignees: assigneeName || assigneeLogin ? [assigneeName ?? assigneeLogin ?? ''] : undefined,
    project: repoName,
    updatedAt: issue.updated_at ?? undefined,
  };
}
