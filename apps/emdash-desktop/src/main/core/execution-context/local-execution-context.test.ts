import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

const spawnMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

const { LocalExecutionContext } = await import('./local-execution-context');

class FakeChildProcess extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });

  kill = vi.fn();
}

describe('LocalExecutionContext', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('merges an explicit environment overlay through the external-tool environment', async () => {
    vi.stubEnv('APPIMAGE', '/tmp/emdash.AppImage');
    vi.stubEnv('APPDIR', '/tmp/.mount_emdash');
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, '', '');
    });
    const ctx = new LocalExecutionContext({ root: '/repo' });

    await ctx.exec('node', ['script.js'], {
      env: {
        EMDASH_TASK_ID: 'task-1',
        EMDASH_TASK_PATH: '/repo',
      },
      maxBuffer: 1234,
      timeout: 5678,
    });

    const options = execFileMock.mock.calls[0]?.[2];
    expect(options.cwd).toBe('/repo');
    expect(options.maxBuffer).toBe(1234);
    expect(options.timeout).toBe(5678);
    expect(options.env.EMDASH_TASK_ID).toBe('task-1');
    expect(options.env.EMDASH_TASK_PATH).toBe('/repo');
    expect(options.env).not.toHaveProperty('APPIMAGE');
    expect(options.env).not.toHaveProperty('APPDIR');
  });

  it('keeps non-interactive Git variables when merging an environment overlay', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, '', '');
    });
    const ctx = new LocalExecutionContext({ root: '/repo' });

    await ctx.exec('git', ['status'], { env: { EMDASH_TASK_ID: 'task-1' } });

    const env = execFileMock.mock.calls[0]?.[2]?.env;
    expect(env.EMDASH_TASK_ID).toBe('task-1');
    expect(env.GIT_ASKPASS).toBe('');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GCM_INTERACTIVE).toBe('never');
    expect(env.SSH_ASKPASS).toBe('');
  });

  it('resolves logical git command for buffered local execution', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, '', '');
    });
    const ctx = new LocalExecutionContext({ root: '/repo' });

    await ctx.exec('git', ['status']);

    expect(execFileMock).toHaveBeenCalledWith(
      GIT_EXECUTABLE,
      ['status'],
      expect.objectContaining({
        cwd: '/repo',
        env: expect.objectContaining({
          GIT_ASKPASS: '',
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          SSH_ASKPASS: '',
        }),
      }),
      expect.any(Function)
    );
  });

  it('explains when git is missing during buffered local execution', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(
        Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT', path: GIT_EXECUTABLE })
      );
    });
    const ctx = new LocalExecutionContext({ root: '/repo' });

    await expect(ctx.exec('git', ['status'])).rejects.toThrow(
      'Git is not installed or Emdash cannot find it'
    );
  });

  it('resolves logical git command for streaming local execution', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const ctx = new LocalExecutionContext({ root: '/repo' });

    const promise = ctx.execStreaming('git', ['status'], () => true);
    child.emit('close', 0);
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      GIT_EXECUTABLE,
      ['status'],
      expect.objectContaining({
        cwd: '/repo',
        env: expect.objectContaining({
          GIT_ASKPASS: '',
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          SSH_ASKPASS: '',
        }),
      })
    );
  });

  it('explains when git is missing during streaming local execution', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const ctx = new LocalExecutionContext({ root: '/repo' });

    const promise = ctx.execStreaming('git', ['status'], () => true);
    child.emit(
      'error',
      Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT', path: GIT_EXECUTABLE })
    );

    await expect(promise).rejects.toThrow('Git is not installed or Emdash cannot find it');
  });
});
