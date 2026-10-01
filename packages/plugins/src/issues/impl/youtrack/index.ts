import { err, ok } from '@emdash/shared';
import z from 'zod';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  readYouTrackCredentials,
  requestYouTrack,
  toYouTrackError,
  YOU_TRACK_REQUEST_TIMEOUT_MS,
} from '../../../integrations/impl/youtrack/client';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../../types';
import { toIssueData, youTrackIssueSchema, YOU_TRACK_ISSUE_FIELDS } from './mapper';

const commentSchema = z.object({
  id: z.string().min(1),
  text: z.string().nullable(),
  deleted: z.boolean(),
  created: z.number().int().min(0).max(8_640_000_000_000_000),
  author: z.object({ fullName: z.string().nullable(), login: z.string() }).nullable(),
});

// Long discussions would exhaust the shared deadline and flood the prompt; the latest comments
// usually carry the current state of the ticket.
const MAX_CONTEXT_COMMENTS = 100;

async function queryIssues(
  host: ConnectedIntegrationHostContext,
  query: string,
  limit: number
): Promise<IssueListResult> {
  const credentials = readYouTrackCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  try {
    const issues = await requestYouTrack(
      credentials.data,
      'issues',
      { fields: YOU_TRACK_ISSUE_FIELDS, query, $top: String(limit) },
      z.array(youTrackIssueSchema)
    );
    return ok(issues.map((issue) => toIssueData(issue, credentials.data.instanceUrl)));
  } catch (error) {
    return err(toYouTrackError(error));
  }
}

export function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  return queryIssues(
    host,
    '#Unresolved sort by: updated desc',
    clampIssueLimit(opts.limit, 50, 100)
  );
}

export function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  return term
    ? queryIssues(host, term, clampIssueLimit(opts.limit, 20, 100))
    : Promise.resolve(ok([]));
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const identifier = normalizeSearchTerm(opts.identifier);
  if (!/^[^\s/\\?#]+-\d+$/u.test(identifier)) {
    return err({ type: 'invalid_input', message: 'A valid YouTrack ticket ID is required.' });
  }
  const credentials = readYouTrackCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  const path = `issues/${encodeURIComponent(identifier)}`;
  // One deadline also bounds pagination when a ticket has a long discussion.
  const signal = AbortSignal.timeout(YOU_TRACK_REQUEST_TIMEOUT_MS);
  try {
    const issue = await requestYouTrack(
      credentials.data,
      path,
      { fields: `${YOU_TRACK_ISSUE_FIELDS},commentsCount` },
      youTrackIssueSchema.extend({ commentsCount: z.number().int().min(0) }),
      signal
    );
    const omitted = Math.max(0, issue.commentsCount - MAX_CONTEXT_COMMENTS);
    const comments: z.infer<typeof commentSchema>[] = [];
    for (let skip = omitted; ; ) {
      const page = await requestYouTrack(
        credentials.data,
        `${path}/comments`,
        {
          fields: 'id,text,deleted,created,author(fullName,login)',
          $top: '100',
          $skip: String(skip),
        },
        z.array(commentSchema),
        signal
      );
      if (!page.length) break;
      comments.push(...page);
      skip += page.length;
    }
    const context = comments
      .filter((comment) => !comment.deleted && comment.text?.trim())
      .map(
        (comment) =>
          `- ${new Date(comment.created).toISOString()} by ${comment.author?.fullName || comment.author?.login || 'Unknown'}: ${comment.text?.trim()}`
      );
    return ok({
      ...toIssueData(issue, credentials.data.instanceUrl),
      context: context.length
        ? [
            'YouTrack comments',
            ...(omitted ? [`(${omitted} older comments omitted)`] : []),
            '',
            ...context,
          ].join('\n')
        : undefined,
    });
  } catch (error) {
    return err(toYouTrackError(error));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'youtrack' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue },
});
