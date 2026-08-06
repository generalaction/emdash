import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { runLoopCommand, runLoopGitDiff } from './loop-command-runner';
import type { LoopExecutionTarget } from './loop-execution-target';

function makeTarget(exec: IExecutionContext['exec']): LoopExecutionTarget {
  const executionContext: IExecutionContext = {
    root: '/remote/worktree',
    supportsLocalSpawn: false,
    exec,
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    workspaceId: 'workspace-1',
    path: '/remote/worktree',
    machine: { kind: 'ssh', connectionId: 'connection-1' },
    executionContext,
    taskEnv: {
      EMDASH_TASK_ID: 'task-1',
      EMDASH_TASK_PATH: '/remote/worktree',
    },
    dispose: () => executionContext.dispose(),
  };
}

describe('runLoopCommand', () => {
  it('delegates exact argv and lets the trusted task environment win', async () => {
    const exec = vi.fn(async () => ({ stdout: 'ok', stderr: '' }));
    const target = makeTarget(exec);
    const controller = new AbortController();

    const result = await runLoopCommand(target, 'pnpm', ['test', '--', '--runInBand'], {
      env: {
        EMDASH_TASK_PATH: '/spoofed',
        NODE_ENV: 'test',
      },
      maxBuffer: 1234,
      signal: controller.signal,
      timeoutMs: 5678,
    });

    expect(exec).toHaveBeenCalledWith('pnpm', ['test', '--', '--runInBand'], {
      env: {
        EMDASH_TASK_ID: 'task-1',
        EMDASH_TASK_PATH: '/remote/worktree',
        NODE_ENV: 'test',
      },
      maxBuffer: 1234,
      signal: controller.signal,
      timeout: 5678,
    });
    expect(result).toMatchObject({
      args: ['test', '--', '--runInBand'],
      command: 'pnpm test -- --runInBand',
      cwd: '/remote/worktree',
      exitCode: 0,
      file: 'pnpm',
      stderr: '',
      stdout: 'ok',
    });
    expect(result.command).not.toContain('/spoofed');
  });

  it('keeps bounded evidence tails while retaining bounded complete output for parsing', async () => {
    const stdout = `prefix-${'x'.repeat(8_100)}`;
    const stderr = `prefix-${'y'.repeat(8_100)}`;
    const target = makeTarget(vi.fn(async () => ({ stdout, stderr })));

    const result = await runLoopCommand(target, 'tool', []);

    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe(stderr);
    expect(result.stdoutTail).toHaveLength(8_000);
    expect(result.stderrTail).toHaveLength(8_000);
    expect(result.stdoutTail).toBe(stdout.slice(-8_000));
  });

  it.each([
    [
      'non-zero exit',
      Object.assign(new Error('failed'), { exitCode: 23, stderr: 'bad', stdout: 'out' }),
      { aborted: false, exitCode: 23, timedOut: false },
    ],
    [
      'timeout',
      Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', name: 'TimeoutError' }),
      { aborted: false, exitCode: null, timedOut: true },
    ],
    [
      'abort',
      new DOMException('Aborted', 'AbortError'),
      { aborted: true, exitCode: null, timedOut: false },
    ],
  ])('normalizes %s failures', async (_label, failure, expected) => {
    const target = makeTarget(
      vi.fn(async () => {
        throw failure;
      })
    );

    await expect(runLoopCommand(target, 'tool', ['arg'])).rejects.toMatchObject({
      ...expected,
      args: ['arg'],
      command: 'tool arg',
      cwd: '/remote/worktree',
      file: 'tool',
    });
  });

  it('bounds execution error messages before they can enter Loop evidence', async () => {
    const target = makeTarget(
      vi.fn(async () => {
        throw new Error(`remote command failed: ${'x'.repeat(16_000)}`);
      })
    );

    await expect(runLoopCommand(target, 'tool', [])).rejects.toMatchObject({
      message: 'x'.repeat(8_000),
    });
  });
});

describe('runLoopGitDiff', () => {
  it('runs both diff commands through the target execution context', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: ' a.ts | 1 +', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'diff --git a/a.ts b/a.ts', stderr: '' });
    const target = makeTarget(exec);

    const diff = await runLoopGitDiff(target);

    expect(exec).toHaveBeenNthCalledWith(
      1,
      'git',
      ['diff', '--stat'],
      expect.objectContaining({ timeout: 60_000 })
    );
    expect(exec).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', '--no-ext-diff'],
      expect.objectContaining({ maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })
    );
    expect(diff).toBe(' a.ts | 1 +\n\ndiff --git a/a.ts b/a.ts');
  });
});
