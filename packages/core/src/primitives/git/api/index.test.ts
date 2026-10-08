import { describe, expect, it } from 'vitest';
import { isGitDiscoveryMiss } from './index';

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
