import { beforeEach, describe, expect, it, vi } from 'vitest';
import { githubIssueProvider } from './github-issue-provider';
import { issueService } from './services/issue-service';

vi.mock('./services/issue-service', () => ({
  issueService: {
    listIssues: vi.fn(),
    searchIssues: vi.fn(),
  },
}));

vi.mock('./services/github-connection-service', () => ({
  githubConnectionService: {
    getStatus: vi.fn(),
  },
}));

const mockListIssues = vi.mocked(issueService.listIssues);
const mockSearchIssues = vi.mocked(issueService.searchIssues);

beforeEach(() => {
  mockListIssues.mockReset();
  mockListIssues.mockResolvedValue([]);
  mockSearchIssues.mockReset();
  mockSearchIssues.mockResolvedValue([]);
});

describe('githubIssueProvider', () => {
  describe('listIssues', () => {
    it('normalises an HTTPS GitHub URL to owner/repo', async () => {
      const result = await githubIssueProvider.listIssues({
        nameWithOwner: 'https://github.com/owner/repo',
        limit: 25,
      });

      expect(mockListIssues).toHaveBeenCalledWith('owner/repo', 25);
      expect(result).toEqual({ success: true, issues: [] });
    });

    it('normalises an HTTPS URL with a .git suffix', async () => {
      await githubIssueProvider.listIssues({
        nameWithOwner: 'https://github.com/owner/repo.git',
        limit: 10,
      });

      expect(mockListIssues).toHaveBeenCalledWith('owner/repo', 10);
    });

    it('normalises an SSH GitHub URL to owner/repo', async () => {
      await githubIssueProvider.listIssues({
        nameWithOwner: 'git@github.com:owner/repo.git',
        limit: 10,
      });

      expect(mockListIssues).toHaveBeenCalledWith('owner/repo', 10);
    });

    it('passes a bare owner/repo through unchanged', async () => {
      await githubIssueProvider.listIssues({
        nameWithOwner: 'owner/repo',
        limit: 10,
      });

      expect(mockListIssues).toHaveBeenCalledWith('owner/repo', 10);
    });

    it('returns an error when nameWithOwner is missing', async () => {
      const result = await githubIssueProvider.listIssues({ limit: 10 });

      expect(mockListIssues).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Repository name is required.' });
    });

    it('returns an error when nameWithOwner is unrecognised', async () => {
      const result = await githubIssueProvider.listIssues({
        nameWithOwner: 'not-a-repo',
        limit: 10,
      });

      expect(mockListIssues).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Repository name is required.' });
    });

    it('uses the default limit of 50 when not provided', async () => {
      await githubIssueProvider.listIssues({
        nameWithOwner: 'https://github.com/owner/repo',
      });

      expect(mockListIssues).toHaveBeenCalledWith('owner/repo', 50);
    });
  });

  describe('searchIssues', () => {
    it('normalises an HTTPS GitHub URL to owner/repo', async () => {
      await githubIssueProvider.searchIssues({
        nameWithOwner: 'https://github.com/owner/repo',
        searchTerm: 'bug',
        limit: 5,
      });

      expect(mockSearchIssues).toHaveBeenCalledWith('owner/repo', 'bug', 5);
    });

    it('passes a bare owner/repo through unchanged', async () => {
      await githubIssueProvider.searchIssues({
        nameWithOwner: 'owner/repo',
        searchTerm: 'bug',
        limit: 5,
      });

      expect(mockSearchIssues).toHaveBeenCalledWith('owner/repo', 'bug', 5);
    });

    it('returns an empty success result for a blank search term without hitting the service', async () => {
      const result = await githubIssueProvider.searchIssues({
        nameWithOwner: 'owner/repo',
        searchTerm: '   ',
        limit: 5,
      });

      expect(mockSearchIssues).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, issues: [] });
    });

    it('returns an error when nameWithOwner is missing', async () => {
      const result = await githubIssueProvider.searchIssues({
        searchTerm: 'bug',
        limit: 5,
      });

      expect(mockSearchIssues).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Repository name is required.' });
    });

    it('uses the default limit of 20 when not provided', async () => {
      await githubIssueProvider.searchIssues({
        nameWithOwner: 'https://github.com/owner/repo',
        searchTerm: 'bug',
      });

      expect(mockSearchIssues).toHaveBeenCalledWith('owner/repo', 'bug', 20);
    });
  });
});
