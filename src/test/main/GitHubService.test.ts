import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';

const execCalls: string[] = [];

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
    setPasswordMock.mockClear();
    getPasswordMock.mockClear();
    getPasswordMock.mockResolvedValue(null);
  });

  it('treats GitHub CLI login as authenticated even without stored token', async () => {
    const service = new GitHubService();

    const result = await service.isAuthenticated();

    expect(result).toBe(true);
    expect(execCalls.find((cmd) => cmd.startsWith('gh auth status'))).toBeDefined();
    expect(execCalls.find((cmd) => cmd.startsWith('gh auth token'))).toBeUndefined();
    expect(setPasswordMock).not.toHaveBeenCalled();
  });
});
