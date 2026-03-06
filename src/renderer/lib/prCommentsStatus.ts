export interface PrCommentAuthor {
  login: string;
  avatarUrl?: string;
}

export interface PrComment {
  id: string;
  author: PrCommentAuthor;
  body: string;
  createdAt: string;
  type: 'comment' | 'review';
  reviewState?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
}

export interface PrCommentsStatus {
  comments: PrComment[];
}

export function buildPrCommentsStatus(
  rawComments: Array<{ id: string; author: PrCommentAuthor; body: string; createdAt: string }>,
  rawReviews: Array<{
    id: string;
    author: PrCommentAuthor;
    body: string;
    submittedAt: string;
    state: string;
  }>
): PrCommentsStatus {
  const comments: PrComment[] = rawComments.map((c) => ({
    id: c.id,
    author: c.author,
    body: c.body,
    createdAt: c.createdAt,
    type: 'comment',
  }));

  const reviews: PrComment[] = rawReviews
    .filter((r) => r.body || r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
    .map((r) => ({
      id: r.id,
      author: r.author,
      body: r.body,
      createdAt: r.submittedAt,
      type: 'review',
      reviewState: r.state as PrComment['reviewState'],
    }));

  const all = [...comments, ...reviews].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return { comments: all };
}

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  if (isNaN(date)) return '';
  const diffMs = now - date;
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
