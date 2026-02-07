import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  exitCode: number | null;
  killed: boolean;
  kill: (signal?: NodeJS.Signals) => boolean;
};

const spawnMock = vi.fn();
const execFileMock = vi.fn();
const getScriptMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: any[]) => spawnMock(...args),
  execFile: (...args: any[]) => execFileMock(...args),
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

function createChild(pid: number, killImpl?: (signal?: NodeJS.Signals) => boolean): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.killed = false;
  child.kill = (signal?: NodeJS.Signals) => {
    child.killed = true;
    if (killImpl) return killImpl(signal);
    return true;
  };
  return child;
}

describe('TaskLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Return default branch asynchronously to surface races around awaits.
    execFileMock.mockImplementation((_: any, __: any, ___: any, cb: any) => {
      setTimeout(() => cb(null, 'origin/main\n', ''), 10);
    });

    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      return null;
    });
  });

  it('dedupes concurrent startRun calls so only one process spawns', async () => {
    vi.resetModules();

    const child = createChild(1001);
    spawnMock.mockReturnValue(child);

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
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('does not leave stop intent set when stopRun fails', async () => {
    vi.resetModules();

    const child = createChild(1002, () => {
      throw new Error('kill failed');
    });
    spawnMock.mockReturnValue(child);

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-2';
    const taskPath = '/tmp/wt-2';
    const projectPath = '/tmp/project';

    const started = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(started.ok).toBe(true);

    const stopResult = taskLifecycleService.stopRun(taskId);
    expect(stopResult.ok).toBe(false);

    // If stop intent were leaked, exit would incorrectly force state to idle.
    child.emit('exit', 143);

    const state = taskLifecycleService.getState(taskId);
    expect(state.run.status).toBe('failed');
    expect(state.run.error).toBe('Exited with code 143');
  });

  it('ignores stale child exit and keeps latest run process tracked', async () => {
    vi.resetModules();

    const first = createChild(2001);
    const second = createChild(2002);
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-3';
    const taskPath = '/tmp/wt-3';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    taskLifecycleService.stopRun(taskId);
    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    // Old process exits after new process started; should be ignored.
    first.emit('exit', 143);

    const afterStaleExit = taskLifecycleService.getState(taskId);
    expect(afterStaleExit.run.status).toBe('running');
    expect(afterStaleExit.run.pid).toBe(2002);
  });

  it('ignores stale child error and keeps latest run process state', async () => {
    vi.resetModules();

    const first = createChild(2101);
    const second = createChild(2102);
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-4';
    const taskPath = '/tmp/wt-4';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    taskLifecycleService.stopRun(taskId);
    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    // Old process emits error after new process started; should be ignored.
    first.emit('error', new Error('stale child error'));

    const state = taskLifecycleService.getState(taskId);
    expect(state.run.status).toBe('running');
    expect(state.run.pid).toBe(2102);
    expect(state.run.error).toBeNull();
  });

  it('dedupes concurrent runTeardown calls per task and path', async () => {
    vi.resetModules();

    const runChild = createChild(2201);
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

    serviceAny.runProcesses.set(taskId, runChild);

    const teardownA = taskLifecycleService.runTeardown(taskId, taskPath, projectPath);
    const teardownB = taskLifecycleService.runTeardown(taskId, taskPath, projectPath);

    // Unblock teardown wait-for-exit of run process.
    runChild.emit('exit', 143);

    const [ra, rb] = await Promise.all([teardownA, teardownB]);

    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(runFiniteSpy).toHaveBeenCalledTimes(1);
  });

  it('clears stale run process after spawn error so retry can start', async () => {
    vi.resetModules();

    const broken = createChild(2301);
    const good = createChild(2302);
    spawnMock.mockReturnValueOnce(broken).mockReturnValueOnce(good);

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-6';
    const taskPath = '/tmp/wt-6';
    const projectPath = '/tmp/project';

    const firstStart = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(firstStart.ok).toBe(true);

    broken.emit('error', new Error('spawn failed'));

    const retry = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(retry.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('clearTask removes accumulated lifecycle state entries', async () => {
    vi.resetModules();

    const child = createChild(2401);
    spawnMock.mockReturnValue(child);
    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');
    const serviceAny = taskLifecycleService as any;

    const taskId = 'wt-7';
    const taskPath = '/tmp/wt-7';
    const projectPath = '/tmp/project';

    taskLifecycleService.getState(taskId);
    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    expect(serviceAny.states.has(taskId)).toBe(true);
    expect(serviceAny.runProcesses.has(taskId)).toBe(true);

    taskLifecycleService.clearTask(taskId);

    expect(serviceAny.states.has(taskId)).toBe(false);
    expect(serviceAny.runProcesses.has(taskId)).toBe(false);
  });
});
