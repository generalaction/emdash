import { describe, it, expect } from 'vitest';
import { buildReviewers } from '../../renderer/lib/reviewersStatus';

describe('buildReviewers', () => {
  it('merges requested with no reviews as PENDING', () => {
    const result = buildReviewers([{ login: 'alice', avatarUrl: 'https://example.com/alice' }], []);
    expect(result).toEqual([
      { login: 'alice', avatarUrl: 'https://example.com/alice', state: 'PENDING' },
    ]);
  });

  it('uses review state over PENDING for reviewers who submitted', () => {
    const result = buildReviewers(
      [{ login: 'alice' }],
      [{ author: { login: 'alice' }, state: 'APPROVED', submittedAt: '2026-01-01' }]
    );
    expect(result).toEqual([{ login: 'alice', avatarUrl: undefined, state: 'APPROVED' }]);
  });

  it('includes reviewers who submitted without being in reviewRequests', () => {
    const result = buildReviewers(
      [],
      [{ author: { login: 'bob' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01' }]
    );
    expect(result).toEqual([{ login: 'bob', avatarUrl: undefined, state: 'CHANGES_REQUESTED' }]);
  });

  it('deduplicates: reviewer in both reviewRequests and reviews appears once', () => {
    const result = buildReviewers(
      [{ login: 'carol' }],
      [
        { author: { login: 'carol' }, state: 'COMMENTED', submittedAt: '2026-01-01' },
        { author: { login: 'carol' }, state: 'APPROVED', submittedAt: '2026-01-02' },
      ]
    );
    // Latest review state wins; carol appears once
    expect(result).toHaveLength(1);
    expect(result[0].login).toBe('carol');
    expect(result[0].state).toBe('APPROVED');
  });

  it('returns empty array for no reviewers', () => {
    expect(buildReviewers([], [])).toEqual([]);
  });
});
