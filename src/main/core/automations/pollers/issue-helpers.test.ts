import { describe, expect, it } from 'vitest';
import type { GitHubIssue } from '@main/core/github/services/issue-service';
import { diffIssuesAgainstCursor } from './issue-helpers';

function issue(number: number, createdAt = '2024-01-01T00:00:00Z'): GitHubIssue {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/repo/issues/${number}`,
    state: 'open',
    createdAt,
    updatedAt: createdAt,
    comments: 0,
    user: { login: 'alice', avatarUrl: '' },
    assignees: [],
    labels: [],
  };
}

describe('diffIssuesAgainstCursor', () => {
  it('does not treat a PR-initialized cursor as issue-initialized', async () => {
    const result = await diffIssuesAgainstCursor(
      'project-1',
      { initializedPrs: true, seenPrs: { 'https://github.com/acme/repo/pull/1': 'open' } },
      async () => ({ ok: true, issues: [issue(1)] })
    );

    expect(result.events).toEqual([]);
    expect(result.cursor.initializedIssues).toBe(true);
    expect(result.cursor.initializedPrs).toBe(true);
  });
});
