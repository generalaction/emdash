import type { IssueData, IssueDetail } from '../../types';
import type { LinearIssueSearchNode, LinearIssueSummaryNode } from './queries';

function toIssueBaseData(raw: LinearIssueSearchNode): IssueData {
  return {
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    description: raw.description ?? undefined,
    branchName: raw.branchName ?? undefined,
  };
}

export function toIssueData(raw: LinearIssueSummaryNode): IssueData {
  return {
    ...toIssueBaseData(raw),
    status: raw.state?.name ?? undefined,
    assignees: raw.assignee ? [raw.assignee.name || raw.assignee.displayName] : undefined,
    project: raw.project?.name ?? undefined,
    updatedAt: raw.updatedAt,
  };
}

export function toIssueSearchData(raw: LinearIssueSearchNode): IssueData {
  return toIssueBaseData(raw);
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
