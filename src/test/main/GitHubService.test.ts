import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-emdash' },
}));

const execFileCalls: { file: string; args: string[] }[] = [];
let issueListStdout = '[]';
let issueSearchStdout = '[]';

vi.mock('child_process', () => {
  const execFileImpl = (file: string, args?: string[] | any, options?: any, callback?: any) => {
    // execFile can be called as (file, args, cb) or (file, args, options, cb)
    const actualArgs = Array.isArray(args) ? args : [];
    const cb =
      typeof callback === 'function'
        ? callback
        : typeof options === 'function'
          ? options
          : undefined;

    execFileCalls.push({ file, args: actualArgs });

    const respond = (stdout: string) => {
      setImmediate(() => {
        cb?.(null, stdout, '');
      });
    };

    const command = [file, ...actualArgs].join(' ');

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
    } else if (command.includes('issue') && command.includes('list')) {
      if (actualArgs.includes('--search')) {
        respond(issueSearchStdout);
      } else {
        respond(issueListStdout);
      }
    } else {
      respond('');
    }

    return { kill: vi.fn() };
  };

  // Avoid TS7022 by annotating via any-cast for the Symbol-based property
  (execFileImpl as any)[promisify.custom] = (file: string, args?: string[], options?: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFileImpl(file, args, options, (err: any, stdout: string, stderr: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  };

  return {
    execFile: execFileImpl,
    spawn: vi.fn().mockReturnValue({
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: any) => {
        if (event === 'close') setImmediate(() => cb(0));
      }),
    }),
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
    execFileCalls.length = 0;
    issueListStdout = '[]';
    issueSearchStdout = '[]';
    setPasswordMock.mockClear();
    getPasswordMock.mockClear();
    getPasswordMock.mockResolvedValue(null);
  });

  it('treats GitHub CLI login as authenticated even without stored token', async () => {
    const service = new GitHubService();

    const result = await service.isAuthenticated();

    expect(result).toBe(true);
    expect(
      execFileCalls.find(
        (c) => c.file === 'gh' && c.args.includes('auth') && c.args.includes('status')
      )
    ).toBeDefined();
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  it('sorts listed issues by updatedAt descending', async () => {
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
    issueSearchStdout = JSON.stringify([
      { number: 101, title: 'Stale', updatedAt: '2026-03-02T08:00:00.000Z' },
      { number: 102, title: 'Fresh', updatedAt: '2026-03-04T08:00:00.000Z' },
      { number: 103, title: 'Bad date', updatedAt: 'invalid' },
    ]);

    const service = new GitHubService();
    const issues = await service.searchIssues('/tmp/repo', 'query', 20);

    expect(issues.map((issue) => issue.number)).toEqual([102, 101, 103]);
  });
});
