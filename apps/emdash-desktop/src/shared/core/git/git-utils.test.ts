import type { GitBranchRef } from '@emdash/shared/git';
import { describe, expect, it } from 'vitest';
import {
  projectDefaultBranchToBranch,
  resolveBaseRefFromRemoteDefault,
  resolveDefaultBranch,
} from './git-utils';

const origin = { name: 'origin', url: 'git@github.com:example/repo.git' };
const fork = { name: 'fork', url: 'git@github.com:user/repo.git' };

const branches: GitBranchRef[] = [
  { type: 'local', branch: 'feature/current' },
  { type: 'local', branch: 'develop' },
  { type: 'remote', branch: 'main', remote: origin },
  { type: 'remote', branch: 'develop', remote: origin },
  { type: 'remote', branch: 'main', remote: fork },
];

describe('resolveDefaultBranch', () => {
  it('prefers a valid explicit project default over the remote default', () => {
    const preference: GitBranchRef = { type: 'local', branch: 'develop' };

    expect(
      resolveDefaultBranch({
        preference,
        branches,
        configuredRemoteName: 'origin',
        gitDefaultBranch: 'main',
      })
    ).toEqual({ type: 'local', branch: 'develop' });
  });

  it('prefers the configured remote default when there is no explicit project default', () => {
    expect(
      resolveDefaultBranch({
        branches,
        configuredRemoteName: 'origin',
        gitDefaultBranch: 'main',
        baseRef: 'origin/feature/current',
      })
    ).toEqual({ type: 'remote', branch: 'main', remote: origin });
  });

  it('uses baseRef only when the remote default cannot be resolved', () => {
    expect(
      resolveDefaultBranch({
        branches,
        configuredRemoteName: 'origin',
        gitDefaultBranch: 'release',
        baseRef: 'origin/feature/current',
      })
    ).toEqual({ type: 'local', branch: 'feature/current' });
  });

  it('falls back to an existing conventional branch instead of inventing origin/main', () => {
    expect(
      resolveDefaultBranch({
        branches: [{ type: 'local', branch: 'master' }],
        configuredRemoteName: 'origin',
        gitDefaultBranch: 'main',
        baseRef: 'origin/missing',
      })
    ).toEqual({ type: 'local', branch: 'master' });
  });

  it('returns undefined when no candidate resolves to an existing branch', () => {
    expect(
      resolveDefaultBranch({
        branches: [],
        configuredRemoteName: 'origin',
        gitDefaultBranch: 'main',
        baseRef: 'origin/feature/current',
      })
    ).toBeUndefined();
  });

  it('uses the explicit remote preference even when another remote is configured', () => {
    const preference: GitBranchRef = {
      type: 'remote',
      branch: 'main',
      remote: fork,
    };

    expect(
      resolveDefaultBranch({
        preference,
        branches,
        configuredRemoteName: 'origin',
        gitDefaultBranch: 'develop',
      })
    ).toEqual({ type: 'remote', branch: 'main', remote: fork });
  });
});

describe('resolveBaseRefFromRemoteDefault', () => {
  it('replaces a detected feature baseRef with the remote default when it exists', () => {
    expect(
      resolveBaseRefFromRemoteDefault({
        detectedBaseRef: 'origin/feature/current',
        gitDefaultBranch: 'main',
        branches,
      })
    ).toBe('origin/main');
  });

  it('keeps the detected baseRef when the remote default does not exist', () => {
    expect(
      resolveBaseRefFromRemoteDefault({
        detectedBaseRef: 'origin/feature/current',
        gitDefaultBranch: 'release',
        branches,
      })
    ).toBe('origin/feature/current');
  });
});

describe('projectDefaultBranchToBranch', () => {
  it('parses qualified remote branch settings with known remote metadata', () => {
    expect(projectDefaultBranchToBranch('fork/main', origin, [origin, fork])).toEqual({
      type: 'remote',
      branch: 'main',
      remote: fork,
    });
  });

  it('keeps unknown qualified remote branch settings as remote branches', () => {
    expect(projectDefaultBranchToBranch('upstream/main', origin, [origin])).toEqual({
      type: 'remote',
      branch: 'main',
      remote: { name: 'upstream', url: '' },
    });
  });

  it('uses the configured remote for object branch settings', () => {
    expect(
      projectDefaultBranchToBranch({ name: 'develop', remote: true }, origin, [origin])
    ).toEqual({
      type: 'remote',
      branch: 'develop',
      remote: origin,
    });
  });

  it('returns local branches for unqualified string settings', () => {
    expect(projectDefaultBranchToBranch('main', origin, [origin])).toEqual({
      type: 'local',
      branch: 'main',
    });
  });
});
