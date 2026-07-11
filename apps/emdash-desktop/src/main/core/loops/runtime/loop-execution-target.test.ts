import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { getTaskEnvVars } from '@main/core/workspaces/workspace-env';
import { err, ok } from '@main/lib/result';
import {
  resolveLoopExecutionTarget,
  type LoopExecutionTargetDependencies,
} from './loop-execution-target';

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: { connect: vi.fn() },
}));

vi.mock('@main/core/workspaces/resolve-task-workspace-target', () => ({
  resolveTaskWorkspaceTarget: vi.fn(),
}));

function fakeContext(root: string, supportsLocalSpawn: boolean): IExecutionContext {
  return {
    root,
    supportsLocalSpawn,
    exec: vi.fn(),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  };
}

function dependencies(
  resolveTarget: LoopExecutionTargetDependencies['resolveTaskWorkspaceTarget']
): LoopExecutionTargetDependencies {
  return {
    resolveTaskWorkspaceTarget: resolveTarget,
    createLocalExecutionContext: vi.fn((root) => fakeContext(root, true)),
    createSshExecutionContext: vi.fn(async (_connectionId, root) => fakeContext(root, false)),
  };
}

const taskEnvironment = {
  taskName: 'Fix Login Flow',
  projectPath: '/projects/app',
  defaultBranch: 'develop',
};

describe('resolveLoopExecutionTarget', () => {
  it('retains a local canonical target and recomputes its trusted task environment', async () => {
    const target = {
      workspaceId: 'workspace-1',
      path: '/worktrees/task-1',
      machine: { kind: 'local' as const },
    };
    const deps = dependencies(vi.fn(async () => ok(target)));

    const result = await resolveLoopExecutionTarget('task-1', taskEnvironment, deps);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject(target);
    expect(deps.createLocalExecutionContext).toHaveBeenCalledWith(target.path);
    expect(result.data.executionContext.root).toBe(target.path);
    expect(result.data.taskEnv).toEqual(
      getTaskEnvVars({
        taskId: 'task-1',
        taskName: taskEnvironment.taskName,
        taskPath: target.path,
        projectPath: taskEnvironment.projectPath,
        defaultBranch: taskEnvironment.defaultBranch,
        portSeed: target.path,
      })
    );
    expect(Object.keys(result.data.taskEnv).every((key) => key.startsWith('EMDASH_'))).toBe(true);
  });

  it('retains the SSH connection and roots execution on the remote workspace', async () => {
    const target = {
      workspaceId: 'workspace-ssh',
      path: '/remote/worktrees/task-1',
      machine: { kind: 'ssh' as const, connectionId: 'connection-7' },
    };
    const deps = dependencies(vi.fn(async () => ok(target)));

    const result = await resolveLoopExecutionTarget('task-1', taskEnvironment, deps);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject(target);
    expect(deps.createSshExecutionContext).toHaveBeenCalledWith(
      target.machine.connectionId,
      target.path
    );
    expect(result.data.executionContext.root).toBe(target.path);
    result.data.dispose();
    expect(result.data.executionContext.dispose).toHaveBeenCalledOnce();
  });

  it('returns the canonical resolver failure without creating a local fallback', async () => {
    const failure = { kind: 'workspace-unavailable' as const, message: 'remote workspace missing' };
    const deps = dependencies(vi.fn(async () => err(failure)));

    const result = await resolveLoopExecutionTarget('task-1', taskEnvironment, deps);

    expect(result).toEqual(err(failure));
    expect(deps.createLocalExecutionContext).not.toHaveBeenCalled();
    expect(deps.createSshExecutionContext).not.toHaveBeenCalled();
  });
});
