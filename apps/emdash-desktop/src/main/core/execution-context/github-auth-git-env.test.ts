import { describe, expect, it } from 'vitest';
import { buildGitHubAuthEnv, isNetworkGitCommand } from './github-auth-git-env';

describe('isNetworkGitCommand', () => {
  it('is true for network subcommands', () => {
    expect(isNetworkGitCommand('git', ['fetch', 'origin'])).toBe(true);
    expect(isNetworkGitCommand('git', ['push', '-u', 'origin', 'branch'])).toBe(true);
    expect(isNetworkGitCommand('git', ['clone', 'https://example', 'dir'])).toBe(true);
    expect(isNetworkGitCommand('git', ['ls-remote', 'origin'])).toBe(true);
  });

  it('skips global options that take a separate value', () => {
    // The option value (foo=bar, /repo) must not be mistaken for the subcommand.
    expect(isNetworkGitCommand('git', ['-c', 'foo=bar', 'fetch', 'origin'])).toBe(true);
    expect(isNetworkGitCommand('git', ['-C', '/repo', 'push', 'origin', 'main'])).toBe(true);
    expect(
      isNetworkGitCommand('git', ['-c', 'a=b', '-C', '/repo', 'ls-remote', 'origin'])
    ).toBe(true);
    expect(isNetworkGitCommand('git', ['--git-dir', '/repo/.git', 'fetch'])).toBe(true);
  });

  it('handles --opt=value global options', () => {
    expect(isNetworkGitCommand('git', ['--git-dir=/repo/.git', 'fetch'])).toBe(true);
    expect(isNetworkGitCommand('git', ['-c', 'foo=bar', 'status'])).toBe(false);
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
    const env = buildGitHubAuthEnv('github.com', 'ghs_secret', {});
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    const expected = Buffer.from('x-access-token:ghs_secret').toString('base64');
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${expected}`);
  });

  it('normalizes the host and scopes the header to it (GHES)', () => {
    const env = buildGitHubAuthEnv('ghe.example.com', 'tok', {});
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://ghe.example.com/.extraheader');
  });

  it('appends after existing GIT_CONFIG_* entries instead of overwriting them', () => {
    const env = buildGitHubAuthEnv('github.com', 'tok', { GIT_CONFIG_COUNT: '2' });
    // Our entry goes at index 2, and the count is bumped to 3, preserving 0 and 1.
    expect(env.GIT_CONFIG_COUNT).toBe('3');
    expect(env.GIT_CONFIG_KEY_2).toBe('http.https://github.com/.extraheader');
    expect(env.GIT_CONFIG_VALUE_2).toContain('Authorization: Basic ');
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
  });

  it('treats an invalid GIT_CONFIG_COUNT as zero', () => {
    expect(buildGitHubAuthEnv('github.com', 'tok', { GIT_CONFIG_COUNT: 'nope' }).GIT_CONFIG_COUNT).toBe('1');
    expect(buildGitHubAuthEnv('github.com', 'tok', { GIT_CONFIG_COUNT: '-4' }).GIT_CONFIG_COUNT).toBe('1');
  });
});
