export type PullRequestFilterId = 'all' | 'needs-review' | 'my-prs' | 'draft' | 'custom';

export interface PullRequestFilterPreset {
  id: Exclude<PullRequestFilterId, 'custom'>;
  label: string;
  query: string;
}

const GITHUB_FILTER_PRESETS: PullRequestFilterPreset[] = [
  { id: 'all', label: 'All Open', query: '' },
  { id: 'needs-review', label: 'Needs My Review', query: 'review-requested:@me draft:false' },
  { id: 'my-prs', label: 'My PRs', query: 'author:@me' },
  { id: 'draft', label: 'Draft', query: 'draft:true' },
];

const GITLAB_FILTER_PRESETS: PullRequestFilterPreset[] = [
  { id: 'all', label: 'All Open', query: '' },
  { id: 'needs-review', label: 'Needs My Review', query: 'reviewer:@me not-draft' },
  { id: 'my-prs', label: 'My MRs', query: 'assignee:@me' },
  { id: 'draft', label: 'Draft', query: 'draft:true' },
];

export function getPullRequestFilterPresets(gitPlatform?: string): PullRequestFilterPreset[] {
  return gitPlatform === 'gitlab' ? GITLAB_FILTER_PRESETS : GITHUB_FILTER_PRESETS;
}

// Keep the old export for backward compat, defaulting to GitHub
export const PULL_REQUEST_FILTER_PRESETS = GITHUB_FILTER_PRESETS;

export function normalizePullRequestSearchQuery(query?: string | null): string {
  return query?.trim() || '';
}

export function resolvePullRequestFilterId(
  query?: string | null,
  presets?: PullRequestFilterPreset[]
): PullRequestFilterId {
  const normalizedQuery = normalizePullRequestSearchQuery(query);
  if (!normalizedQuery) {
    return 'all';
  }

  const list = presets ?? PULL_REQUEST_FILTER_PRESETS;
  return list.find((preset) => preset.query === normalizedQuery)?.id ?? 'custom';
}
