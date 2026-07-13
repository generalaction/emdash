import { describe, expect, it } from 'vitest';
import { buildGitHubAuthEnv, isNetworkGitCommand } from './github-auth-git-env';

describe('isNetworkGitCommand', () => {
  it('is true for network subcommands', () => {
    expect(isNetworkGitCommand('git', ['fetch', 'origin'])).toBe(true);
    expect(isNetworkGitCommand('git', ['push', '-u', 'origin', 'branch'])).toBe(true);
    expect(isNetworkGitCommand('git', ['clone', 'https://example', 'dir'])).toBe(true);
    expect(isNetworkGitCommand('git', ['ls-remote', 'origin'])).toBe(true);
  });

  it('ignores leading flags when finding the subcommand', () => {
    expect(isNetworkGitCommand('git', ['-c', 'foo=bar', 'fetch', 'origin'])).toBe(true);
  });

  it('is false for local subcommands', () => {
    expect(isNetworkGitCommand('git', ['worktree', 'list'])).toBe(false);
    expect(isNetworkGitCommand('git', ['status'])).toBe(false);
    expect(isNetworkGitCommand('git', ['remote', 'get-url', 'origin'])).toBe(false);
    expect(isNetworkGitCommand('git', [])).toBe(false);
  });

  it('is false for non-git commands', () => {
    expect(isNetworkGitCommand('gh', ['api', 'user'])).toBe(false);
    expect(isNetworkGitCommand('node', ['fetch'])).toBe(false);
  });
});

describe('buildGitHubAuthEnv', () => {
  it('builds a host-scoped extraheader via GIT_CONFIG_* env', () => {
    const env = buildGitHubAuthEnv('github.com', 'ghs_secret');
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    const expected = Buffer.from('x-access-token:ghs_secret').toString('base64');
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${expected}`);
  });

  it('normalizes the host and scopes the header to it (GHES)', () => {
    const env = buildGitHubAuthEnv('ghe.example.com', 'tok');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://ghe.example.com/.extraheader');
  });
});
