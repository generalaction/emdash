import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';

const execCalls: string[] = [];
let issueListStdout = '[]';
let issueSearchStdout = '[]';
let prListStdout = '[]';
let repoViewStdout = 'generalaction/emdash';
let prCountStdout = '0';

vi.mock('child_process', () => {
  const execImpl = (command: string, options?: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    execCalls.push(command);

    const respond = (stdout: string) => {
      setImmediate(() => {
        cb?.(null, stdout, '');
      });
    };

    if (command.startsWith('gh auth status')) {
      respond('github.com\n  ✓ Logged in to github.com account test (keyring)\n');
    } else if (command.startsWith('gh auth token')) {
      respond('gho_mocktoken\n');
    } else if (command.startsWith('gh api user')) {
      respond(
        JSON.stringify({
          id: 1,
          login: 'tester',
          name: 'Tester',
          email: '',
          avatar_url: '',
        })
      );
    } else if (command.startsWith('gh issue list')) {
      if (command.includes('--search')) {
        respond(issueSearchStdout);
      } else {
        respond(issueListStdout);
      }
    } else if (command.startsWith('gh pr list')) {
      respond(prListStdout);
    } else if (command.startsWith('gh repo view --json nameWithOwner')) {
      respond(repoViewStdout);
    } else if (command.startsWith('gh api search/issues')) {
      respond(prCountStdout);
    } else {
      respond('');
    }

    return { kill: vi.fn() };
  };

  // Avoid TS7022 by annotating via any-cast for the Symbol-based property
  (execImpl as any)[promisify.custom] = (command: string, options?: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execImpl(command, options, (err: any, stdout: string, stderr: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  };

  return {
    exec: execImpl,
  };
});

const setPasswordMock = vi.fn().mockResolvedValue(undefined);
const getPasswordMock = vi.fn().mockResolvedValue(null);
const deletePasswordMock = vi.fn().mockResolvedValue(undefined);

vi.mock('keytar', () => {
  const module = {
    setPassword: setPasswordMock,
    getPassword: getPasswordMock,
    deletePassword: deletePasswordMock,
  };
  return {
    ...module,
    default: module,
  };
});

// eslint-disable-next-line import/first
import { GitHubService } from '../../main/services/GitHubService';

describe('GitHubService.isAuthenticated', () => {
  beforeEach(() => {
    execCalls.length = 0;
    issueListStdout = '[]';
    issueSearchStdout = '[]';
    prListStdout = '[]';
    repoViewStdout = 'generalaction/emdash';
    prCountStdout = '0';
    setPasswordMock.mockClear();
    getPasswordMock.mockClear();
    getPasswordMock.mockResolvedValue(null);
  });

  it('returns false when no stored token exists, even if gh CLI is authenticated', async () => {
    const service = new GitHubService();

    const result = await service.isAuthenticated();

    expect(result).toBe(false);
    // Should NOT check gh CLI auth status — emdash uses its own token
    expect(execCalls.find((cmd) => cmd.startsWith('gh auth status'))).toBeUndefined();
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  it('sorts listed issues by updatedAt descending', async () => {
    getPasswordMock.mockResolvedValue('gho_test_token');
    issueListStdout = JSON.stringify([
      { number: 11, title: 'Older', updatedAt: '2026-03-01T10:00:00.000Z' },
      { number: 12, title: 'Newest', updatedAt: '2026-03-03T12:00:00.000Z' },
      { number: 13, title: 'No timestamp', updatedAt: null },
    ]);

    const service = new GitHubService();
    const issues = await service.listIssues('/tmp/repo', 50);

    expect(issues.map((issue) => issue.number)).toEqual([12, 11, 13]);
  });

  it('sorts searched issues by updatedAt descending', async () => {
    getPasswordMock.mockResolvedValue('gho_test_token');
    issueSearchStdout = JSON.stringify([
      { number: 101, title: 'Stale', updatedAt: '2026-03-02T08:00:00.000Z' },
      { number: 102, title: 'Fresh', updatedAt: '2026-03-04T08:00:00.000Z' },
      { number: 103, title: 'Bad date', updatedAt: 'invalid' },
    ]);

    const service = new GitHubService();
    const issues = await service.searchIssues('/tmp/repo', 'query', 20);

    expect(issues.map((issue) => issue.number)).toEqual([102, 101, 103]);
  });

  it('limits pull requests and returns the total open PR count', async () => {
    getPasswordMock.mockResolvedValue('gho_test_token');
    prListStdout = JSON.stringify([
      { number: 8, title: 'Older', updatedAt: '2026-03-01T10:00:00.000Z' },
      { number: 9, title: 'Newest', updatedAt: '2026-03-03T10:00:00.000Z' },
    ]);
    prCountStdout = '42';

    const service = new GitHubService();
    const result = await service.getPullRequests('/tmp/repo', { limit: 10 });

    expect(result.totalCount).toBe(42);
    expect(result.prs.map((pr) => pr.number)).toEqual([9, 8]);
    expect(
      execCalls.find((cmd) => cmd.startsWith('gh pr list --state open --limit 10'))
    ).toBeDefined();
    expect(execCalls.find((cmd) => cmd.startsWith('gh api search/issues'))).toBeDefined();
  });

  it('passes search queries through to gh pr list and the filtered count lookup', async () => {
    getPasswordMock.mockResolvedValue('gho_test_token');
    prListStdout = JSON.stringify([
      { number: 17, title: 'Needs review', updatedAt: '2026-03-04T10:00:00.000Z' },
    ]);
    prCountStdout = '3';

    const service = new GitHubService();
    const result = await service.getPullRequests('/tmp/repo', {
      limit: 25,
      searchQuery: 'review-requested:@me draft:false',
    });

    expect(result.totalCount).toBe(3);
    expect(result.prs.map((pr) => pr.number)).toEqual([17]);
    expect(
      execCalls.find((cmd) => cmd.includes("--search 'review-requested:@me draft:false'"))
    ).toBeDefined();
    expect(
      execCalls.find((cmd) =>
        cmd.includes('repo:generalaction/emdash is:pr is:open review-requested:@me draft:false')
      )
    ).toBeDefined();
  });
});
