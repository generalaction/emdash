import type { IssueData, IssueDetail } from '../../types';
import type { LinearIssueSummaryNode } from './queries';

export function toIssueData(raw: LinearIssueSummaryNode): IssueData {
  return {
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    description: raw.description ?? undefined,
    branchName: raw.branchName ?? undefined,
    status: raw.state?.name ?? undefined,
    assignees: raw.assignee ? [raw.assignee.name || raw.assignee.displayName] : undefined,
    project: raw.project?.name ?? undefined,
    updatedAt: raw.updatedAt,
  };
}

export function toIssueDetail(
  raw: LinearIssueSummaryNode,
  context: string | undefined
): IssueDetail {
  return {
    ...toIssueData(raw),
    context,
  };
}
