import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommandExecutor } from '../../../main/services/gitPlatformOperations/types';
import {
  GitHubOperations,
  type GitHubServiceLike,
} from '../../../main/services/gitPlatformOperations/GitHubOperations';

function mockExecutor(overrides: Partial<CommandExecutor> = {}): CommandExecutor {
  return {
    cwd: '/fake/project',
    exec: vi.fn().mockRejectedValue(new Error('not implemented')),
    execGit: vi.fn().mockRejectedValue(new Error('not implemented')),
    execPlatformCli: vi.fn().mockRejectedValue(new Error('not implemented')),
    ...overrides,
  };
}

function mockGitHubService(overrides: Partial<GitHubServiceLike> = {}): GitHubServiceLike {
  return {
    getPullRequests: vi.fn().mockResolvedValue({ prs: [], totalCount: 0 }),
    getPullRequestDetails: vi.fn().mockResolvedValue(null),
    ensurePullRequestBranch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('GitHubOperations', () => {
  it('has platform set to github', () => {
    const executor = mockExecutor();
    const service = mockGitHubService();
    const ops = new GitHubOperations(executor, service);
    expect(ops.platform).toBe('github');
  });

  it('exposes the executor', () => {
    const executor = mockExecutor();
    const service = mockGitHubService();
    const ops = new GitHubOperations(executor, service);
    expect(ops.executor).toBe(executor);
  });

  // ---------------------------------------------------------------------------
  // getDefaultBranch
  // ---------------------------------------------------------------------------

  describe('getDefaultBranch', () => {
    it('returns branch from gh repo view on success', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: 'main\n',
          stderr: '',
        }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getDefaultBranch();
      expect(result).toBe('main');
      expect(executor.execPlatformCli).toHaveBeenCalledWith(
        'repo view --json defaultBranchRef -q .defaultBranchRef.name'
      );
    });

    it('falls back when gh returns non-zero exit code', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'error',
        }),
        exec: vi.fn().mockResolvedValue({ stdout: 'develop\n', stderr: '' }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getDefaultBranch();
      expect(result).toBe('develop');
    });

    it('falls back when gh returns empty stdout', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: '   \n',
          stderr: '',
        }),
        exec: vi.fn().mockResolvedValue({ stdout: '  main\n', stderr: '' }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getDefaultBranch();
      expect(result).toBe('main');
    });

    it('returns main as ultimate fallback', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'fail',
        }),
        exec: vi.fn().mockRejectedValue(new Error('fail')),
        execGit: vi.fn().mockRejectedValue(new Error('fail')),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getDefaultBranch();
      expect(result).toBe('main');
    });
  });

  // ---------------------------------------------------------------------------
  // getPrStatus
  // ---------------------------------------------------------------------------

  describe('getPrStatus', () => {
    const prJson = JSON.stringify({
      number: 42,
      url: 'https://github.com/org/repo/pull/42',
      state: 'OPEN',
      isDraft: false,
      mergeStateStatus: 'CLEAN',
      headRefName: 'feature/my-branch',
      baseRefName: 'main',
      title: 'My PR',
      author: { login: 'jdoe' },
      additions: 10,
      deletions: 5,
      changedFiles: 3,
      autoMergeRequest: null,
      updatedAt: '2024-01-01T00:00:00Z',
    });

    it('fetches PR status via gh pr view when prNumber provided', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: prJson,
          stderr: '',
        }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getPrStatus(42);
      expect(result).not.toBeNull();
      expect(result?.number).toBe(42);
      expect(result?.headRefName).toBe('feature/my-branch');
      // Should include the prNumber in the command
      const callArgs = (executor.execPlatformCli as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs).toContain('42');
      expect(callArgs).toContain('pr view');
    });

    it('falls back to branch search when prNumber not given', async () => {
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'feature/my-branch\n', stderr: '' }),
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: JSON.stringify([JSON.parse(prJson)]),
          stderr: '',
        }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getPrStatus();
      expect(result).not.toBeNull();
      expect(result?.number).toBe(42);
    });

    it('returns null when pr view returns non-zero exit', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'no pull requests found',
        }),
        execGit: vi.fn().mockResolvedValue({ stdout: 'feature/x\n', stderr: '' }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      // When pr view fails, falls back to branch-based search; that also uses execPlatformCli
      // mock returns exitCode 1 for all calls → both fail → null
      const result = await ops.getPrStatus(99);
      expect(result).toBeNull();
    });

    it('returns null when no current branch for fallback', async () => {
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getPrStatus();
      expect(result).toBeNull();
    });

    it('returns null when branch search finds no PR', async () => {
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'no-pr-branch\n', stderr: '' }),
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: '[]',
          stderr: '',
        }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getPrStatus();
      expect(result).toBeNull();
    });

    it('falls back to fork parent when branch search finds no PR', async () => {
      const forkRepoData = {
        owner: { login: 'myuser' },
        parent: { owner: { login: 'upstream-org' }, name: 'upstream-repo' },
      };
      const parentPrData = [
        {
          number: 99,
          url: 'https://github.com/upstream-org/upstream-repo/pull/99',
          state: 'OPEN',
          isDraft: false,
          mergeStateStatus: 'CLEAN',
          headRefName: 'my-feature',
          baseRefName: 'main',
          title: 'Fork PR',
          author: { login: 'myuser' },
          additions: 5,
          deletions: 2,
          changedFiles: 1,
          autoMergeRequest: null,
          updatedAt: '2024-06-01T00:00:00Z',
          headRepositoryOwner: { login: 'myuser' },
        },
      ];

      const execPlatformCli = vi.fn();
      // 1st call: findPrByBranch → pr list (empty)
      execPlatformCli.mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' });
      // 2nd call: detectForkParent → repo view --json owner,parent
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(forkRepoData),
        stderr: '',
      });
      // 3rd call: findPrInParentRepo → pr list --repo upstream
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(parentPrData),
        stderr: '',
      });

      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'my-feature\n', stderr: '' }),
        execPlatformCli,
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getPrStatus();
      expect(result).not.toBeNull();
      expect(result?.number).toBe(99);
      expect(result?.url).toBe('https://github.com/upstream-org/upstream-repo/pull/99');
      // Verify the parent repo was queried
      const prListCall = execPlatformCli.mock.calls[2][0];
      expect(prListCall).toContain('--repo');
      expect(prListCall).toContain('upstream-org/upstream-repo');
    });

    it('returns null when fork detected but no matching PR in parent', async () => {
      const forkRepoData = {
        owner: { login: 'myuser' },
        parent: { owner: { login: 'upstream-org' }, name: 'upstream-repo' },
      };

      const execPlatformCli = vi.fn();
      // 1st: findPrByBranch → empty
      execPlatformCli.mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' });
      // 2nd: detectForkParent
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(forkRepoData),
        stderr: '',
      });
      // 3rd: findPrInParentRepo → empty
      execPlatformCli.mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' });

      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'my-feature\n', stderr: '' }),
        execPlatformCli,
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getPrStatus();
      expect(result).toBeNull();
    });

    it('matches fork PR by headRepositoryOwner.login', async () => {
      const forkRepoData = {
        owner: { login: 'myuser' },
        parent: { owner: { login: 'upstream-org' }, name: 'upstream-repo' },
      };
      // Two PRs from different forks with the same branch name
      const parentPrData = [
        {
          number: 50,
          url: 'https://github.com/upstream-org/upstream-repo/pull/50',
          state: 'OPEN',
          isDraft: false,
          mergeStateStatus: 'BLOCKED',
          headRefName: 'fix-bug',
          baseRefName: 'main',
          title: 'Other user PR',
          author: { login: 'otheruser' },
          additions: 1,
          deletions: 0,
          changedFiles: 1,
          autoMergeRequest: null,
          updatedAt: '2024-06-01T00:00:00Z',
          headRepositoryOwner: { login: 'otheruser' },
        },
        {
          number: 51,
          url: 'https://github.com/upstream-org/upstream-repo/pull/51',
          state: 'OPEN',
          isDraft: false,
          mergeStateStatus: 'CLEAN',
          headRefName: 'fix-bug',
          baseRefName: 'main',
          title: 'My PR',
          author: { login: 'myuser' },
          additions: 3,
          deletions: 1,
          changedFiles: 2,
          autoMergeRequest: null,
          updatedAt: '2024-06-02T00:00:00Z',
          headRepositoryOwner: { login: 'myuser' },
        },
      ];

      const execPlatformCli = vi.fn();
      execPlatformCli.mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' });
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(forkRepoData),
        stderr: '',
      });
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(parentPrData),
        stderr: '',
      });

      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'fix-bug\n', stderr: '' }),
        execPlatformCli,
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getPrStatus();
      expect(result).not.toBeNull();
      expect(result?.number).toBe(51);
      expect(result?.title).toBe('My PR');
    });
  });

  // ---------------------------------------------------------------------------
  // listPullRequests
  // ---------------------------------------------------------------------------

  describe('listPullRequests', () => {
    it('delegates to GitHubService.getPullRequests', async () => {
      const samplePrs = [
        {
          number: 1,
          title: 'PR One',
          headRefName: 'feat/a',
          baseRefName: 'main',
          url: 'https://github.com/org/repo/pull/1',
          isDraft: false,
          state: 'OPEN' as const,
          updatedAt: '2024-01-01T00:00:00Z',
          author: { login: 'alice' },
        },
      ];
      const service = mockGitHubService({
        getPullRequests: vi.fn().mockResolvedValue({ prs: samplePrs, totalCount: 5 }),
      });
      const executor = mockExecutor();
      const ops = new GitHubOperations(executor, service);
      const result = await ops.listPullRequests({ limit: 10, searchQuery: 'test' });
      expect(result.prs).toHaveLength(1);
      expect(result.prs[0].number).toBe(1);
      expect(result.totalCount).toBe(5);
      expect(service.getPullRequests).toHaveBeenCalledWith('/fake/project', {
        limit: 10,
        searchQuery: 'test',
      });
    });

    it('returns empty list when GitHubService returns empty', async () => {
      const service = mockGitHubService({
        getPullRequests: vi.fn().mockResolvedValue({ prs: [], totalCount: 0 }),
      });
      const executor = mockExecutor();
      const ops = new GitHubOperations(executor, service);
      const result = await ops.listPullRequests({});
      expect(result.prs).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('passes undefined opts through when not provided', async () => {
      const service = mockGitHubService({
        getPullRequests: vi.fn().mockResolvedValue({ prs: [], totalCount: 0 }),
      });
      const executor = mockExecutor();
      const ops = new GitHubOperations(executor, service);
      await ops.listPullRequests({});
      expect(service.getPullRequests).toHaveBeenCalledWith('/fake/project', {
        limit: undefined,
        searchQuery: undefined,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getPrDetails
  // ---------------------------------------------------------------------------

  describe('getPrDetails', () => {
    it('delegates to GitHubService.getPullRequestDetails and maps fields', async () => {
      const service = mockGitHubService({
        getPullRequestDetails: vi.fn().mockResolvedValue({
          baseRefName: 'main',
          headRefName: 'feat/x',
          url: 'https://github.com/org/repo/pull/7',
          title: 'My PR',
          number: 7,
        }),
      });
      const executor = mockExecutor();
      const ops = new GitHubOperations(executor, service);
      const result = await ops.getPrDetails(7);
      expect(result).toEqual({
        baseRefName: 'main',
        headRefName: 'feat/x',
        url: 'https://github.com/org/repo/pull/7',
      });
      expect(service.getPullRequestDetails).toHaveBeenCalledWith('/fake/project', 7);
    });

    it('returns null when service returns null', async () => {
      const service = mockGitHubService({
        getPullRequestDetails: vi.fn().mockResolvedValue(null),
      });
      const executor = mockExecutor();
      const ops = new GitHubOperations(executor, service);
      const result = await ops.getPrDetails(99);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getSourceBranch
  // ---------------------------------------------------------------------------

  describe('getSourceBranch', () => {
    it('returns null (GitHub uses PR number for worktree checkout)', async () => {
      const executor = mockExecutor();
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getSourceBranch(42);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // ensurePrBranch
  // ---------------------------------------------------------------------------

  describe('ensurePrBranch', () => {
    it('delegates to GitHubService.ensurePullRequestBranch', async () => {
      const service = mockGitHubService({
        ensurePullRequestBranch: vi.fn().mockResolvedValue(undefined),
      });
      const executor = mockExecutor();
      const ops = new GitHubOperations(executor, service);
      await ops.ensurePrBranch(5, 'pr/5');
      expect(service.ensurePullRequestBranch).toHaveBeenCalledWith('/fake/project', 5, 'pr/5');
    });
  });

  // ---------------------------------------------------------------------------
  // getCheckRuns
  // ---------------------------------------------------------------------------

  describe('getCheckRuns', () => {
    const sampleChecks = [
      {
        name: 'CI / test',
        state: 'SUCCESS',
        bucket: 'pass',
        link: 'https://github.com/org/repo/actions/runs/1',
        description: 'All tests passed',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
        workflow: 'CI',
        event: 'push',
      },
    ];

    // Helper: mock response for detectForkParent that returns "not a fork"
    const notAForkResponse = {
      exitCode: 0,
      stdout: JSON.stringify({ owner: { login: 'org' } }),
      stderr: '',
    };

    it('returns checks from gh pr checks', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi
          .fn()
          // detectForkParent → not a fork
          .mockResolvedValueOnce(notAForkResponse)
          // pr checks
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: JSON.stringify(sampleChecks),
            stderr: '',
          })
          // SHA fetch
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'abc123\n',
            stderr: '',
          })
          // API check-runs fetch
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: '',
            stderr: '',
          }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getCheckRuns();
      expect(result.success).toBe(true);
      expect(result.checks).not.toBeNull();
      expect(result.checks).toHaveLength(1);
      expect(result.checks![0].name).toBe('CI / test');
      expect(result.checks![0].state).toBe('SUCCESS');
      // Verify the pr checks command was called (2nd call, after fork detection)
      const checksCall = (executor.execPlatformCli as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(checksCall).toContain('pr checks');
      expect(checksCall).toContain('--json');
    });

    it('returns null checks when no pull requests found', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi
          .fn()
          // detectForkParent → not a fork
          .mockResolvedValueOnce(notAForkResponse)
          // pr checks → not found
          .mockResolvedValueOnce({
            exitCode: 1,
            stdout: '',
            stderr: 'no pull requests found',
          }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getCheckRuns();
      expect(result.success).toBe(true);
      expect(result.checks).toBeNull();
    });

    it('returns GH_CLI_UNAVAILABLE error when gh not installed', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi
          .fn()
          // detectForkParent → not a fork
          .mockResolvedValueOnce(notAForkResponse)
          // pr checks → gh not found
          .mockResolvedValueOnce({
            exitCode: 127,
            stdout: '',
            stderr: 'gh: command not found',
          }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getCheckRuns();
      expect(result.success).toBe(false);
      expect(result.code).toBe('GH_CLI_UNAVAILABLE');
    });

    it('enriches check links with html_url from API', async () => {
      const checksWithLink = [{ ...sampleChecks[0], link: 'old-link' }];
      const apiLine = JSON.stringify({ name: 'CI / test', html_url: 'https://real-check-url' });
      const executor = mockExecutor({
        execPlatformCli: vi
          .fn()
          // detectForkParent → not a fork
          .mockResolvedValueOnce(notAForkResponse)
          // pr checks
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: JSON.stringify(checksWithLink),
            stderr: '',
          })
          // SHA fetch
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'deadbeef\n',
            stderr: '',
          })
          // API check-runs
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: apiLine + '\n',
            stderr: '',
          }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getCheckRuns();
      expect(result.success).toBe(true);
      expect(result.checks![0].link).toBe('https://real-check-url');
    });

    it('keeps original link when SHA fetch fails', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi
          .fn()
          // detectForkParent → not a fork
          .mockResolvedValueOnce(notAForkResponse)
          // pr checks
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: JSON.stringify(sampleChecks),
            stderr: '',
          })
          // SHA fetch fails
          .mockResolvedValueOnce({
            exitCode: 1,
            stdout: '',
            stderr: 'error',
          }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getCheckRuns();
      expect(result.success).toBe(true);
      expect(result.checks![0].link).toBe('https://github.com/org/repo/actions/runs/1');
    });

    it('queries parent repo for check runs when on a fork', async () => {
      const forkRepoData = {
        owner: { login: 'myuser' },
        parent: { owner: { login: 'upstream-org' }, name: 'upstream-repo' },
      };
      const parentPrData = [
        {
          number: 99,
          url: 'https://github.com/upstream-org/upstream-repo/pull/99',
          state: 'OPEN',
          isDraft: false,
          mergeStateStatus: 'CLEAN',
          headRefName: 'my-feature',
          baseRefName: 'main',
          title: 'Fork PR',
          author: { login: 'myuser' },
          additions: 5,
          deletions: 2,
          changedFiles: 1,
          autoMergeRequest: null,
          updatedAt: '2024-06-01T00:00:00Z',
          headRepositoryOwner: { login: 'myuser' },
        },
      ];

      const execPlatformCli = vi.fn();
      // 1st: detectForkParent → fork detected
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(forkRepoData),
        stderr: '',
      });
      // 2nd: findPrInParentRepo → pr list in parent
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(parentPrData),
        stderr: '',
      });
      // 3rd: pr checks with --repo flag
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(sampleChecks),
        stderr: '',
      });
      // 4th: headRefOid with --repo flag
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'abc123\n',
        stderr: '',
      });
      // 5th: API check-runs
      execPlatformCli.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'my-feature\n', stderr: '' }),
        execPlatformCli,
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getCheckRuns();
      expect(result.success).toBe(true);
      expect(result.checks).toHaveLength(1);

      // Verify pr checks was called with --repo upstream-org/upstream-repo
      const checksCall = execPlatformCli.mock.calls[2][0];
      expect(checksCall).toContain('pr checks 99');
      expect(checksCall).toContain('upstream-org/upstream-repo');

      // Verify headRefOid was fetched from parent repo
      const shaCall = execPlatformCli.mock.calls[3][0];
      expect(shaCall).toContain('pr view 99');
      expect(shaCall).toContain('upstream-org/upstream-repo');

      // Verify API uses parent repo path
      const apiCall = execPlatformCli.mock.calls[4][0];
      expect(apiCall).toContain('repos/upstream-org/upstream-repo');
    });
  });

  // ---------------------------------------------------------------------------
  // getComments
  // ---------------------------------------------------------------------------

  describe('getComments', () => {
    const sampleComments = [{ body: 'Looks good!', author: { login: 'alice' } }];
    const sampleReviews = [{ body: 'LGTM', author: { login: 'bob' }, state: 'APPROVED' }];
    const prViewData = {
      number: 42,
      comments: sampleComments,
      reviews: sampleReviews,
    };

    it('returns comments and reviews from gh pr view', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi
          .fn()
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: JSON.stringify(prViewData),
            stderr: '',
          })
          // comments API
          .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
          // reviews API
          .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getComments(42);
      expect(result.success).toBe(true);
      expect(result.comments).toHaveLength(1);
      expect(result.reviews).toHaveLength(1);
      // The view command should include prNumber
      const firstCall = (executor.execPlatformCli as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(firstCall).toContain('42');
      expect(firstCall).toContain('pr view');
    });

    it('returns comments without prNumber (uses current PR)', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi
          .fn()
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: JSON.stringify(prViewData),
            stderr: '',
          })
          .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getComments();
      expect(result.success).toBe(true);
      // Verify command does not include a number (no prNumber passed)
      const firstCall = (executor.execPlatformCli as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // The command should be: "pr view --json comments,reviews,number" (no number arg)
      expect(firstCall).toMatch(/^pr view --json/);
    });

    it('returns null comments when no pull request found', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'no pull requests found',
        }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getComments();
      expect(result.success).toBe(true);
      expect(result.comments).toEqual([]);
    });

    it('returns GH_CLI_UNAVAILABLE when gh not installed', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 127,
          stdout: '',
          stderr: 'command not found: gh',
        }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getComments();
      expect(result.success).toBe(false);
      expect(result.code).toBe('GH_CLI_UNAVAILABLE');
    });

    it('enriches comments with avatar URLs from REST API', async () => {
      const avatarLine = JSON.stringify({
        login: 'alice',
        avatar_url: 'https://avatars.github.com/alice',
      });
      const executor = mockExecutor({
        execPlatformCli: vi
          .fn()
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: JSON.stringify(prViewData),
            stderr: '',
          })
          // comments API
          .mockResolvedValueOnce({ exitCode: 0, stdout: avatarLine + '\n', stderr: '' })
          // reviews API
          .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getComments(42);
      expect(result.success).toBe(true);
      const alice = result.comments.find((c: any) => c.author?.login === 'alice');
      expect(alice?.author?.avatarUrl).toBe('https://avatars.github.com/alice');
    });

    it('handles [bot] suffix in login matching for avatars', async () => {
      const botComment = { body: 'Bot comment', author: { login: 'myapp' } };
      const botViewData = {
        number: 10,
        comments: [botComment],
        reviews: [],
      };
      const avatarLine = JSON.stringify({
        login: 'myapp[bot]',
        avatar_url: 'https://avatars.github.com/myapp',
      });
      const executor = mockExecutor({
        execPlatformCli: vi
          .fn()
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: JSON.stringify(botViewData),
            stderr: '',
          })
          // comments API returns [bot] variant
          .mockResolvedValueOnce({ exitCode: 0, stdout: avatarLine + '\n', stderr: '' })
          // reviews API
          .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }),
      });
      const ops = new GitHubOperations(executor, mockGitHubService());
      const result = await ops.getComments(10);
      expect(result.success).toBe(true);
      const comment = result.comments[0];
      expect(comment?.author?.avatarUrl).toBe('https://avatars.github.com/myapp');
    });
  });
});
