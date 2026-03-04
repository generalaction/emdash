export type ReviewerState =
  | 'PENDING'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'COMMENTED'
  | 'DISMISSED';

export interface Reviewer {
  login: string;
  avatarUrl?: string;
  state: ReviewerState;
}

export function buildReviewers(
  reviewRequests: Array<{ login: string; avatarUrl?: string }>,
  reviews: Array<{
    author: { login: string; avatarUrl?: string };
    state: string;
    submittedAt: string;
  }>
): Reviewer[] {
  // Build a map keyed by login. Start with requested reviewers (PENDING).
  const map = new Map<string, Reviewer>();

  for (const req of reviewRequests) {
    map.set(req.login, { login: req.login, avatarUrl: req.avatarUrl, state: 'PENDING' });
  }

  // Sort reviews oldest-first so latest review wins when we overwrite.
  const sorted = [...reviews].sort(
    (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
  );

  for (const review of sorted) {
    const login = review.author.login;
    const existing = map.get(login);
    map.set(login, {
      login,
      avatarUrl: existing?.avatarUrl ?? review.author.avatarUrl,
      state: (review.state as ReviewerState) || 'COMMENTED',
    });
  }

  return Array.from(map.values());
}
