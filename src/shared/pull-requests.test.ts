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

  it('formats host reachability errors for any GitHub host', () => {
    expect(
      pullRequestErrorMessage({
        type: 'host_unreachable',
        host: 'github.com',
        reason: 'Connect Timeout Error',
      })
    ).toBe('Unable to reach GitHub host github.com: Connect Timeout Error');

    expect(
      pullRequestErrorMessage({
        type: 'host_unreachable',
        host: 'ghe.example.com',
        reason: 'Connect Timeout Error',
      })
    ).toBe('Unable to reach GitHub host ghe.example.com: Connect Timeout Error');
  });
});
