import { describe, expect, it } from 'vitest';
import { parseIssueSearchError } from './parse-issue-search-error';

describe('parseIssueSearchError', () => {
  it('returns a Notion access error with an integrations action', () => {
    const result = parseIssueSearchError(
      'notion',
      'Notion cannot access the configured data source. Share the page or database with emdash, or update the scope URLs in Emdash settings.',
      'not_found_or_no_access'
    );

    expect(result).toEqual({
      kind: 'access',
      title: 'Notion access required',
      description:
        'Notion cannot access the configured data source. Share the page or database with emdash, or update the scope URLs in Emdash settings.',
      actionLabel: 'Open integrations',
    });
  });

  it('returns a GitHub access error with an integrations action', () => {
    const result = parseIssueSearchError(
      'github',
      'acme/repo on github.com was not found, or the selected GitHub account does not have access.'
    );

    expect(result).toEqual({
      kind: 'access',
      title: 'GitHub access required',
      description:
        'acme/repo on github.com was not found, or the selected GitHub account does not have access.',
      actionLabel: 'Open integrations',
    });
  });

  it('returns a generic error when no provider-specific pattern matches', () => {
    const result = parseIssueSearchError('linear', 'Linear API rate limit exceeded.');

    expect(result).toEqual({
      kind: 'generic',
      title: 'Could not load issues',
      description: 'Linear API rate limit exceeded.',
    });
  });

  it('returns a Notion auth error from a typed error', () => {
    const result = parseIssueSearchError(
      'notion',
      'Notion authentication failed. Check your access token.',
      'auth_required'
    );

    expect(result).toEqual({
      kind: 'auth',
      title: 'Notion connection issue',
      description: 'Notion authentication failed. Check your access token.',
      actionLabel: 'Open integrations',
    });
  });

  it('returns null when there is no error', () => {
    expect(parseIssueSearchError('notion', null)).toBeNull();
  });
});
