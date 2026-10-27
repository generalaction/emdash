import type { Logger } from '@emdash/shared/logger';
import { issueListIssues } from '@llamaduck/forgejo-ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import * as forgejoClient from '../../../integrations/impl/forgejo/client';
import type { ForgejoClient } from '../../../integrations/impl/forgejo/types';
import { provider } from './index';

vi.mock('@llamaduck/forgejo-ts', () => ({
  issueListIssues: vi.fn(),
}));

vi.mock('../../../integrations/impl/forgejo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof forgejoClient>();
  return {
    ...actual,
    createForgejoClient: vi.fn(),
  };
});

const mockIssueListIssues = vi.mocked(issueListIssues);
const mockCreateForgejoClient = vi.mocked(forgejoClient.createForgejoClient);

const issues = provider.behavior.issues;
if (!issues) {
  throw new Error('Forgejo issues behavior is not registered.');
}

function makeHost(
  credentials: ConnectedIntegrationHostContext['credentials'] = {
    instanceUrl: 'https://forgejo.example.com',
    apiToken: 'token',
  }
): ConnectedIntegrationHostContext {
  const log: Logger = {
    level: 'info',
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  };
  return {
    log,
    credentials,
  };
}

function forgejoIssue(number: number, title = `Issue ${number}`) {
  return {
    number,
    title,
    html_url: `https://forgejo.example.com/org/repo/issues/${number}`,
    body: 'body',
    state: 'open',
    assignee: { login: 'jona', full_name: 'Jona' },
    updated_at: '2026-05-30T12:00:00Z',
  };
}

function sdkError(status: number, message: string) {
  return Object.assign(new Error(message), {
    response: { status },
  });
}

describe('forgejo issues plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateForgejoClient.mockReturnValue({} as ForgejoClient);
  });

  it('lists Forgejo issues through the SDK', async () => {
    mockIssueListIssues.mockResolvedValueOnce({
      data: [forgejoIssue(12)],
    } as Awaited<ReturnType<typeof issueListIssues<true>>>);

    const result = await issues.listIssues(makeHost(), {
      repositoryUrl: 'https://forgejo.example.com/org/repo.git',
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
    expect(mockIssueListIssues).toHaveBeenCalledWith({
      client: expect.anything(),
      path: { owner: 'org', repo: 'repo' },
      query: {
        state: 'open',
        type: 'issues',
        sort: 'recentupdate',
        limit: 10,
      },
      throwOnError: true,
    });
  });

  it('searches Forgejo issues through the SDK', async () => {
    mockIssueListIssues.mockResolvedValueOnce({
      data: [forgejoIssue(34, 'Search result')],
    } as Awaited<ReturnType<typeof issueListIssues<true>>>);

    const result = await issues.searchIssues(makeHost(), {
      repositoryUrl: 'https://forgejo.example.com/org/repo',
      searchTerm: 'search',
      limit: 5,
    });

    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: '#34', title: 'Search result' })],
    });
    expect(mockIssueListIssues).toHaveBeenCalledWith({
      client: expect.anything(),
      path: { owner: 'org', repo: 'repo' },
      query: {
        state: 'open',
        type: 'issues',
        q: 'search',
        sort: 'recentupdate',
        limit: 5,
      },
      throwOnError: true,
    });
  });

  it('returns an empty list for empty search terms without creating a client', async () => {
    const result = await issues.searchIssues(makeHost(), {
      repositoryUrl: 'https://forgejo.example.com/org/repo',
      searchTerm: '   ',
      limit: 5,
    });

    expect(result).toEqual({ success: true, data: [] });
    expect(mockCreateForgejoClient).not.toHaveBeenCalled();
    expect(mockIssueListIssues).not.toHaveBeenCalled();
  });

  it('returns unsupported_host when repository host does not match the configured instance', async () => {
    const result = await issues.listIssues(makeHost(), {
      repositoryUrl: 'https://other.example.com/org/repo.git',
      limit: 10,
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'unsupported_host',
        message:
          'Git remote host "other.example.com" does not match configured Forgejo instance "forgejo.example.com".',
      },
    });
    expect(mockIssueListIssues).not.toHaveBeenCalled();
  });

  it('maps SDK errors through the generic integration error mapper', async () => {
    mockIssueListIssues.mockRejectedValueOnce(sdkError(401, 'unauthorized'));

    const result = await issues.listIssues(makeHost(), {
      repositoryUrl: 'https://forgejo.example.com/org/repo.git',
      limit: 10,
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'auth_failed',
        message: 'Forgejo authentication failed. Check your credentials.',
      },
    });
  });
});
