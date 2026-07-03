import { describe, expect, it, vi } from 'vitest';
import type { GitLabClient, GitLabCredentials } from '../../../integrations/impl/gitlab/types';
import { resolveGitLabProject } from './repo-resolver';

const credentials: GitLabCredentials = {
  instanceUrl: 'https://gitlab.example.com',
  apiToken: 'token',
};

function makeClient(project: unknown = { id: 123, name: 'repo' }): GitLabClient {
  return {
    Projects: {
      show: vi.fn().mockResolvedValue(project),
    },
  } as unknown as GitLabClient;
}

describe('resolveGitLabProject', () => {
  it('resolves a GitLab project from a repository remote', async () => {
    const client = makeClient({ id: 123, name: 'repo' });

    await expect(
      resolveGitLabProject(client, credentials, 'https://gitlab.example.com/group/repo.git')
    ).resolves.toEqual({
      success: true,
      data: {
        projectId: 123,
        projectName: 'repo',
      },
    });

    expect(client.Projects.show).toHaveBeenCalledWith('group/repo');
  });

  it('supports nested group slugs', async () => {
    const client = makeClient({ id: 456, name: 'repo' });

    await expect(
      resolveGitLabProject(client, credentials, 'git@gitlab.example.com:group/subgroup/repo.git')
    ).resolves.toEqual({
      success: true,
      data: {
        projectId: 456,
        projectName: 'repo',
      },
    });

    expect(client.Projects.show).toHaveBeenCalledWith('group/subgroup/repo');
  });

  it('requires a repository URL', async () => {
    await expect(resolveGitLabProject(makeClient(), credentials, undefined)).resolves.toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'Repository URL is required.',
      },
    });
  });

  it('requires a parseable repository URL', async () => {
    await expect(resolveGitLabProject(makeClient(), credentials, 'not-a-remote')).resolves.toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'Unable to parse repository URL.',
      },
    });
  });

  it('requires the remote host to match the configured instance', async () => {
    await expect(
      resolveGitLabProject(makeClient(), credentials, 'https://other.example.com/group/repo.git')
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'unsupported_host',
        message:
          'Git remote host "other.example.com" does not match configured GitLab instance "gitlab.example.com".',
      },
    });
  });
});
