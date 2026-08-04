import type { HandlerContext, StageContext } from '@primitives/kernel/api';
import { parseAbsolute } from '@primitives/path/api';
import type { BoundExec } from '@services/exec/api';
import { describe, expect, it, vi } from 'vitest';
import type { CreateWorktreeInput, WorkspaceHostError } from '../../api';
import { createCreateWorktreeHandler } from './create-worktree';

describe('createCreateWorktreeHandler idempotency', () => {
  it('treats an existing worktree on the requested branch as a no-op', async () => {
    const exec = fakeExecFactory('feature/task');
    const handler = createCreateWorktreeHandler({
      sessions: {} as never,
      createGitExec: exec.factory,
    });

    await expect(handler.run(context())).resolves.toEqual({
      operationId: 'operation-1',
      changed: false,
    });
    expect(exec.repoExec).not.toHaveBeenCalledWith(
      expect.arrayContaining(['add']),
      expect.anything()
    );
  });

  it('rejects an existing worktree checked out on another branch', async () => {
    const exec = fakeExecFactory('feature/other');
    const handler = createCreateWorktreeHandler({
      sessions: {} as never,
      createGitExec: exec.factory,
    });

    await expect(handler.run(context())).rejects.toThrow(
      'is checked out on feature/other, not feature/task'
    );
  });
});

describe('createCreateWorktreeHandler push', () => {
  it('pushes the branch with upstream tracking when pushRemote is set', async () => {
    const exec = fakeExecFactory('feature/task', { worktreeExists: false });
    const handler = createCreateWorktreeHandler({
      sessions: {} as never,
      createGitExec: exec.factory,
    });

    await expect(handler.run(context({ pushRemote: 'origin' }))).resolves.toEqual({
      operationId: 'operation-1',
      changed: true,
    });
    expect(exec.repoExec).toHaveBeenCalledWith(
      ['push', '-u', 'origin', 'feature/task'],
      expect.anything()
    );
  });

  it('does not push when pushRemote is absent', async () => {
    const exec = fakeExecFactory('feature/task', { worktreeExists: false });
    const handler = createCreateWorktreeHandler({
      sessions: {} as never,
      createGitExec: exec.factory,
    });

    await handler.run(context());
    expect(exec.repoExec).not.toHaveBeenCalledWith(
      expect.arrayContaining(['push']),
      expect.anything()
    );
  });
});

function context(
  overrides: Partial<CreateWorktreeInput> = {}
): HandlerContext<CreateWorktreeInput, WorkspaceHostError> {
  const input: CreateWorktreeInput = {
    version: '1',
    operationId: 'operation-1',
    hostId: 'local:local',
    repoPath: absolute('/repo'),
    worktreePath: absolute('/worktrees/task'),
    branchName: 'feature/task',
    preservePatterns: [],
    ...overrides,
  };
  const signal = new AbortController().signal;
  return {
    input,
    operationId: 'kernel-1',
    attempt: 0,
    signal,
    stage: async <T>(_id: string, _label: string, work: (stage: StageContext) => Promise<T>) =>
      await work({
        signal,
        progress: vi.fn(),
        fail: vi.fn(),
      }),
    run: vi.fn(),
    spawn: vi.fn(),
    reject: (error: WorkspaceHostError) => {
      throw new Error(error.message);
    },
    fact: vi.fn(),
  } as never;
}

function fakeExecFactory(branch: string, options: { worktreeExists?: boolean } = {}) {
  let worktreeExists = options.worktreeExists ?? true;
  const repoExec = vi.fn(async (args: string[]) => {
    if (args[0] === 'worktree' && args[1] === 'add') {
      worktreeExists = true;
      return { stdout: '', stderr: '' };
    }
    if (args.join(' ') === 'worktree list --porcelain') {
      return {
        stdout:
          'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n' +
          (worktreeExists
            ? 'worktree /worktrees/task\nHEAD def\nbranch refs/heads/feature/task\n\n'
            : ''),
        stderr: '',
      };
    }
    if (args[0] === 'show-ref') {
      throw new Error('branch does not exist');
    }
    return { stdout: '', stderr: '' };
  });
  const worktreeExec = vi.fn(async (args: string[]) => {
    if (args.join(' ') === 'branch --show-current') return { stdout: `${branch}\n`, stderr: '' };
    return { stdout: '/repo/.git\n', stderr: '' };
  });
  const factory = (cwd: string): BoundExec => ({
    file: 'git',
    cwd,
    exec: cwd === '/repo' ? repoExec : worktreeExec,
    execStreaming: vi.fn(),
    execBuffer: vi.fn(),
    spawn: vi.fn(),
    withCwd: vi.fn(),
  });
  return { factory, repoExec };
}

function absolute(value: string) {
  const parsed = parseAbsolute(value);
  if (!parsed.success) throw new Error(`Invalid test path: ${value}`);
  return parsed.data;
}
