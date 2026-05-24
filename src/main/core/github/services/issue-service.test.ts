import type { Octokit } from '@octokit/rest';
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { issueService } from './issue-service';
import { getOctokit } from './octokit-provider';

vi.mock('./octokit-provider', () => ({
  getOctokit: vi.fn(),
}));

const mockGetOctokit = vi.mocked(getOctokit);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOctokit(overrides: {
  listForRepo?: ReturnType<typeof vi.fn>;
  issuesAndPullRequests?: ReturnType<typeof vi.fn>;
  issuesGet?: ReturnType<typeof vi.fn>;
}): Octokit {
  return {
    rest: {
      issues: {
        listForRepo: overrides.listForRepo ?? vi.fn(),
        get: overrides.issuesGet ?? vi.fn(),
      },
      search: {
        issuesAndPullRequests: overrides.issuesAndPullRequests ?? vi.fn(),
      },
    },
  } as unknown as Octokit;
}

const restIssue = {
  number: 1,
  title: 'Test issue',
  html_url: 'https://github.com/owner/repo/issues/1',
  state: 'open',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  comments: 3,
  user: { login: 'alice', avatar_url: 'https://avatar.test/alice' },
  assignees: [{ login: 'bob', avatar_url: 'https://avatar.test/bob' }],
  labels: [{ name: 'bug', color: 'fc2929' }],
};

const expectedIssue = {
  number: 1,
  title: 'Test issue',
  url: 'https://github.com/owner/repo/issues/1',
  state: 'open',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  comments: 3,
  user: { login: 'alice', avatarUrl: 'https://avatar.test/alice' },
  assignees: [{ login: 'bob', avatarUrl: 'https://avatar.test/bob' }],
  labels: [{ name: 'bug', color: 'fc2929' }],
};

const repository = {
  host: 'github.com',
  owner: 'owner',
  repo: 'repo',
  nameWithOwner: 'owner/repo',
  repositoryUrl: 'https://github.com/owner/repo',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubIssueServiceImpl', () => {
  describe('listIssues', () => {
    it('maps REST response to camelCase', async () => {
      const listForRepo = vi.fn().mockResolvedValue({ data: [restIssue] });
      mockGetOctokit.mockResolvedValue(ok(makeOctokit({ listForRepo })));

      const result = await issueService.listIssues(repository, 30);

      expect(mockGetOctokit).toHaveBeenCalledWith('github.com');
      expect(listForRepo).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        state: 'open',
        per_page: 30,
        sort: 'updated',
        direction: 'desc',
      });
      expect(result).toEqual(ok([expectedIssue]));
    });

    it('filters out pull requests', async () => {
      const pr = { ...restIssue, number: 2, pull_request: { url: 'https://...' } };
      const listForRepo = vi.fn().mockResolvedValue({ data: [restIssue, pr] });
      mockGetOctokit.mockResolvedValue(ok(makeOctokit({ listForRepo })));

      const result = await issueService.listIssues(repository);

      expect(result).toEqual(ok([expectedIssue]));
    });

    it('propagates API errors', async () => {
      const listForRepo = vi.fn().mockRejectedValue(new Error('Network error'));
      mockGetOctokit.mockResolvedValue(ok(makeOctokit({ listForRepo })));

      await expect(issueService.listIssues(repository)).resolves.toEqual(
        err({ type: 'generic', message: 'Network error' })
      );
    });

    it('clamps limit to 1-100', async () => {
      const listForRepo = vi.fn().mockResolvedValue({ data: [] });
      mockGetOctokit.mockResolvedValue(ok(makeOctokit({ listForRepo })));

      await issueService.listIssues(repository, 0);
      expect(listForRepo).toHaveBeenCalledWith(expect.objectContaining({ per_page: 1 }));

      listForRepo.mockClear();
      await issueService.listIssues(repository, 999);
      expect(listForRepo).toHaveBeenCalledWith(expect.objectContaining({ per_page: 100 }));
    });
  });

  describe('searchIssues', () => {
    it('maps search results to camelCase', async () => {
      const issuesAndPullRequests = vi.fn().mockResolvedValue({ data: { items: [restIssue] } });
      mockGetOctokit.mockResolvedValue(ok(makeOctokit({ issuesAndPullRequests })));

      const result = await issueService.searchIssues(repository, 'bug fix', 15);

      expect(issuesAndPullRequests).toHaveBeenCalledWith({
        q: 'bug fix repo:owner/repo is:issue is:open',
        per_page: 15,
        sort: 'updated',
        order: 'desc',
      });
      expect(result).toEqual(ok([expectedIssue]));
    });

    it('returns empty for blank search term', async () => {
      const issuesAndPullRequests = vi.fn();
      mockGetOctokit.mockResolvedValue(ok(makeOctokit({ issuesAndPullRequests })));

      expect(await issueService.searchIssues(repository, '   ')).toEqual(ok([]));
      expect(await issueService.searchIssues(repository, '')).toEqual(ok([]));
      expect(issuesAndPullRequests).not.toHaveBeenCalled();
    });

    it('propagates search errors', async () => {
      const issuesAndPullRequests = vi.fn().mockRejectedValue(new Error('API error'));
      mockGetOctokit.mockResolvedValue(ok(makeOctokit({ issuesAndPullRequests })));

      await expect(issueService.searchIssues(repository, 'query')).resolves.toEqual(
        err({ type: 'generic', message: 'API error' })
      );
    });
  });

  describe('getIssue', () => {
    it('maps detail response to camelCase with body', async () => {
      const issuesGet = vi.fn().mockResolvedValue({ data: { ...restIssue, body: 'Issue body' } });
      mockGetOctokit.mockResolvedValue(ok(makeOctokit({ issuesGet })));

      const result = await issueService.getIssue(repository, 42);

      expect(issuesGet).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
      });
      expect(result).toEqual(ok({ ...expectedIssue, body: 'Issue body' }));
    });

    it('propagates detail errors', async () => {
      const issuesGet = vi.fn().mockRejectedValue(new Error('Not found'));
      mockGetOctokit.mockResolvedValue(ok(makeOctokit({ issuesGet })));

      await expect(issueService.getIssue(repository, 99)).resolves.toEqual(
        err({ type: 'generic', message: 'Not found' })
      );
    });
  });
});
