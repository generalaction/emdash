import type { PullRequest, PullRequestComment } from '@shared/pull-requests';

export type PullRequestDescriptionItem = {
  id: string;
  pullRequestUrl: string;
  kind: 'description';
  body: string;
  url: string;
  author: PullRequest['author'];
  path: null;
  line: null;
  isResolved: false;
  isOutdated: false;
  createdAt: string;
  updatedAt: string;
};

export type PullRequestConversationItem = PullRequestDescriptionItem | PullRequestComment;

export type AddressablePullRequestComment = PullRequestComment;

function descriptionItemForPr(pr: PullRequest): PullRequestDescriptionItem | null {
  const body = pr.description?.trim();
  if (!body) return null;

  return {
    id: `description:${pr.url}`,
    pullRequestUrl: pr.url,
    kind: 'description',
    body,
    url: pr.url,
    author: pr.author,
    path: null,
    line: null,
    isResolved: false,
    isOutdated: false,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
  };
}

export function sortPullRequestConversationItems(
  a: PullRequestConversationItem,
  b: PullRequestConversationItem
): number {
  if (a.kind === 'description' && b.kind !== 'description') return -1;
  if (a.kind !== 'description' && b.kind === 'description') return 1;

  const createdAtDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (createdAtDelta !== 0) return createdAtDelta;

  return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
}

export function buildPullRequestConversationItems(
  pr: PullRequest,
  comments: PullRequestComment[]
): PullRequestConversationItem[] {
  const description = descriptionItemForPr(pr);
  return [...(description ? [description] : []), ...comments];
}

export function isAddressablePullRequestComment(
  item: PullRequestConversationItem
): item is AddressablePullRequestComment {
  return item.kind !== 'description';
}

function commentAuthorLabel(comment: AddressablePullRequestComment): string {
  return comment.author?.displayName ?? comment.author?.userName ?? 'Unknown author';
}

function commentLocationLabel(comment: AddressablePullRequestComment): string | null {
  if (!comment.path) return null;
  return comment.line ? `${comment.path}:${comment.line}` : comment.path;
}

function escapeXmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function metadataLine(label: string, value: string): string {
  return `${label}: ${escapeXmlText(value)}`;
}

export function formatPullRequestCommentForAgent(
  pr: PullRequest,
  comment: AddressablePullRequestComment
): string {
  const prLabel = pr.identifier ? `${pr.identifier} ${pr.title}` : pr.title;
  const location = commentLocationLabel(comment);
  const metadata = [
    metadataLine('Pull request', prLabel),
    metadataLine('Pull request URL', pr.url),
    metadataLine('Comment URL', comment.url),
    metadataLine('Author', commentAuthorLabel(comment)),
    metadataLine('Created', comment.createdAt),
    location ? metadataLine('Location', location) : null,
    comment.isResolved ? 'Status: resolved' : null,
    comment.isOutdated ? 'Status: outdated' : null,
  ].filter((line): line is string => line !== null);

  return `${metadata.join('\n')}

Body:
${escapeXmlText(comment.body.trim())}`;
}
