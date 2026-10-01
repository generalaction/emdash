import z from 'zod';
import type { IssueData, IssueDetail } from '../../types';
import type { YouTrackIssueSummaryNode } from './queries';

const userValueSchema = z.object({
  name: z.string().nullable().optional(),
  fullName: z.string().nullable().optional(),
  login: z.string().nullable().optional(),
});

export function toIssueData(issue: YouTrackIssueSummaryNode, instanceUrl: string): IssueData {
  const state = issue.customFields.find((field) => field.$type === 'StateIssueCustomField');
  const assignee = issue.customFields.find(
    (field) =>
      field.name.toLowerCase() === 'assignee' &&
      (field.$type === 'SingleUserIssueCustomField' || field.$type === 'MultiUserIssueCustomField')
  );
  const status = state
    ? z.object({ name: z.string() }).nullable().parse(state.value)?.name
    : undefined;
  const users = !assignee
    ? []
    : assignee.$type === 'MultiUserIssueCustomField'
      ? z.array(userValueSchema).parse(assignee.value)
      : [userValueSchema.nullable().parse(assignee.value)];
  const assignees = users
    .map((user) => user?.fullName || user?.name || user?.login)
    .filter((name): name is string => !!name);
  return {
    identifier: issue.id,
    displayIdentifier: issue.idReadable,
    title: issue.summary,
    url: `${instanceUrl}/issue/${encodeURIComponent(issue.idReadable)}`,
    description: issue.description ?? undefined,
    updatedAt: new Date(issue.updated).toISOString(),
    project: issue.project?.name,
    status,
    assignees: assignees.length ? assignees : undefined,
  };
}

export function toIssueDetail(
  issue: YouTrackIssueSummaryNode,
  instanceUrl: string,
  context: string | undefined
): IssueDetail {
  return { ...toIssueData(issue, instanceUrl), context };
}
