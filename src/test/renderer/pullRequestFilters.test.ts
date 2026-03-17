import { describe, expect, it } from 'vitest';
import {
  normalizePullRequestSearchQuery,
  resolvePullRequestFilterId,
} from '../../renderer/lib/pullRequestFilters';

describe('pullRequestFilters', () => {
  it('normalizes empty search queries to all-open state', () => {
    expect(normalizePullRequestSearchQuery('   ')).toBe('');
    expect(resolvePullRequestFilterId('')).toBe('all');
  });

  it('matches built-in presets by their query string', () => {
    expect(resolvePullRequestFilterId('review-requested:@me draft:false')).toBe('needs-review');
    expect(resolvePullRequestFilterId('author:@me')).toBe('my-prs');
    expect(resolvePullRequestFilterId('draft:true')).toBe('draft');
  });

  it('marks non-preset queries as custom', () => {
    expect(resolvePullRequestFilterId('label:release-blocker sort:updated-desc')).toBe('custom');
  });
});
