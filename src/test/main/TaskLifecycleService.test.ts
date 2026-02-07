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
});
