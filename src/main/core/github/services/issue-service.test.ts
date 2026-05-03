import type { Octokit } from '@octokit/rest';
import { describe, expect, it, vi } from 'vitest';
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
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      const result = await issueService.listIssues(repository, 30);

      expect(listForRepo).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        state: 'open',
        per_page: 30,
        sort: 'updated',
        direction: 'desc',
      });
      expect(result).toEqual([expectedIssue]);
    });

    it('filters out pull requests', async () => {
      const pr = { ...restIssue, number: 2, pull_request: { url: 'https://...' } };
      const listForRepo = vi.fn().mockResolvedValue({ data: [restIssue, pr] });
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      const result = await issueService.listIssues(repository);

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
    });

    it('returns empty array on error', async () => {
      const listForRepo = vi.fn().mockRejectedValue(new Error('Network error'));
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      expect(await issueService.listIssues(repository)).toEqual([]);
    });

    it('clamps limit to 1-100', async () => {
      const listForRepo = vi.fn().mockResolvedValue({ data: [] });
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

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
      mockGetOctokit.mockResolvedValue(makeOctokit({ issuesAndPullRequests }));

      const result = await issueService.searchIssues(repository, 'bug fix', 15);

      expect(issuesAndPullRequests).toHaveBeenCalledWith({
        q: 'bug fix repo:owner/repo is:issue is:open',
        per_page: 15,
        sort: 'updated',
        order: 'desc',
      });
      expect(result).toEqual([expectedIssue]);
    });

    it('returns empty for blank search term', async () => {
      const issuesAndPullRequests = vi.fn();
      mockGetOctokit.mockResolvedValue(makeOctokit({ issuesAndPullRequests }));

      expect(await issueService.searchIssues(repository, '   ')).toEqual([]);
      expect(await issueService.searchIssues(repository, '')).toEqual([]);
      expect(issuesAndPullRequests).not.toHaveBeenCalled();
    });

    it('returns empty on error', async () => {
      const issuesAndPullRequests = vi.fn().mockRejectedValue(new Error('API error'));
      mockGetOctokit.mockResolvedValue(makeOctokit({ issuesAndPullRequests }));

      expect(await issueService.searchIssues(repository, 'query')).toEqual([]);
    });
  });

  describe('listIssuesForPolling', () => {
    it('forwards since and If-None-Match, returns etag from response headers', async () => {
      const listForRepo = vi.fn().mockResolvedValue({
        data: [restIssue],
        headers: { etag: 'W/"new-etag"' },
      });
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      const result = await issueService.listIssuesForPolling(repository, {
        limit: 50,
        since: '2024-05-01T12:00:00Z',
        etag: 'W/"old-etag"',
      });

      expect(listForRepo).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        state: 'open',
        per_page: 50,
        sort: 'updated',
        direction: 'desc',
        since: '2024-05-01T12:00:00Z',
        headers: { 'if-none-match': 'W/"old-etag"' },
      });
      expect(result.ok).toBe(true);
      expect(result.notModified).toBe(false);
      expect(result.etag).toBe('W/"new-etag"');
      expect(result.issues).toEqual([expectedIssue]);
    });

    it('omits since and headers when not provided', async () => {
      const listForRepo = vi.fn().mockResolvedValue({ data: [], headers: {} });
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      await issueService.listIssuesForPolling(repository, {});

      const call = listForRepo.mock.calls[0][0];
      expect(call).not.toHaveProperty('since');
      expect(call).not.toHaveProperty('headers');
    });

    it('returns notModified=true and preserves etag on 304', async () => {
      const err = Object.assign(new Error('Not Modified'), { status: 304 });
      const listForRepo = vi.fn().mockRejectedValue(err);
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      const result = await issueService.listIssuesForPolling(repository, {
        etag: 'W/"old-etag"',
      });

      expect(result).toEqual({ ok: true, issues: [], etag: 'W/"old-etag"', notModified: true });
    });

    it('returns ok=false on non-304 errors', async () => {
      const listForRepo = vi.fn().mockRejectedValue(new Error('Network down'));
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      const result = await issueService.listIssuesForPolling(repository, {
        etag: 'W/"old-etag"',
      });

      expect(result).toEqual({ ok: false, issues: [], notModified: false });
    });
  });

  describe('getIssue', () => {
    it('maps detail response to camelCase with body', async () => {
      const issuesGet = vi.fn().mockResolvedValue({ data: { ...restIssue, body: 'Issue body' } });
      mockGetOctokit.mockResolvedValue(makeOctokit({ issuesGet }));

      const result = await issueService.getIssue(repository, 42);

      expect(issuesGet).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
      });
      expect(result).toEqual({ ...expectedIssue, body: 'Issue body' });
    });

    it('returns null on error', async () => {
      const issuesGet = vi.fn().mockRejectedValue(new Error('Not found'));
      mockGetOctokit.mockResolvedValue(makeOctokit({ issuesGet }));

      expect(await issueService.getIssue(repository, 99)).toBeNull();
    });
  });
});
