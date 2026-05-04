import type * as LinearSdk from '@linear/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { linearConnectionService } from './linear-connection-service';
import { linearIssueProvider } from './linear-issue-provider';

const mockRawRequest = vi.hoisted(() => vi.fn());

vi.mock('@linear/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof LinearSdk>();
  return {
    ...actual,
    LinearGraphQLClient: vi.fn().mockImplementation(function MockLinearGraphQLClient() {
      return { rawRequest: mockRawRequest };
    }),
  };
});

vi.mock('./linear-connection-service', () => ({
  linearConnectionService: {
    getClient: vi.fn(),
  },
}));

const mockGetClient = vi.mocked(linearConnectionService.getClient);

function makeLinearClient() {
  return { options: { apiUrl: 'https://api.linear.app/graphql' } };
}

describe('linearIssueProvider', () => {
  beforeEach(() => {
    mockRawRequest.mockReset();
  });

  it('maps branchName from listed Linear issues', async () => {
    mockRawRequest.mockResolvedValue({
      data: {
        issues: {
          nodes: [
            {
              id: 'issue-1',
              identifier: 'GEN-626',
              title: 'Linear issue branch name creation',
              description: 'Use the Linear branch format',
              url: 'https://linear.app/general-action/issue/GEN-626',
              branchName: 'jona/gen-626-linear-issue-branch-name-creation',
              state: { name: 'Backlog', type: 'unstarted', color: '#aaa' },
              team: { name: 'General', key: 'GEN' },
              project: { name: 'Refactor (v1)' },
              assignee: { displayName: 'Jona', name: 'jona' },
              updatedAt: '2026-04-17T12:00:00.000Z',
            },
          ],
        },
      },
    });
    mockGetClient.mockResolvedValue(makeLinearClient() as never);

    const result = await linearIssueProvider.listIssues({ limit: 10 });

    expect(mockRawRequest).toHaveBeenCalledWith(expect.stringContaining('branchName'), {
      limit: 10,
    });
    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({
          provider: 'linear',
          identifier: 'GEN-626',
          branchName: 'jona/gen-626-linear-issue-branch-name-creation',
        }),
      ],
    });
  });

  it('maps branchName from searched Linear issues', async () => {
    mockRawRequest.mockResolvedValue({
      data: {
        searchIssues: {
          nodes: [
            {
              id: 'issue-1',
              identifier: 'GEN-626',
              title: 'Linear issue branch name creation',
              description: 'Use the Linear branch format',
              url: 'https://linear.app/general-action/issue/GEN-626',
              branchName: 'jona/gen-626-linear-issue-branch-name-creation',
              state: { name: 'Backlog', type: 'unstarted', color: '#aaa' },
              team: { name: 'General', key: 'GEN' },
              project: { name: 'Refactor (v1)' },
              assignee: { displayName: 'Jona', name: 'jona' },
              updatedAt: '2026-04-17T12:00:00.000Z',
            },
          ],
        },
      },
    });
    mockGetClient.mockResolvedValue(makeLinearClient() as never);

    const result = await linearIssueProvider.searchIssues({
      searchTerm: 'GEN-626',
      limit: 5,
    });

    expect(mockRawRequest).toHaveBeenCalledWith(
      expect.stringContaining('branchName'),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({
          provider: 'linear',
          identifier: 'GEN-626',
          branchName: 'jona/gen-626-linear-issue-branch-name-creation',
        }),
      ],
    });
  });
});
