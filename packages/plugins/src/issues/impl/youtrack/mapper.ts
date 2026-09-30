import z from 'zod';
import type { IssueData } from '../../types';

const userValueSchema = z.object({
  name: z.string().nullable().optional(),
  fullName: z.string().nullable().optional(),
  login: z.string().nullable().optional(),
});

const customFieldSchema = z.object({
  $type: z.string(),
  name: z.string(),
  value: z.unknown(),
});

export const youTrackIssueSchema = z.object({
  id: z.string().min(1),
  idReadable: z.string().min(1),
  summary: z.string(),
  description: z.string().nullable(),
  updated: z.number().int().min(0).max(8_640_000_000_000_000),
  project: z.object({ name: z.string() }).nullable(),
  customFields: z.array(customFieldSchema),
});

export const YOU_TRACK_ISSUE_FIELDS =
  'id,idReadable,summary,description,updated,project(name),customFields($type,name,value(name,fullName,login))';

export function toIssueData(
  issue: z.infer<typeof youTrackIssueSchema>,
  instanceUrl: string
): IssueData {
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
