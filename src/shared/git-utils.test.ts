import { describe, expect, it } from 'vitest';
import type { Branch } from './git';
import { resolveBaseRefFromRemoteDefault, resolveDefaultBranch } from './git-utils';

const origin = { name: 'origin', url: 'git@github.com:example/repo.git' };
const fork = { name: 'fork', url: 'git@github.com:user/repo.git' };

const branches: Branch[] = [
  { type: 'local', branch: 'feature/current' },
  { type: 'local', branch: 'develop' },
  { type: 'remote', branch: 'main', remote: origin },
  { type: 'remote', branch: 'develop', remote: origin },
  { type: 'remote', branch: 'main', remote: fork },
];

describe('resolveDefaultBranch', () => {
  it('prefers a valid explicit project default over the remote default', () => {
    const preference: Branch = { type: 'local', branch: 'develop' };

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
    const preference: Branch = {
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
