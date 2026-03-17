export type PullRequestFilterId = 'all' | 'needs-review' | 'my-prs' | 'draft' | 'custom';

export interface PullRequestFilterPreset {
  id: Exclude<PullRequestFilterId, 'custom'>;
  label: string;
  query: string;
}

export const PULL_REQUEST_FILTER_PRESETS: PullRequestFilterPreset[] = [
  { id: 'all', label: 'All Open', query: '' },
  { id: 'needs-review', label: 'Needs My Review', query: 'review-requested:@me draft:false' },
  { id: 'my-prs', label: 'My PRs', query: 'author:@me' },
  { id: 'draft', label: 'Draft', query: 'draft:true' },
];

export function normalizePullRequestSearchQuery(query?: string | null): string {
  return query?.trim() || '';
}

export function resolvePullRequestFilterId(query?: string | null): PullRequestFilterId {
  const normalizedQuery = normalizePullRequestSearchQuery(query);
  if (!normalizedQuery) {
    return 'all';
  }

  return (
    PULL_REQUEST_FILTER_PRESETS.find((preset) => preset.query === normalizedQuery)?.id ?? 'custom'
  );
}
