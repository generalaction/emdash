import { describe, expect, it } from 'vitest';
import { isGitDiscoveryMiss, isWslPath, withSafeGitDirectoryEnv } from './index';

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

describe('isWslPath', () => {
  it('identifies WSL UNC roots', () => {
    expect(isWslPath('\\\\wsl.localhost\\Ubuntu\\home\\user\\repo')).toBe(true);
    expect(isWslPath('\\\\wsl$\\Ubuntu\\home\\user\\repo')).toBe(true);
    expect(isWslPath('//wsl.localhost/Ubuntu/home/user/repo')).toBe(true);
    expect(isWslPath('//wsl$/Ubuntu/home/user/repo')).toBe(true);
  });

  it('rejects non-WSL paths', () => {
    expect(isWslPath('C:\\Users\\Alice\\repo')).toBe(false);
    expect(isWslPath('C:/Users/Alice/repo')).toBe(false);
    expect(isWslPath('\\\\other-server\\share\\repo')).toBe(false);
    expect(isWslPath('/home/user/repo')).toBe(false);
    expect(isWslPath('')).toBe(false);
  });
});

describe('withSafeGitDirectoryEnv', () => {
  const wslPath = '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo';

  it('injects safe.directory for intended WSL path on Windows', () => {
    const input = { PATH: 'C:\\Windows' };
    const result = withSafeGitDirectoryEnv(input, wslPath, 'win32');
    expect(result).toEqual({
      PATH: 'C:\\Windows',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
      GIT_CONFIG_KEY_1: 'safe.directory',
      GIT_CONFIG_VALUE_1: '//wsl.localhost/Ubuntu/home/user/repo',
    });
  });

  it('does not inject safe.directory for non-WSL paths on Windows', () => {
    const input = { PATH: 'C:\\Windows' };
    expect(withSafeGitDirectoryEnv(input, 'C:\\Users\\Mallory\\repo', 'win32')).toEqual(input);
  });

  it('preserves existing env without modifying on non-Windows platforms', () => {
    const input = { PATH: '/usr/bin' };
    expect(withSafeGitDirectoryEnv(input, wslPath, 'linux')).toEqual(input);
    expect(withSafeGitDirectoryEnv(input, wslPath, 'darwin')).toEqual(input);
  });

  it('composes cleanly with existing credential settings without overwriting them', () => {
    const withCredentials = {
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!echo helper',
    };
    const result = withSafeGitDirectoryEnv(withCredentials, wslPath, 'win32');
    expect(result).toEqual({
      ...withCredentials,
      GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_KEY_2: 'safe.directory',
      GIT_CONFIG_VALUE_2: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
      GIT_CONFIG_KEY_3: 'safe.directory',
      GIT_CONFIG_VALUE_3: '//wsl.localhost/Ubuntu/home/user/repo',
    });
  });

  it('does not duplicate existing safe.directory entries', () => {
    const alreadyConfigured = {
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
      GIT_CONFIG_KEY_1: 'safe.directory',
      GIT_CONFIG_VALUE_1: '//wsl.localhost/Ubuntu/home/user/repo',
    };
    expect(withSafeGitDirectoryEnv(alreadyConfigured, wslPath, 'win32')).toEqual(alreadyConfigured);
  });

  it('handles multiple paths and only injects for WSL paths', () => {
    const input = { PATH: 'C:\\Windows' };
    const result = withSafeGitDirectoryEnv(
      input,
      ['C:\\Users\\Mallory\\repo', wslPath, undefined],
      'win32'
    );
    expect(result).toEqual({
      PATH: 'C:\\Windows',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
      GIT_CONFIG_KEY_1: 'safe.directory',
      GIT_CONFIG_VALUE_1: '//wsl.localhost/Ubuntu/home/user/repo',
    });
  });

  it('trusts enclosing repository root when path points to .git', () => {
    const input = { PATH: 'C:\\Windows' };
    const gitDirPath = '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\.git';
    const result = withSafeGitDirectoryEnv(input, gitDirPath, 'win32');
    expect(result).toEqual({
      PATH: 'C:\\Windows',
      GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\.git',
      GIT_CONFIG_KEY_1: 'safe.directory',
      GIT_CONFIG_VALUE_1: '//wsl.localhost/Ubuntu/home/user/repo/.git',
      GIT_CONFIG_KEY_2: 'safe.directory',
      GIT_CONFIG_VALUE_2: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
      GIT_CONFIG_KEY_3: 'safe.directory',
      GIT_CONFIG_VALUE_3: '//wsl.localhost/Ubuntu/home/user/repo',
    });
  });

  it('honors existing wildcard safe.directory without adding redundant entries', () => {
    const withWildcard = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
    };
    expect(withSafeGitDirectoryEnv(withWildcard, wslPath, 'win32')).toEqual(withWildcard);
  });

  it('returns untouched env when targetPath is omitted', () => {
    const input = { PATH: 'C:\\Windows' };
    expect(withSafeGitDirectoryEnv(input, undefined, 'win32')).toEqual(input);
  });

  it('resolves enclosing repository root when given a WSL subfolder', () => {
    const input = { PATH: 'C:\\Windows' };
    const subfolderPath = '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\packages\\sub';
    const fakeFileExists = (p: string) =>
      p.replace(/\\/g, '/').toLowerCase() === '//wsl.localhost/ubuntu/home/user/repo/.git';

    const result = withSafeGitDirectoryEnv(input, subfolderPath, 'win32', fakeFileExists);
    expect(result).toEqual({
      PATH: 'C:\\Windows',
      GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\packages\\sub',
      GIT_CONFIG_KEY_1: 'safe.directory',
      GIT_CONFIG_VALUE_1: '//wsl.localhost/Ubuntu/home/user/repo/packages/sub',
      GIT_CONFIG_KEY_2: 'safe.directory',
      GIT_CONFIG_VALUE_2: '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo',
      GIT_CONFIG_KEY_3: 'safe.directory',
      GIT_CONFIG_VALUE_3: '//wsl.localhost/Ubuntu/home/user/repo',
    });
  });
});

describe('findWslRepositoryRoot', () => {
  it('finds repository root from subfolder within WSL', async () => {
    const { findWslRepositoryRoot } = await import('./index');
    const fakeFileExists = (p: string) =>
      p.replace(/\\/g, '/').toLowerCase() === '//wsl.localhost/ubuntu/home/user/repo/.git';

    expect(
      findWslRepositoryRoot(
        '\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\src\\components',
        fakeFileExists
      )
    ).toBe('\\\\wsl.localhost\\Ubuntu\\home\\user\\repo');
  });

  it('returns null when path is not in a repository', async () => {
    const { findWslRepositoryRoot } = await import('./index');
    const fakeFileExists = () => false;

    expect(
      findWslRepositoryRoot('\\\\wsl.localhost\\Ubuntu\\home\\user\\plain-dir', fakeFileExists)
    ).toBe(null);
  });

  it('returns null for non-WSL paths', async () => {
    const { findWslRepositoryRoot } = await import('./index');
    expect(findWslRepositoryRoot('C:\\Users\\Mallory\\repo')).toBe(null);
  });
});
