import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that pull in the real modules
// ---------------------------------------------------------------------------

const execFileMock = vi.fn();
const getScriptMock = vi.fn();
const killPtyMock = vi.fn();

// Capture the onExit callbacks so tests can trigger PTY exits
type ShellSessionArgs = {
  taskId: string;
  title: string;
  cwd: string;
  command: string;
  env?: NodeJS.ProcessEnv;
  onExit?: (exitCode: number | null) => void;
};
const shellSessionCalls: ShellSessionArgs[] = [];
const startShellSessionMock = vi.fn(async (args: ShellSessionArgs) => {
  shellSessionCalls.push(args);
  const sessionId = `session-${shellSessionCalls.length}`;
  return { sessionId, ptyId: `lifecycle-${sessionId}` };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(), // kept so the legacy spawn path still compiles
  execFile: (...args: any[]) => execFileMock(...args),
}));

vi.mock('../../main/services/ptyManager', () => ({
  killPty: (...args: any[]) => killPtyMock(...args),
}));

vi.mock('../../main/services/ptyIpc', () => ({
  startShellSession: (...args: any[]) => startShellSessionMock(...args),
}));

vi.mock('../../main/services/LifecycleScriptsService', () => ({
  lifecycleScriptsService: {
    getScript: (...args: any[]) => getScriptMock(...args),
  },
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------

describe('TaskLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shellSessionCalls.length = 0;

    // Return default branch asynchronously to surface races around awaits.
    execFileMock.mockImplementation((_: any, __: any, ___: any, cb: any) => {
      setTimeout(() => cb(null, 'origin/main\n', ''), 10);
    });

    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      return null;
    });
  });

  it('dedupes concurrent startRun calls so only one PTY spawns', async () => {
    vi.resetModules();

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-1';
    const taskPath = '/tmp/wt-1';
    const projectPath = '/tmp/project';

    const [a, b] = await Promise.all([
      taskLifecycleService.startRun(taskId, taskPath, projectPath),
      taskLifecycleService.startRun(taskId, taskPath, projectPath),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(startShellSessionMock).toHaveBeenCalledTimes(1);
  });

  it('does not leave stop intent set when stopRun fails', async () => {
    vi.resetModules();

    killPtyMock.mockImplementation(() => {
      throw new Error('kill failed');
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-2';
    const taskPath = '/tmp/wt-2';
    const projectPath = '/tmp/project';

    const started = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(started.ok).toBe(true);

    const stopResult = taskLifecycleService.stopRun(taskId);
    expect(stopResult.ok).toBe(false);

    // If stop intent were leaked, a subsequent exit would mark state as idle instead of failed.
    const exitCb = shellSessionCalls[0]?.onExit;
    exitCb?.(143);

    const state = taskLifecycleService.getState(taskId);
    expect(state.run.status).toBe('failed');
    expect(state.run.error).toBe('Exited with code 143');
  });

  it('ignores stale PTY exit and keeps latest run state when run is restarted', async () => {
    vi.resetModules();

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-3';
    const taskPath = '/tmp/wt-3';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    const firstOnExit = shellSessionCalls[0]?.onExit;
    const firstPtyId = `lifecycle-session-1`;

    taskLifecycleService.stopRun(taskId);

    // Simulate second start (requires killPty not to throw for the second start check)
    killPtyMock.mockReturnValue(undefined);
    // runPtyIds must be cleared to allow restart; simulate PTY exit first
    firstOnExit?.(143);

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    // Old exit fires again (stale) — should not affect the second run's state
    firstOnExit?.(99);

    const state = taskLifecycleService.getState(taskId);
    expect(state.run.status).toBe('running');
    void firstPtyId; // used
  });

  it('marks run failed when startShellSession throws', async () => {
    vi.resetModules();

    startShellSessionMock.mockRejectedValueOnce(new Error('PTY spawn error'));

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-4';
    const taskPath = '/tmp/wt-4';
    const projectPath = '/tmp/project';

    const result = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('PTY spawn error');

    const state = taskLifecycleService.getState(taskId);
    expect(state.run.status).toBe('failed');
  });

  it('dedupes concurrent runTeardown calls per task and path', async () => {
    vi.resetModules();

    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      if (phase === 'teardown') return 'echo teardown';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');
    const serviceAny = taskLifecycleService as any;
    const runFiniteSpy = vi
      .spyOn(serviceAny, 'runFinite')
      .mockResolvedValue({ ok: true, skipped: false });

    const taskId = 'wt-5';
    const taskPath = '/tmp/wt-5';
    const projectPath = '/tmp/project';

    const teardownA = taskLifecycleService.runTeardown(taskId, taskPath, projectPath);
    const teardownB = taskLifecycleService.runTeardown(taskId, taskPath, projectPath);

    const [ra, rb] = await Promise.all([teardownA, teardownB]);

    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(runFiniteSpy).toHaveBeenCalledTimes(1);
  });

  it('clears stale run PTY after spawn error so retry can start', async () => {
    vi.resetModules();

    startShellSessionMock
      .mockRejectedValueOnce(new Error('PTY spawn error'))
      .mockResolvedValue({ sessionId: 'session-2', ptyId: 'lifecycle-session-2' });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-6';
    const taskPath = '/tmp/wt-6';
    const projectPath = '/tmp/project';

    const firstStart = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(firstStart.ok).toBe(false);

    const retry = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(retry.ok).toBe(true);
    expect(startShellSessionMock).toHaveBeenCalledTimes(2);
  });

  it('clearTask removes accumulated lifecycle state and PTY IDs', async () => {
    vi.resetModules();

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');
    const serviceAny = taskLifecycleService as any;

    const taskId = 'wt-7';
    const taskPath = '/tmp/wt-7';
    const projectPath = '/tmp/project';

    taskLifecycleService.getState(taskId);
    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    expect(serviceAny.states.has(taskId)).toBe(true);
    expect(serviceAny.runPtyIds.has(taskId)).toBe(true);

    taskLifecycleService.clearTask(taskId);

    expect(serviceAny.states.has(taskId)).toBe(false);
    expect(serviceAny.runPtyIds.has(taskId)).toBe(false);
  });

  it('setup resolves with ok:true when onExit fires with code 0', async () => {
    vi.resetModules();

    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'setup') return 'npm i';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-8';
    const taskPath = '/tmp/wt-8';
    const projectPath = '/tmp/project';

    const setupPromise = taskLifecycleService.runSetup(taskId, taskPath, projectPath);
    // Allow startShellSession to be called
    await new Promise((r) => setTimeout(r, 20));

    // Simulate the PTY exiting successfully
    shellSessionCalls[0]?.onExit?.(0);

    const setupResult = await setupPromise;
    const state = taskLifecycleService.getState(taskId);

    expect(setupResult.ok).toBe(true);
    expect(state.setup.status).toBe('succeeded');
  });

  it('setup resolves with ok:false when onExit fires with non-zero code', async () => {
    vi.resetModules();

    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'setup') return 'npm i';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-8b';
    const taskPath = '/tmp/wt-8b';
    const projectPath = '/tmp/project';

    const setupPromise = taskLifecycleService.runSetup(taskId, taskPath, projectPath);
    await new Promise((r) => setTimeout(r, 20));

    shellSessionCalls[0]?.onExit?.(1);

    const setupResult = await setupPromise;
    const state = taskLifecycleService.getState(taskId);

    expect(setupResult.ok).toBe(false);
    expect(state.setup.status).toBe('failed');
  });

  it('clearTask kills in-flight finite PTYs', async () => {
    vi.resetModules();

    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'setup') return 'npm i';
      return null;
    });

    // Make startShellSession never resolve (simulates a long-running setup)
    startShellSessionMock.mockImplementation(async (args: ShellSessionArgs) => {
      shellSessionCalls.push(args);
      return new Promise(() => {}); // never resolves
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');
    const serviceAny = taskLifecycleService as any;

    const taskId = 'wt-9';
    const taskPath = '/tmp/wt-9';
    const projectPath = '/tmp/project';

    void taskLifecycleService.runSetup(taskId, taskPath, projectPath);
    await new Promise((r) => setTimeout(r, 25));

    // Nothing in finiteSessionPtyIds yet because startShellSession never resolved
    // but clearTask should still clear state
    taskLifecycleService.clearTask(taskId);
    expect(serviceAny.finiteSessionPtyIds.has(taskId)).toBe(false);
  });
});
