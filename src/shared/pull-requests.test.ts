import { describe, expect, it } from 'vitest';
import { pullRequestErrorMessage } from './pull-requests';

describe('pullRequestErrorMessage', () => {
  it('formats github.com auth errors separately from GHES auth errors', () => {
    expect(
      pullRequestErrorMessage({
        type: 'github_auth_required',
        host: 'github.com',
        hint: 'Connect GitHub from account settings.',
      })
    ).toBe('GitHub authentication required. Connect GitHub from account settings.');

    expect(
      pullRequestErrorMessage({
        type: 'ghes_auth_required',
        host: 'ghe.example.com',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    ).toBe(
      'GitHub Enterprise authentication required for ghe.example.com. Run: gh auth login --hostname ghe.example.com'
    );
  });
});
