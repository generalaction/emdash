import z from 'zod';
import type { YouTrackClient } from '../../../integrations/impl/youtrack/types';

const customFieldSchema = z.object({
  $type: z.string(),
  name: z.string(),
  value: z.unknown(),
});

const issueSchema = z.object({
  idReadable: z.string().min(1),
  summary: z.string(),
  description: z.string().nullable(),
  updated: z.number().int().min(0).max(8_640_000_000_000_000),
  project: z.object({ name: z.string() }).nullable(),
  customFields: z.array(customFieldSchema),
});

const issueWithActivitySchema = issueSchema.extend({ commentsCount: z.number().int().min(0) });

const commentSchema = z.object({
  id: z.string().min(1),
  text: z.string().nullable(),
  deleted: z.boolean(),
  created: z.number().int().min(0).max(8_640_000_000_000_000),
  author: z.object({ fullName: z.string().nullable(), login: z.string() }).nullable(),
});

export type YouTrackIssueSummaryNode = z.infer<typeof issueSchema>;
export type YouTrackIssueWithActivity = z.infer<typeof issueWithActivitySchema>;
export type YouTrackCommentNode = z.infer<typeof commentSchema>;

const ISSUE_FIELDS =
  'idReadable,summary,description,updated,project(name),customFields($type,name,value(name,fullName,login))';
const COMMENT_PAGE_SIZE = 100;

export function queryYouTrackIssues(
  client: YouTrackClient,
  limit: number
): Promise<YouTrackIssueSummaryNode[]> {
  return searchYouTrackIssues(client, '#Unresolved sort by: updated desc', limit);
}

export async function searchYouTrackIssues(
  client: YouTrackClient,
  term: string,
  limit: number
): Promise<YouTrackIssueSummaryNode[]> {
  return z
    .array(issueSchema)
    .parse(await client.Issues.getIssues({ fields: ISSUE_FIELDS, query: term, $top: limit }));
}

export async function queryYouTrackIssueWithActivity(
  client: YouTrackClient,
  identifier: string
): Promise<YouTrackIssueWithActivity> {
  return issueWithActivitySchema.parse(
    await client.Issues.getIssueById(encodeURIComponent(identifier), {
      fields: `${ISSUE_FIELDS},commentsCount`,
    })
  );
}

export async function fetchYouTrackComments(
  client: YouTrackClient,
  identifier: string,
  skip: number
): Promise<YouTrackCommentNode[]> {
  const issueId = encodeURIComponent(identifier);
  const comments: YouTrackCommentNode[] = [];
  for (let offset = skip; ; ) {
    const page = z.array(commentSchema).parse(
      await client.IssueComments.getIssueComments(issueId, {
        fields: ['id', 'text', 'deleted', 'created', { author: ['fullName', 'login'] }],
        $top: COMMENT_PAGE_SIZE,
        $skip: offset,
      })
    );
    if (!page.length) return comments;
    comments.push(...page);
    offset += page.length;
  }
}
