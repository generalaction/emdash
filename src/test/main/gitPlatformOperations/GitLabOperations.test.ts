import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommandExecutor } from '../../../main/services/gitPlatformOperations/types';
import { GitLabOperations } from '../../../main/services/gitPlatformOperations/GitLabOperations';

function mockExecutor(overrides: Partial<CommandExecutor> = {}): CommandExecutor {
  return {
    cwd: '/fake/project',
    exec: vi.fn().mockRejectedValue(new Error('not implemented')),
    execGit: vi.fn().mockRejectedValue(new Error('not implemented')),
    execPlatformCli: vi.fn().mockRejectedValue(new Error('not implemented')),
    ...overrides,
  };
}

describe('GitLabOperations', () => {
  it('has platform set to gitlab', () => {
    const executor = mockExecutor();
    const ops = new GitLabOperations(executor);
    expect(ops.platform).toBe('gitlab');
  });

  it('exposes the executor', () => {
    const executor = mockExecutor();
    const ops = new GitLabOperations(executor);
    expect(ops.executor).toBe(executor);
  });

  describe('getDefaultBranch', () => {
    it('returns branch from glab api on success', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: 'main\n',
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getDefaultBranch();
      expect(result).toBe('main');
      expect(executor.execPlatformCli).toHaveBeenCalledWith(
        'api "projects/:id" -q .default_branch'
      );
    });

    it('falls back when glab api fails (non-zero exit)', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'error',
        }),
        exec: vi.fn().mockResolvedValue({ stdout: 'develop\n', stderr: '' }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getDefaultBranch();
      expect(result).toBe('develop');
    });

    it('falls back when glab api returns empty stdout', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: '   \n',
          stderr: '',
        }),
        exec: vi.fn().mockResolvedValue({ stdout: '  main\n', stderr: '' }),
      });
      const ops = new GitLabOperations(executor);
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
      const ops = new GitLabOperations(executor);
      const result = await ops.getDefaultBranch();
      expect(result).toBe('main');
    });
  });

  describe('getPrStatus', () => {
    const mrJson = JSON.stringify({
      iid: 42,
      web_url: 'https://gitlab.com/org/repo/-/merge_requests/42',
      state: 'opened',
      draft: false,
      source_branch: 'feature/my-branch',
      target_branch: 'main',
      title: 'My MR',
      author: { username: 'jdoe' },
      additions: 10,
      deletions: 5,
      changes_count: '3',
      updated_at: '2024-01-01T00:00:00Z',
      merge_status: 'can_be_merged',
      has_conflicts: false,
    });

    it('fetches MR by number when prNumber provided', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: mrJson,
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getPrStatus(42);
      expect(result).not.toBeNull();
      expect(result?.number).toBe(42);
      expect(result?.headRefName).toBe('feature/my-branch');
      expect(executor.execPlatformCli).toHaveBeenCalledWith('api "projects/:id/merge_requests/42"');
    });

    it('returns null when MR not found by number', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: '404 Not Found',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getPrStatus(999);
      expect(result).toBeNull();
    });

    it('falls back to branch search when prNumber not given', async () => {
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'feature/my-branch\n', stderr: '' }),
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: JSON.stringify([JSON.parse(mrJson)]),
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getPrStatus();
      expect(result).not.toBeNull();
      expect(result?.number).toBe(42);
    });

    it('returns null when no branch available', async () => {
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getPrStatus();
      expect(result).toBeNull();
    });

    it('returns null when branch search finds no MR', async () => {
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'no-mr-branch\n', stderr: '' }),
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: '[]',
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getPrStatus();
      expect(result).toBeNull();
    });
  });

  describe('getPrDetails', () => {
    it('returns mapped fields from MR data', async () => {
      const mrData = {
        iid: 7,
        target_branch: 'main',
        source_branch: 'feature/x',
        web_url: 'https://gitlab.com/org/repo/-/merge_requests/7',
      };
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: JSON.stringify(mrData),
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getPrDetails(7);
      expect(result).toEqual({
        baseRefName: 'main',
        headRefName: 'feature/x',
        url: 'https://gitlab.com/org/repo/-/merge_requests/7',
      });
      expect(executor.execPlatformCli).toHaveBeenCalledWith('api "projects/:id/merge_requests/7"');
    });

    it('returns null when API fails', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'error',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getPrDetails(7);
      expect(result).toBeNull();
    });
  });

  describe('getSourceBranch', () => {
    it('returns source_branch on success', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: JSON.stringify({ source_branch: 'my-feature' }),
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getSourceBranch(10);
      expect(result).toBe('my-feature');
    });

    it('returns null on API error', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'error',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getSourceBranch(10);
      expect(result).toBeNull();
    });

    it('returns null when JSON parse fails', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: 'not valid json',
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getSourceBranch(10);
      expect(result).toBeNull();
    });
  });

  describe('ensurePrBranch', () => {
    it('fetches and sets branch tracking', async () => {
      const mockExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
      const executor = mockExecutor({ exec: mockExec });
      const ops = new GitLabOperations(executor);
      await ops.ensurePrBranch(5, 'feature/my-branch');
      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(mockExec).toHaveBeenNthCalledWith(1, expect.stringContaining('git fetch origin'));
      expect(mockExec).toHaveBeenNthCalledWith(2, expect.stringContaining('git branch --force'));
    });

    it('safely quotes branch names with special characters', async () => {
      const mockExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
      const executor = mockExecutor({ exec: mockExec });
      const ops = new GitLabOperations(executor);
      await ops.ensurePrBranch(5, "branch'with'quotes");
      const call1 = (mockExec as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call1).toContain("'branch'\\''with'\\''quotes'");
    });
  });

  describe('getCheckRuns', () => {
    it('returns null checks when no current branch', async () => {
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getCheckRuns();
      expect(result).toEqual({ success: true, checks: null });
    });

    it('maps pipeline to check run on success', async () => {
      const pipeline = {
        id: 123,
        status: 'success',
        web_url: 'https://gitlab.com/org/repo/-/pipelines/123',
        started_at: '2024-01-01T00:00:00Z',
        finished_at: '2024-01-01T01:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
      };
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'main\n', stderr: '' }),
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: JSON.stringify([pipeline]),
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getCheckRuns();
      expect(result.success).toBe(true);
      expect(result.checks).not.toBeNull();
      expect(result.checks).toHaveLength(1);
      const check = result.checks![0];
      expect(check.name).toBe('Pipeline #123');
      expect(check.state).toBe('SUCCESS');
      expect(check.bucket).toBe('pass');
      expect(check.link).toBe('https://gitlab.com/org/repo/-/pipelines/123');
      expect(check.startedAt).toBe('2024-01-01T00:00:00Z');
      expect(check.completedAt).toBe('2024-01-01T01:00:00Z');
      expect(check.workflow).toBe('CI/CD Pipeline');
    });

    it('maps failed pipeline to fail bucket', async () => {
      const pipeline = {
        id: 456,
        status: 'failed',
        web_url: 'https://gitlab.com/org/repo/-/pipelines/456',
        started_at: null,
        finished_at: '2024-01-01T02:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
      };
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'feature/x\n', stderr: '' }),
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: JSON.stringify([pipeline]),
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getCheckRuns();
      expect(result.checks![0].state).toBe('FAILURE');
      expect(result.checks![0].bucket).toBe('fail');
    });

    it('maps running pipeline to pending bucket', async () => {
      const pipeline = {
        id: 789,
        status: 'running',
        web_url: 'https://gitlab.com/org/repo/-/pipelines/789',
        started_at: '2024-01-01T00:00:00Z',
        finished_at: null,
        created_at: '2024-01-01T00:00:00Z',
      };
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'feature/y\n', stderr: '' }),
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: JSON.stringify([pipeline]),
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getCheckRuns();
      expect(result.checks![0].state).toBe('IN_PROGRESS');
      expect(result.checks![0].bucket).toBe('pending');
    });

    it('returns null checks when pipeline list is empty', async () => {
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'main\n', stderr: '' }),
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: '[]',
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getCheckRuns();
      expect(result).toEqual({ success: true, checks: null });
    });

    it('uses created_at when started_at is missing', async () => {
      const pipeline = {
        id: 100,
        status: 'pending',
        web_url: 'https://gitlab.com/org/repo/-/pipelines/100',
        started_at: null,
        finished_at: null,
        created_at: '2024-02-01T00:00:00Z',
      };
      const executor = mockExecutor({
        execGit: vi.fn().mockResolvedValue({ stdout: 'main\n', stderr: '' }),
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: JSON.stringify([pipeline]),
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.getCheckRuns();
      expect(result.checks![0].startedAt).toBe('2024-02-01T00:00:00Z');
      expect(result.checks![0].completedAt).toBeNull();
    });
  });

  describe('getComments', () => {
    it('returns empty comments array immediately', async () => {
      const executor = mockExecutor();
      const ops = new GitLabOperations(executor);
      const result = await ops.getComments(5);
      expect(result).toEqual({ success: true, comments: [] });
      expect(executor.execPlatformCli).not.toHaveBeenCalled();
    });

    it('returns empty comments without prNumber', async () => {
      const executor = mockExecutor();
      const ops = new GitLabOperations(executor);
      const result = await ops.getComments();
      expect(result).toEqual({ success: true, comments: [] });
    });
  });

  describe('listPullRequests', () => {
    const makeListResponse = (prs: object[]) => JSON.stringify(prs);

    const sampleMrs = [
      {
        iid: 1,
        title: 'First MR',
        source_branch: 'feat/a',
        target_branch: 'main',
        web_url: 'https://gitlab.com/org/repo/-/merge_requests/1',
        draft: false,
        state: 'opened',
        updated_at: '2024-01-01T00:00:00Z',
        author: { username: 'alice' },
        head_pipeline: null,
      },
    ];

    it('calls glab api with list params and parses response', async () => {
      const headers = 'x-total: 10\nx-next-page: 2\nx-per-page: 30';
      const body = makeListResponse(sampleMrs);
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: `${headers}\n\n${body}`,
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.listPullRequests({ limit: 30 });
      expect(result.prs).toHaveLength(1);
      expect(result.prs[0].number).toBe(1);
      expect(result.totalCount).toBe(10);
      const callArgs = (executor.execPlatformCli as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs).toContain('api "projects/:id/merge_requests');
      expect(callArgs).toContain('--include');
    });

    it('returns 0 totalCount when x-total header is missing', async () => {
      const body = makeListResponse(sampleMrs);
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: `\n\n${body}`,
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.listPullRequests({});
      expect(result.totalCount).toBe(0);
    });

    it('returns empty prs on failure', async () => {
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'error',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.listPullRequests({});
      expect(result.prs).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('handles response with no double-newline separator', async () => {
      const body = makeListResponse(sampleMrs);
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: body,
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.listPullRequests({});
      expect(result.prs).toHaveLength(1);
    });

    it('parses CRLF-separated headers from glab --include output', async () => {
      const body = makeListResponse(sampleMrs);
      const executor = mockExecutor({
        execPlatformCli: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout:
            'HTTP/2.0 200 OK\r\nx-total: 10\r\nx-next-page: 2\r\nx-per-page: 30\r\n\r\n' + body,
          stderr: '',
        }),
      });
      const ops = new GitLabOperations(executor);
      const result = await ops.listPullRequests({ limit: 30 });
      expect(result.prs).toHaveLength(1);
      expect(result.prs[0].number).toBe(1);
      expect(result.totalCount).toBe(10);
    });
  });
});
