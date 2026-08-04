import { ok } from '@emdash/shared';
import type { HandlerContext, StageContext } from '@primitives/kernel/api';
import { expandOperationStagePlan } from '@primitives/operations/api';
import { parseAbsolute } from '@primitives/path/api';
import type { BoundExec } from '@services/exec/api';
import { describe, expect, it, vi } from 'vitest';
import {
  removeWorktreeStagePlan,
  type RemoveWorktreeInput,
  type WorkspaceHostError,
} from '../../api';
import type { WorkspaceScriptRunOutcome } from '../session-init/script-runner';
import type { WorkspaceHostSessionClients } from '../session/session-cleanup';
import { createRemoveWorktreeHandler } from './remove-worktree';

describe('removeWorktreeStagePlan', () => {
  it('expands teardown between session cleanup and worktree removal', () => {
    expect(
      expandOperationStagePlan(removeWorktreeStagePlan, {
        workspacePath: '/repo/task',
        deleteBranch: false,
        teardownScript: 'pnpm teardown',
      }).map((stage) => stage.id)
    ).toEqual(['kill-sessions', 'teardown', 'remove-worktree:%2Frepo%2Ftask']);
  });

  it('omits teardown when the workspace has no teardown script', () => {
    expect(
      expandOperationStagePlan(removeWorktreeStagePlan, {
        workspacePath: '/repo/task',
        deleteBranch: false,
      }).map((stage) => stage.id)
    ).toEqual(['kill-sessions', 'remove-worktree:%2Frepo%2Ftask']);
  });
});

describe('createRemoveWorktreeHandler teardown', () => {
  it.each([
    {
      outcome: { status: 'succeeded', outputTail: '' } as WorkspaceScriptRunOutcome,
      failedStage: false,
    },
    {
      outcome: {
        status: 'failed',
        message: 'teardown failed',
        outputTail: 'boom',
      } as WorkspaceScriptRunOutcome,
      failedStage: true,
    },
    {
      outcome: {
        status: 'timed-out',
        message: 'teardown timed out',
        outputTail: '',
      } as WorkspaceScriptRunOutcome,
      failedStage: true,
    },
  ])(
    'continues removing the worktree after teardown status $outcome.status',
    async ({ outcome, failedStage }) => {
      const initManager = {
        getConfiguredScript: vi.fn(async () => 'pnpm teardown'),
        shutdown: vi.fn(async () => {}),
        shutdownAndRunCapturedScript: vi.fn(async () => outcome),
        reportFailure: vi.fn(),
      };
      const exec = fakeGitExec();
      const handler = createRemoveWorktreeHandler({
        sessions: emptySessionClients(),
        createGitExec: () => exec,
        initManager,
      });
      const stages: { id: string; failed: boolean }[] = [];

      const result = await handler.run(
        fakeContext(
          {
            version: '1',
            operationId: 'operation-1',
            hostId: 'local',
            repoPath: absolute('/repo'),
            worktreePath: absolute('/repo/task'),
          },
          stages
        )
      );

      expect(result).toEqual({ operationId: 'operation-1', changed: true });
      expect(stages).toEqual([
        { id: 'kill-sessions', failed: false },
        { id: 'teardown', failed: failedStage },
        { id: 'remove-worktree:%2Frepo%2Ftask', failed: false },
      ]);
      expect(exec.exec).toHaveBeenCalledWith(
        ['worktree', 'remove', '--force', '/repo/task'],
        expect.any(Object)
      );
    }
  );

  it('does not clean sessions or run teardown for an unregistered target', async () => {
    const initManager = {
      getConfiguredScript: vi.fn(async () => 'pnpm teardown'),
      shutdown: vi.fn(async () => {}),
      shutdownAndRunCapturedScript: vi.fn(
        async () => ({ status: 'succeeded', outputTail: '' }) as const
      ),
      reportFailure: vi.fn(),
    };
    const handler = createRemoveWorktreeHandler({
      sessions: emptySessionClients(),
      createGitExec: () => fakeGitExec(false),
      initManager,
    });
    const stages: { id: string; failed: boolean }[] = [];

    await expect(
      handler.run(
        fakeContext(
          {
            version: '1',
            operationId: 'operation-1',
            hostId: 'local',
            repoPath: absolute('/repo'),
            worktreePath: absolute('/repo/task'),
          },
          stages
        )
      )
    ).resolves.toEqual({ operationId: 'operation-1', changed: false });
    expect(stages).toEqual([]);
    expect(initManager.getConfiguredScript).not.toHaveBeenCalled();
  });

  it('records an unreadable teardown config as non-fatal and still removes the worktree', async () => {
    const configError = new Error('permission denied');
    const initManager = {
      getConfiguredScript: vi.fn(async () => {
        throw configError;
      }),
      shutdown: vi.fn(async () => {}),
      shutdownAndRunCapturedScript: vi.fn(),
      reportFailure: vi.fn(),
    };
    const handler = createRemoveWorktreeHandler({
      sessions: emptySessionClients(),
      createGitExec: () => fakeGitExec(),
      initManager,
    });
    const stages: { id: string; failed: boolean }[] = [];

    await expect(
      handler.run(
        fakeContext(
          {
            version: '1',
            operationId: 'operation-1',
            hostId: 'local',
            repoPath: absolute('/repo'),
            worktreePath: absolute('/repo/task'),
          },
          stages
        )
      )
    ).resolves.toEqual({ operationId: 'operation-1', changed: true });
    expect(stages).toEqual([
      { id: 'teardown-config', failed: true },
      { id: 'kill-sessions', failed: false },
      { id: 'remove-worktree:%2Frepo%2Ftask', failed: false },
    ]);
    expect(initManager.reportFailure).toHaveBeenCalledWith('/repo/task', 'teardown', configError);
  });
});

function fakeContext(
  input: RemoveWorktreeInput,
  stages: { id: string; failed: boolean }[]
): HandlerContext<RemoveWorktreeInput, WorkspaceHostError> {
  const signal = new AbortController().signal;
  return {
    input,
    operationId: 'kernel-operation-1',
    attempt: 1,
    signal,
    stage: async <T>(
      id: string,
      _label: string,
      work: (stage: StageContext) => Promise<T>
    ): Promise<T> => {
      const entry = { id, failed: false };
      stages.push(entry);
      return await work({
        signal,
        progress: vi.fn(),
        fail: () => {
          entry.failed = true;
        },
      });
    },
    run: vi.fn(),
    spawn: vi.fn(),
    reject: (error: WorkspaceHostError) => {
      throw new Error(error.message);
    },
    fact: vi.fn(),
  } as unknown as HandlerContext<RemoveWorktreeInput, WorkspaceHostError>;
}

function fakeGitExec(includeTarget = true): BoundExec {
  const exec = vi.fn(async (args: string[]) => {
    if (args.join(' ') === 'worktree list --porcelain') {
      return {
        stdout: includeTarget
          ? 'worktree /repo\nHEAD abc\n\nworktree /repo/task\nHEAD def\n\n'
          : 'worktree /repo\nHEAD abc\n\n',
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  });
  return {
    file: 'git',
    cwd: '/repo',
    exec,
    execStreaming: vi.fn(),
    execBuffer: vi.fn(),
    spawn: vi.fn(),
    withCwd: vi.fn(),
  };
}

function emptySessionClients(): WorkspaceHostSessionClients {
  const sessions = {
    state: () => ({ snapshot: async () => ({ data: {} }) }),
  };
  return {
    acp: { sessions, killSession: vi.fn(async () => ok(undefined)) },
    terminals: { sessions, kill: vi.fn(async () => ok(undefined)) },
    tuiAgents: { sessions, deleteSession: vi.fn(async () => ok(undefined)) },
  } as unknown as WorkspaceHostSessionClients;
}

function absolute(value: string) {
  const parsed = parseAbsolute(value);
  if (!parsed.success) throw new Error(`Invalid test path: ${value}`);
  return parsed.data;
}
