import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { lifecycleScriptStatusChannel } from '@shared/events/taskEvents';
import type { Pty, PtyExitInfo } from '../pty/pty';
import type { LifecycleScriptSpawnRequest, TerminalProvider } from '../terminals/terminal-provider';
import {
  LifecycleScriptService,
  type LifecycleScriptExecutionResult,
} from '../workspaces/workspace-lifecycle-service';
import {
  runLifecycleScriptWithPolicy,
  stopLifecycleScriptSession,
} from './lifecycle-script-coordinator';

const emit = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());

vi.mock('@main/lib/events', () => ({
  events: {
    emit,
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: logError,
  },
}));

vi.mock('@main/lib/file-logger', () => ({
  redactDiagnosticLog: (value: string) => `redacted:${value}`,
}));

class FakePty implements Pty {
  writes: string[] = [];
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  write(data: string): void {
    this.writes.push(data);
  }

  resize(): void {}

  kill(): void {
    this.emitExit({ signal: 'SIGTERM' });
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  emitExit(info: PtyExitInfo = { exitCode: 0 }): void {
    for (const handler of this.exitHandlers) {
      handler(info);
    }
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) {
      handler(data);
    }
  }
}

function makeTerminalProvider(): {
  provider: TerminalProvider;
  spawned: FakePty[];
  requests: LifecycleScriptSpawnRequest[];
} {
  const spawned: FakePty[] = [];
  const requests: LifecycleScriptSpawnRequest[] = [];
  const provider: TerminalProvider = {
    kind: 'local',
    async spawnTerminal() {},
    async spawnLifecycleScript(request) {
      const { terminal } = request;
      const pty = new FakePty();
      spawned.push(pty);
      requests.push(request);
      ptySessionRegistry.register(`${terminal.projectId}:${terminal.taskId}:${terminal.id}`, pty, {
        preserveBufferOnExit: true,
      });
    },
    async killTerminal() {},
    async destroyAll() {},
    async detachAll() {},
  };

  return { provider, spawned, requests };
}

function makeWorkspace(runLifecycleScript = vi.fn()) {
  return {
    lifecycleService: {
      runLifecycleScript,
    },
  } as never;
}

function baseArgs(runLifecycleScript = vi.fn()) {
  return {
    workspace: makeWorkspace(runLifecycleScript),
    projectId: 'project-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    type: 'run' as const,
    script: 'pnpm dev',
    origin: 'manual' as const,
    policy: {
      logFailure: true,
      surfaceFailure: true,
      continueOnFailure: false,
    },
    logPrefix: 'test',
  };
}

describe('runLifecycleScriptWithPolicy', () => {
  beforeEach(() => {
    emit.mockClear();
    logError.mockClear();
  });

  it('surfaces and rethrows nonzero manual script exits', async () => {
    const runLifecycleScript = vi.fn(async () => ({
      kind: 'exited' as const,
      exitCode: 2,
      outputTail: 'install failed',
    }));

    await expect(runLifecycleScriptWithPolicy(baseArgs(runLifecycleScript))).rejects.toThrow(
      'Run script exited with code 2.'
    );

    expect(runLifecycleScript).toHaveBeenCalledWith(
      { type: 'run', script: 'pnpm dev', shellSetup: undefined },
      { exit: true, waitForExit: true, respawnAfterExit: false }
    );
    expect(logError).toHaveBeenCalledWith(
      'test: run script failed',
      expect.objectContaining({
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        exitCode: 2,
        outputTail: 'redacted:install failed',
      })
    );
    expect(emit).toHaveBeenCalledWith(
      lifecycleScriptStatusChannel,
      expect.objectContaining({ status: 'running', type: 'run' })
    );
    expect(emit).toHaveBeenCalledWith(
      lifecycleScriptStatusChannel,
      expect.objectContaining({
        status: 'failed',
        message: 'Run script exited with code 2.',
        surfaceFailure: true,
        exitCode: 2,
      })
    );
  });

  it('treats exited scripts without exit details as successful PTY exits', async () => {
    const runLifecycleScript = vi.fn(async () => ({
      kind: 'exited' as const,
      outputTail: '',
    }));

    await expect(runLifecycleScriptWithPolicy(baseArgs(runLifecycleScript))).resolves.toMatchObject(
      { kind: 'succeeded' }
    );

    expect(logError).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      lifecycleScriptStatusChannel,
      expect.objectContaining({
        status: 'succeeded',
        type: 'run',
        exitCode: undefined,
      })
    );
  });

  it('keeps teardown failures log-only and non-throwing when policy says to continue', async () => {
    const runLifecycleScript = vi.fn(async () => ({
      kind: 'exited' as const,
      exitCode: 1,
      outputTail: 'cleanup failed',
    }));

    const result = await runLifecycleScriptWithPolicy({
      ...baseArgs(runLifecycleScript),
      type: 'teardown',
      script: 'pnpm cleanup',
      origin: 'workspace-destroy',
      policy: {
        timeoutMs: 100,
        logFailure: true,
        surfaceFailure: false,
        continueOnFailure: true,
      },
    });

    expect(result).toMatchObject({
      kind: 'failed',
      message: 'Teardown script exited with code 1.',
    });
    expect(emit).toHaveBeenCalledWith(
      lifecycleScriptStatusChannel,
      expect.objectContaining({
        status: 'failed',
        type: 'teardown',
        surfaceFailure: false,
      })
    );
  });

  it('returns stopped instead of failed after an explicit lifecycle stop', async () => {
    let resolveResult: (result: LifecycleScriptExecutionResult) => void = () => {};
    const runLifecycleScript = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveResult = resolve as typeof resolveResult;
        })
    );
    const coordinatorPromise = runLifecycleScriptWithPolicy(baseArgs(runLifecycleScript));

    const sessionId = 'project-1:workspace-1:script-lifecycle-run';
    const pty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    ptySessionRegistry.register(sessionId, pty, { preserveBufferOnExit: true });

    expect(
      stopLifecycleScriptSession({
        projectId: 'project-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        type: 'run',
        origin: 'manual',
      })
    ).toBe(true);
    expect(
      stopLifecycleScriptSession({
        projectId: 'project-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        type: 'run',
        origin: 'manual',
      })
    ).toBe(false);

    resolveResult({ kind: 'exited', signal: 'SIGTERM', outputTail: '' });
    await expect(coordinatorPromise).resolves.toEqual({ kind: 'stopped' });

    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(
      emit.mock.calls.filter(
        ([channel, event]) =>
          channel === lifecycleScriptStatusChannel &&
          (event as { status?: string; type?: string }).status === 'stopped' &&
          (event as { status?: string; type?: string }).type === 'run'
      )
    ).toHaveLength(1);

    ptySessionRegistry.unregister(sessionId);
  });

  it('does not start a second coordinator run while a session is already active', async () => {
    let resolveResult: (result: LifecycleScriptExecutionResult) => void = () => {};
    const runLifecycleScript = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveResult = resolve as typeof resolveResult;
        })
    );

    const firstRun = runLifecycleScriptWithPolicy(baseArgs(runLifecycleScript));
    const secondRun = runLifecycleScriptWithPolicy(baseArgs(runLifecycleScript));

    await expect(secondRun).resolves.toEqual({ kind: 'already-running' });
    expect(runLifecycleScript).toHaveBeenCalledTimes(1);
    expect(
      emit.mock.calls.filter(
        ([channel, event]) =>
          channel === lifecycleScriptStatusChannel &&
          (event as { status?: string; type?: string }).status === 'running' &&
          (event as { status?: string; type?: string }).type === 'run'
      )
    ).toHaveLength(1);

    resolveResult({ kind: 'exited', exitCode: 0, outputTail: '' });
    await expect(firstRun).resolves.toMatchObject({ kind: 'succeeded' });
  });

  it('runs a manual respawn policy script again after the first PTY exits', async () => {
    const { provider, spawned } = makeTerminalProvider();
    const projectId = 'project-rerun';
    const workspaceId = 'workspace-rerun';
    const service = new LifecycleScriptService({
      projectId,
      workspaceId,
      terminals: provider,
    });
    const workspace = { lifecycleService: service } as never;
    const args = {
      workspace,
      projectId,
      taskId: 'task-rerun',
      workspaceId,
      type: 'run' as const,
      script: 'pnpm dev',
      origin: 'manual' as const,
      policy: {
        respawnAfterExit: true,
        logFailure: true,
        surfaceFailure: true,
        continueOnFailure: false,
      },
      logPrefix: 'test',
    };

    const firstRun = runLifecycleScriptWithPolicy(args);
    await expect.poll(() => spawned[0]?.writes).toEqual(['pnpm dev; exit\n']);
    spawned[0].emitExit({ exitCode: 0 });
    await expect(firstRun).resolves.toMatchObject({ kind: 'succeeded' });
    await expect.poll(() => spawned.length).toBe(2);

    const secondRun = runLifecycleScriptWithPolicy(args);
    await expect.poll(() => spawned[1]?.writes).toEqual(['pnpm dev; exit\n']);
    spawned[1].emitExit({ exitCode: 0 });
    await expect(secondRun).resolves.toMatchObject({ kind: 'succeeded' });
    await expect.poll(() => spawned.length).toBe(3);

    ptySessionRegistry.unregister('project-rerun:workspace-rerun:script-lifecycle-run');
  });

  it('does not record a stale stopped state when stopping an idle lifecycle prompt', async () => {
    const sessionId = 'project-idle:workspace-idle:script-lifecycle-run';
    const pty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    ptySessionRegistry.register(sessionId, pty, { preserveBufferOnExit: true });

    expect(
      stopLifecycleScriptSession({
        projectId: 'project-idle',
        taskId: 'task-idle',
        workspaceId: 'workspace-idle',
        type: 'run',
        origin: 'manual',
      })
    ).toBe(false);
    expect(pty.kill).not.toHaveBeenCalled();

    const runLifecycleScript = vi.fn(async () => ({
      kind: 'exited' as const,
      exitCode: 0,
      outputTail: '',
    }));
    await expect(
      runLifecycleScriptWithPolicy({
        ...baseArgs(runLifecycleScript),
        projectId: 'project-idle',
        taskId: 'task-idle',
        workspaceId: 'workspace-idle',
      })
    ).resolves.toMatchObject({ kind: 'succeeded' });

    ptySessionRegistry.unregister(sessionId);
  });
});
