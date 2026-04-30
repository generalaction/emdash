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

const mockIssueService = vi.mocked(issueService);

describe('githubIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes repository URLs before listing issues', async () => {
    mockIssueService.listIssues.mockResolvedValue([]);

    await githubIssueProvider.listIssues({
      nameWithOwner: 'https://github.com/owner/repo',
      limit: 7,
    });

    expect(mockIssueService.listIssues).toHaveBeenCalledWith('owner/repo', 7);
  });

  it('falls back to the resolved remote when nameWithOwner is not provided', async () => {
    mockIssueService.searchIssues.mockResolvedValue([]);

    await githubIssueProvider.searchIssues({
      remote: 'git@github.com:owner/repo.git',
      searchTerm: 'bug',
      limit: 3,
    });

    expect(mockIssueService.searchIssues).toHaveBeenCalledWith('owner/repo', 'bug', 3);
  });
});
