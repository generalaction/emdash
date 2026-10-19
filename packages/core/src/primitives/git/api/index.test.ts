import { describe, expect, it } from 'vitest';
import { isGitDiscoveryMiss, withSafeGitDirectoryEnv } from './index';

describe('Git discovery diagnostics', () => {
  it.each([
    'fatal: not a git repository (or any of the parent directories): .git\n',
    'fatal: not a git repository (or any parent up to mount point /mnt/projects)\nStopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).\n',
  ])('recognizes a completed search with no repository: %s', (stderr) => {
    expect(isGitDiscoveryMiss({ exitCode: 128, stderr })).toBe(true);
    expect(isGitDiscoveryMiss({ exitCode: null, stderr })).toBe(false);
    expect(isGitDiscoveryMiss({ exitCode: 127, stderr })).toBe(false);
  });

  it.each([
    'fatal: not a git repository: /repo/missing-git-directory',
    'fatal: not a git directory: /repo/.git',
    'fatal: invalid gitfile format: /repo/.git',
    'fatal: this operation must be run in a work tree',
    'fatal: bad config line 1 in file .git/config',
    "fatal: detected dubious ownership in repository at '/repo'",
    "fatal: cannot change to 'not a git repository': Permission denied",
    'warning: failed to access repository\nfatal: not a git repository (or any of the parent directories): .git',
  ])('keeps an unsuccessful or ambiguous inspection as a failure: %s', (stderr) => {
    expect(isGitDiscoveryMiss({ exitCode: 128, stderr })).toBe(false);
  });
});

describe('withSafeGitDirectoryEnv', () => {
  it('injects safe.directory wildcard on Windows platforms', () => {
    const input = { PATH: 'C:\\Windows' };
    const result = withSafeGitDirectoryEnv(input, 'win32');
    expect(result).toEqual({
      PATH: 'C:\\Windows',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
    });
  });

  it('preserves existing env without modifying on non-Windows platforms', () => {
    const input = { PATH: '/usr/bin' };
    expect(withSafeGitDirectoryEnv(input, 'linux')).toEqual(input);
    expect(withSafeGitDirectoryEnv(input, 'darwin')).toEqual(input);
  });

  it('does not overwrite existing GIT_CONFIG_COUNT or GIT_CONFIG_PARAMETERS on Windows', () => {
    const withCount = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'foo.bar' };
    expect(withSafeGitDirectoryEnv(withCount, 'win32')).toEqual(withCount);

    const withParams = { GIT_CONFIG_PARAMETERS: "'safe.directory=/repo'" };
    expect(withSafeGitDirectoryEnv(withParams, 'win32')).toEqual(withParams);
  });
});
