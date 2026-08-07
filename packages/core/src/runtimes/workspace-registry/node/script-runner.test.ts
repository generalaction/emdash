import { describe, expect, it, vi } from 'vitest';
import { ExecError, type BoundExec } from '#services/exec/api';
import { createWorkspaceScriptRunner } from './script-runner';

function fakeExec(exec: BoundExec['exec']): BoundExec {
  return {
    file: '/bin/sh',
    cwd: '/workspace',
    exec,
    execStreaming: vi.fn(),
    execBuffer: vi.fn(),
    spawn: vi.fn(),
    withCwd: vi.fn(),
  };
}

describe('createWorkspaceScriptRunner', () => {
  it('runs commands through a login shell and captures output', async () => {
    const exec = vi.fn(async () => ({ stdout: 'ready\n', stderr: 'warning\n' }));
    const runner = createWorkspaceScriptRunner({
      shell: '/bin/zsh',
      createExec: (_shell, _cwd) => fakeExec(exec),
    });

    await expect(
      runner.run({ id: 'prepare', command: 'pnpm prepare', cwd: '/workspace' })
    ).resolves.toEqual({
      status: 'succeeded',
      outputTail: 'ready\nwarning\n',
    });
    expect(exec).toHaveBeenCalledWith(
      ['-lc', 'pnpm prepare'],
      expect.objectContaining({ timeoutMs: 300_000 })
    );
  });

  it('classifies command failure and keeps only the output tail', async () => {
    const exec = vi.fn(async () => {
      throw new ExecError('/bin/sh', ['-lc', 'false'], 7, '123456', 'stderr');
    });
    const runner = createWorkspaceScriptRunner({
      outputTailLength: 5,
      createExec: (_shell, _cwd) => fakeExec(exec),
    });

    await expect(
      runner.run({ id: 'prepare', command: 'false', cwd: '/workspace' })
    ).resolves.toEqual({
      status: 'failed',
      message: '/bin/sh -lc false failed (exit 7)',
      exitCode: 7,
      outputTail: 'tderr',
    });
  });

  it('classifies timeouts separately', async () => {
    const exec = vi.fn(async () => {
      throw new ExecError('/bin/sh', ['-lc', 'sleep 10'], null, '', 'Timed out after 25ms');
    });
    const runner = createWorkspaceScriptRunner({
      createExec: (_shell, _cwd) => fakeExec(exec),
    });

    await expect(
      runner.run({
        id: 'teardown',
        command: 'sleep 10',
        cwd: '/workspace',
        timeoutMs: 25,
      })
    ).resolves.toEqual({
      status: 'timed-out',
      message: 'Script "teardown" timed out after 25ms',
      outputTail: 'Timed out after 25ms',
    });
  });
});
