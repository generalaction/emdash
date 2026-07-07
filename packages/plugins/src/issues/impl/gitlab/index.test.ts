import { noopLogger } from '@emdash/shared/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import * as gitLabClient from '../../../integrations/impl/gitlab/client';
import type { GitLabClient } from '../../../integrations/impl/gitlab/types';
import { provider } from './index';

vi.mock('../../../integrations/impl/gitlab/client', async (importOriginal) => {
  const actual = await importOriginal<typeof gitLabClient>();
  return {
    ...actual,
    createGitLabClient: vi.fn(),
  };
});

const mockCreateGitLabClient = vi.mocked(gitLabClient.createGitLabClient);

const issues = provider.behavior.issues;
if (!issues) {
  throw new Error('GitLab issues behavior is not registered.');
}

const host: ConnectedIntegrationHostContext = {
  log: noopLogger,
  credentials: {
    instanceUrl: 'https://gitlab.example.com',
    apiToken: 'token',
  },
};

function gitLabIssue(iid: number, title = `Issue ${iid}`) {
  return {
    iid,
    title,
    web_url: `https://gitlab.example.com/group/repo/-/issues/${iid}`,
    description: 'body',
    state: 'opened',
    assignee: { username: 'jona', name: 'Jona' },
    updated_at: '2026-05-30T12:00:00Z',
  };
}

function makeClient(
  opts: {
    project?: unknown;
    issues?: unknown[];
    projectError?: unknown;
    issuesError?: unknown;
  } = {}
): GitLabClient {
  const show = opts.projectError
    ? vi.fn().mockRejectedValue(opts.projectError)
    : vi.fn().mockResolvedValue(opts.project ?? { id: 123, name: 'repo' });
  const all = opts.issuesError
    ? vi.fn().mockRejectedValue(opts.issuesError)
    : vi.fn().mockResolvedValue(opts.issues ?? []);

  return {
    Projects: { show },
    Issues: { all },
  } as unknown as GitLabClient;
}

function httpError(status: number) {
  return Object.assign(new Error('request failed'), {
    response: { status },
  });
}

describe('gitlab issues plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists GitLab issues through the SDK', async () => {
    const client = makeClient({ issues: [gitLabIssue(12)] });
    mockCreateGitLabClient.mockReturnValue(client);

    const result = await issues.listIssues(host, {
      repositoryUrl: 'https://gitlab.example.com/group/repo.git',
      limit: 10,
    });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          identifier: '#12',
          title: 'Issue 12',
          project: 'repo',
        }),
      ],
    });
    expect(client.Projects.show).toHaveBeenCalledWith('group/repo');
    expect(client.Issues.all).toHaveBeenCalledWith({
      projectId: 123,
      state: 'opened',
      orderBy: 'updated_at',
      sort: 'desc',
      perPage: 10,
      maxPages: 1,
    });
  });

  it('searches GitLab issues through the SDK', async () => {
    const client = makeClient({ issues: [gitLabIssue(34, 'Search result')] });
    mockCreateGitLabClient.mockReturnValue(client);

    const result = await issues.searchIssues(host, {
      repositoryUrl: 'git@gitlab.example.com:group/subgroup/repo.git',
      searchTerm: 'search',
      limit: 5,
    });

    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: '#34', title: 'Search result' })],
    });
    expect(client.Projects.show).toHaveBeenCalledWith('group/subgroup/repo');
    expect(client.Issues.all).toHaveBeenCalledWith({
      projectId: 123,
      state: 'opened',
      search: 'search',
      in: 'title,description',
      orderBy: 'updated_at',
      sort: 'desc',
      perPage: 5,
      maxPages: 1,
    });
  });

  it('returns an empty list for empty search terms without creating a client', async () => {
    const result = await issues.searchIssues(host, {
      repositoryUrl: 'https://gitlab.example.com/group/repo',
      searchTerm: '   ',
      limit: 5,
    });

    expect(result).toEqual({ success: true, data: [] });
    expect(mockCreateGitLabClient).not.toHaveBeenCalled();
  });

  it('returns unsupported_host when repository host does not match the configured instance', async () => {
    const client = makeClient();
    mockCreateGitLabClient.mockReturnValue(client);

    const result = await issues.listIssues(host, {
      repositoryUrl: 'https://other.example.com/group/repo.git',
      limit: 10,
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'unsupported_host',
        message:
          'Git remote host "other.example.com" does not match configured GitLab instance "gitlab.example.com".',
      },
    });
    expect(client.Projects.show).not.toHaveBeenCalled();
    expect(client.Issues.all).not.toHaveBeenCalled();
  });

  it('maps project lookup errors through the generic integration error mapper', async () => {
    const client = makeClient({ projectError: httpError(404) });
    mockCreateGitLabClient.mockReturnValue(client);

    const result = await issues.listIssues(host, {
      repositoryUrl: 'https://gitlab.example.com/group/repo.git',
      limit: 10,
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'not_found_or_no_access',
        message: 'GitLab resource was not found or you do not have access.',
      },
    });
  });

  it('maps issue fetch errors through the generic integration error mapper', async () => {
    const client = makeClient({ issuesError: httpError(401) });
    mockCreateGitLabClient.mockReturnValue(client);

    const result = await issues.listIssues(host, {
      repositoryUrl: 'https://gitlab.example.com/group/repo.git',
      limit: 10,
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'auth_failed',
        message: 'GitLab authentication failed. Check your credentials.',
      },
    });
  });
});
