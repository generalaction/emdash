import type { YouTrackClient } from '../../../integrations/impl/youtrack/types';
import { fetchYouTrackComments, type YouTrackCommentNode } from './queries';

const MAX_CONTEXT_COMMENTS = 100;

export async function getYouTrackIssueDetails(
  client: YouTrackClient,
  identifier: string,
  commentsCount: number
): Promise<{ context: string | undefined }> {
  const limit = Math.min(commentsCount, MAX_CONTEXT_COMMENTS);
  const omitted = commentsCount - limit;
  const comments = await fetchYouTrackComments(client, identifier, omitted, limit);
  return { context: formatYouTrackContext(comments, omitted) };
}

export function formatYouTrackContext(
  comments: YouTrackCommentNode[],
  omitted: number
): string | undefined {
  const context = comments
    .filter((comment) => !comment.deleted && comment.text?.trim())
    .map(
      (comment) =>
        `- ${new Date(comment.created).toISOString()} by ${comment.author?.fullName || comment.author?.login || 'Unknown'}: ${comment.text?.trim()}`
    );
  return context.length
    ? [
        'YouTrack comments',
        ...(omitted ? [`(${omitted} older comments omitted)`] : []),
        '',
        ...context,
      ].join('\n')
    : undefined;
}
