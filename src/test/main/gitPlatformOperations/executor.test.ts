import { describe, it, expect, vi } from 'vitest';

const { mockExecAsync, mockExecFileAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
  mockExecFileAsync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: (...args: any[]) => undefined,
  execFile: (...args: any[]) => undefined,
}));
vi.mock('node:util', () => ({
  promisify: (fn: any) => {
    if (fn?.name === 'exec' || String(fn).includes('exec')) return mockExecAsync;
    return mockExecFileAsync;
  },
}));

import { createLocalExecutor } from '../../../main/services/gitPlatformOperations/executor';

describe('createLocalExecutor', () => {
  it('exposes cwd', () => {
    const executor = createLocalExecutor('/my/project', 'github');
    expect(executor.cwd).toBe('/my/project');
  });

  it('exec runs shell command with cwd', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });
    const executor = createLocalExecutor('/my/project', 'github');
    const result = await executor.exec('echo hello');
    expect(mockExecAsync).toHaveBeenCalledWith(
      'echo hello',
      expect.objectContaining({ cwd: '/my/project' })
    );
    expect(result.stdout).toBe('ok');
  });

  it('execPlatformCli prefixes with gh for github', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: '{}', stderr: '' });
    const executor = createLocalExecutor('/proj', 'github');
    const result = await executor.execPlatformCli('pr view --json title');
    expect(mockExecAsync).toHaveBeenCalledWith(
      'gh pr view --json title',
      expect.objectContaining({ cwd: '/proj' })
    );
    expect(result).toEqual({ exitCode: 0, stdout: '{}', stderr: '' });
  });

  it('execPlatformCli prefixes with glab for gitlab', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: '[]', stderr: '' });
    const executor = createLocalExecutor('/proj', 'gitlab');
    const result = await executor.execPlatformCli('api "projects/:id"');
    expect(mockExecAsync).toHaveBeenCalledWith(
      'glab api "projects/:id"',
      expect.objectContaining({ cwd: '/proj' })
    );
    expect(result).toEqual({ exitCode: 0, stdout: '[]', stderr: '' });
  });

  it('execPlatformCli returns exitCode 1 on error', async () => {
    const err = new Error('fail') as any;
    err.code = 1;
    err.stdout = '';
    err.stderr = 'not found';
    mockExecAsync.mockRejectedValueOnce(err);
    const executor = createLocalExecutor('/proj', 'github');
    const result = await executor.execPlatformCli('pr view');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('not found');
  });
});
