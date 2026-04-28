import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Remote } from '@shared/git';
import { detectForkRelationship } from './fork-detection-service';

const mockGetOctokit = vi.fn();

vi.mock('./octokit-provider', () => ({
  getOctokit: () => mockGetOctokit(),
}));

const originRemote: Remote = { name: 'origin', url: 'https://github.com/myuser/repo.git' };
const upstreamRemote: Remote = { name: 'upstream', url: 'https://github.com/org/repo.git' };
const gitlabRemote: Remote = { name: 'origin', url: 'https://gitlab.com/myuser/repo.git' };

describe('detectForkRelationship', () => {
  beforeEach(() => {
    mockGetOctokit.mockReset();
  });

  it('detects a fork when origin is a fork and upstream matches parent', async () => {
    mockGetOctokit.mockResolvedValue({
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({
            data: {
              fork: true,
              parent: { html_url: 'https://github.com/org/repo', full_name: 'org/repo' },
            },
          }),
        },
      },
    });

    const result = await detectForkRelationship([originRemote, upstreamRemote]);
    expect(result).toEqual({
      forkRemoteName: 'origin',
      upstreamRemoteName: 'upstream',
      upstreamOwnerRepo: 'org/repo',
    });
  });

  it('returns null when the repo is not a fork', async () => {
    mockGetOctokit.mockResolvedValue({
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({
            data: { fork: false },
          }),
        },
      },
    });

    const result = await detectForkRelationship([originRemote, upstreamRemote]);
    expect(result).toBeNull();
  });

  it('returns null when fewer than 2 remotes', async () => {
    const result = await detectForkRelationship([originRemote]);
    expect(result).toBeNull();
    expect(mockGetOctokit).not.toHaveBeenCalled();
  });

  it('returns null when no GitHub remotes', async () => {
    const result = await detectForkRelationship([gitlabRemote]);
    expect(result).toBeNull();
  });

  it('returns null without API call when only one GitHub remote exists', async () => {
    const nonGithubRemote: Remote = { name: 'upstream', url: 'https://gitlab.com/org/repo.git' };
    const result = await detectForkRelationship([originRemote, nonGithubRemote]);
    expect(result).toBeNull();
    expect(mockGetOctokit).not.toHaveBeenCalled();
  });

  it('returns null when fork parent has no matching remote', async () => {
    mockGetOctokit.mockResolvedValue({
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({
            data: {
              fork: true,
              parent: {
                html_url: 'https://github.com/other-org/repo',
                full_name: 'other-org/repo',
              },
            },
          }),
        },
      },
    });

    const result = await detectForkRelationship([originRemote, upstreamRemote]);
    expect(result).toBeNull();
  });

  it('returns null on API error', async () => {
    mockGetOctokit.mockResolvedValue({
      rest: {
        repos: {
          get: vi.fn().mockRejectedValue(new Error('network error')),
        },
      },
    });

    const result = await detectForkRelationship([originRemote, upstreamRemote]);
    expect(result).toBeNull();
  });
});
