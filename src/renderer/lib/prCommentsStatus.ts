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
    submittedAt?: string;
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
      createdAt: r.submittedAt ?? '',
      type: 'review',
      reviewState: r.state as PrComment['reviewState'],
    }));

  const toMillis = (dateStr: string): number => {
    const ms = new Date(dateStr).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  };

  const all = [...comments, ...reviews].sort(
    (a, b) => toMillis(a.createdAt) - toMillis(b.createdAt)
  );

  return { comments: all };
}
