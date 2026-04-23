import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real buildExternalToolEnv is used so the stripped env is asserted for real.

type MockLifecyclePtyHandle = {
  pid: number | null;
  killed: boolean;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitCode: number | null, signal: string | null) => void) => void;
  onError: (callback: (error: Error) => void) => void;
  kill: () => void;
  emitData: (data: string) => void;
  emitExit: (exitCode: number | null, signal?: string | null) => void;
  emitError: (error: Error) => void;
};

const execFileMock = vi.fn();
const getScriptMock = vi.fn();
const startLifecyclePtyMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: any[]) => execFileMock(...args),
}));

vi.mock('../../main/services/LifecycleScriptsService', () => ({
  lifecycleScriptsService: {
    getScript: (...args: any[]) => getScriptMock(...args),
  },
}));

vi.mock('../../main/services/ptyManager', () => ({
  startLifecyclePty: (...args: any[]) => startLifecyclePtyMock(...args),
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createLifecyclePty(
  pid: number,
  options?: {
    killImpl?: () => void;
  }
): MockLifecyclePtyHandle {
  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(exitCode: number | null, signal: string | null) => void> = [];
  const errorCallbacks: Array<(error: Error) => void> = [];
  const handle: MockLifecyclePtyHandle = {
    pid,
    killed: false,
    onData: (callback) => dataCallbacks.push(callback),
    onExit: (callback) => exitCallbacks.push(callback),
    onError: (callback) => errorCallbacks.push(callback),
    kill: () => {
      if (options?.killImpl) {
        options.killImpl();
        return;
      }
      handle.killed = true;
    },
    emitData: (data) => {
      for (const callback of dataCallbacks) {
        callback(data);
      }
    },
    emitExit: (exitCode, signal = null) => {
      for (const callback of exitCallbacks) {
        callback(exitCode, signal);
      }
    },
    emitError: (error) => {
      for (const callback of errorCallbacks) {
        callback(error);
      }
    },
  };

  return handle;
}

describe('TaskLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    execFileMock.mockImplementation((_: any, __: any, ___: any, cb: any) => {
      setTimeout(() => cb(null, 'origin/main\n', ''), 10);
    });

    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      return null;
    });
  });

  it('dedupes concurrent startRun calls so only one PTY starts', async () => {
    vi.resetModules();

    const handle = createLifecyclePty(1001);
    startLifecyclePtyMock.mockReturnValue(handle);

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
    expect(startLifecyclePtyMock).toHaveBeenCalledTimes(1);
  });

  it('does not leave stop intent set when stopRun fails', async () => {
    vi.resetModules();

    const handle = createLifecyclePty(1002, {
      killImpl: () => {
        throw new Error('kill failed');
      },
    });
    startLifecyclePtyMock.mockReturnValue(handle);

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-2';
    const taskPath = '/tmp/wt-2';
    const projectPath = '/tmp/project';

    const started = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(started.ok).toBe(true);

    const stopResult = await taskLifecycleService.stopRun(taskId);
    expect(stopResult.ok).toBe(false);

    handle.emitExit(143);

    const state = taskLifecycleService.getState(taskId);
    expect(state.run.status).toBe('failed');
    expect(state.run.error).toBe('Exited with code 143');
  });

  it('ignores stale PTY exit and keeps latest run process tracked', async () => {
    vi.resetModules();

    const first = createLifecyclePty(2001);
    const second = createLifecyclePty(2002);
    startLifecyclePtyMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-3';
    const taskPath = '/tmp/wt-3';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    await taskLifecycleService.stopRun(taskId);
    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    first.emitExit(143);

    const afterStaleExit = taskLifecycleService.getState(taskId);
    expect(afterStaleExit.run.status).toBe('running');
    expect(afterStaleExit.run.pid).toBe(2002);
  });

  it('ignores stale PTY error and keeps latest run process state', async () => {
    vi.resetModules();

    const first = createLifecyclePty(2101);
    const second = createLifecyclePty(2102);
    startLifecyclePtyMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-4';
    const taskPath = '/tmp/wt-4';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    await taskLifecycleService.stopRun(taskId);
    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    first.emitError(new Error('stale PTY error'));

    const state = taskLifecycleService.getState(taskId);
    expect(state.run.status).toBe('running');
    expect(state.run.pid).toBe(2102);
    expect(state.run.error).toBeNull();
  });

  it('dedupes concurrent runTeardown calls per task and path', async () => {
    vi.resetModules();

    const runHandle = createLifecyclePty(2201);
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

    serviceAny.runPtys.set(taskId, runHandle);

    const teardownA = taskLifecycleService.runTeardown(taskId, taskPath, projectPath);
    const teardownB = taskLifecycleService.runTeardown(taskId, taskPath, projectPath);

    runHandle.emitExit(143);

    const [ra, rb] = await Promise.all([teardownA, teardownB]);

    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(runFiniteSpy).toHaveBeenCalledTimes(1);
  });

  it('clears stale run process after PTY error so retry can start', async () => {
    vi.resetModules();

    const broken = createLifecyclePty(2301);
    const good = createLifecyclePty(2302);
    startLifecyclePtyMock.mockReturnValueOnce(broken).mockReturnValueOnce(good);

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-6';
    const taskPath = '/tmp/wt-6';
    const projectPath = '/tmp/project';

    const firstStart = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(firstStart.ok).toBe(true);

    broken.emitError(new Error('pty failed'));

    const retry = await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(retry.ok).toBe(true);
    expect(startLifecyclePtyMock).toHaveBeenCalledTimes(2);
  });

  it('clearTask removes accumulated lifecycle state entries', async () => {
    vi.resetModules();

    const handle = createLifecyclePty(2401);
    startLifecyclePtyMock.mockReturnValue(handle);
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
    expect(serviceAny.runPtys.has(taskId)).toBe(true);

    taskLifecycleService.clearTask(taskId);

    expect(handle.killed).toBe(true);
    expect(serviceAny.states.has(taskId)).toBe(false);
    expect(serviceAny.runPtys.has(taskId)).toBe(false);
  });

  it('keeps setup failed when PTY emits error and exit', async () => {
    vi.resetModules();

    const handle = createLifecyclePty(2501);
    startLifecyclePtyMock.mockReturnValue(handle);
    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'setup') return 'npm i';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-8';
    const taskPath = '/tmp/wt-8';
    const projectPath = '/tmp/project';

    const setupPromise = taskLifecycleService.runSetup(taskId, taskPath, projectPath);
    await new Promise((resolve) => setTimeout(resolve, 25));
    handle.emitError(new Error('pty failed'));
    handle.emitExit(0);

    const setupResult = await setupPromise;
    const state = taskLifecycleService.getState(taskId);

    expect(setupResult.ok).toBe(false);
    expect(state.setup.status).toBe('failed');
    expect(state.setup.error).toBe('pty failed');
  });

  it('runs stop script before killing the run process', async () => {
    vi.resetModules();

    const runHandle = createLifecyclePty(3001);
    const stopHandle = createLifecyclePty(3002);
    startLifecyclePtyMock.mockReturnValueOnce(runHandle).mockReturnValueOnce(stopHandle);
    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      if (phase === 'stop') return 'echo stopping';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-stop-1';
    const taskPath = '/tmp/wt-stop-1';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    expect(runHandle.killed).toBe(false);

    const stopPromise = taskLifecycleService.stopRun(taskId, taskPath, projectPath);

    // Wait for buildLifecycleEnv (async) to resolve so the stop PTY is spawned
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Stop script PTY was spawned
    expect(startLifecyclePtyMock).toHaveBeenCalledTimes(2);
    expect(startLifecyclePtyMock.mock.calls[1][0]).toMatchObject({
      id: expect.stringContaining('lifecycle-stop-'),
      command: 'echo stopping',
    });

    // Run process should NOT be killed yet (stop script still running)
    expect(runHandle.killed).toBe(false);

    // Stop script finishes
    stopHandle.emitExit(0);
    await stopPromise;

    // Now the run process should be killed
    expect(runHandle.killed).toBe(true);
  });

  it('skips stop script when none is configured', async () => {
    vi.resetModules();

    const runHandle = createLifecyclePty(3101);
    startLifecyclePtyMock.mockReturnValue(runHandle);
    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      return null; // no stop script
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-stop-2';
    const taskPath = '/tmp/wt-stop-2';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);
    await taskLifecycleService.stopRun(taskId, taskPath, projectPath);

    // Only one PTY spawned (the run), no stop PTY
    expect(startLifecyclePtyMock).toHaveBeenCalledTimes(1);
    expect(runHandle.killed).toBe(true);
  });

  it('kills run process even if stop script fails', async () => {
    vi.resetModules();

    const runHandle = createLifecyclePty(3201);
    const stopHandle = createLifecyclePty(3202);
    startLifecyclePtyMock.mockReturnValueOnce(runHandle).mockReturnValueOnce(stopHandle);
    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      if (phase === 'stop') return 'exit 1';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-stop-3';
    const taskPath = '/tmp/wt-stop-3';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    const stopPromise = taskLifecycleService.stopRun(taskId, taskPath, projectPath);
    // Wait for buildLifecycleEnv to resolve so the stop PTY is spawned
    await new Promise((resolve) => setTimeout(resolve, 25));
    stopHandle.emitError(new Error('stop script crashed'));
    await stopPromise;

    // Run process should still be killed despite stop script failure
    expect(runHandle.killed).toBe(true);
  });

  it('does not kill run process if stop script already shut it down', async () => {
    vi.resetModules();

    let killCount = 0;
    const runHandle = createLifecyclePty(3301);
    const originalKill = runHandle.kill.bind(runHandle);
    runHandle.kill = () => {
      killCount++;
      originalKill();
    };
    const stopHandle = createLifecyclePty(3302);
    startLifecyclePtyMock.mockReturnValueOnce(runHandle).mockReturnValueOnce(stopHandle);
    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      if (phase === 'stop') return 'kill $SERVER_PID';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-stop-4';
    const taskPath = '/tmp/wt-stop-4';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    const stopPromise = taskLifecycleService.stopRun(taskId, taskPath, projectPath);
    // Wait for buildLifecycleEnv to resolve so the stop PTY is spawned
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Simulate: stop script shuts down the run process before exiting
    runHandle.emitExit(0);
    stopHandle.emitExit(0);
    await stopPromise;

    // Run process exited on its own, so kill should not have been called
    expect(killCount).toBe(0);
  });

  it('emits stop script output as run phase line events', async () => {
    vi.resetModules();

    const runHandle = createLifecyclePty(3401);
    const stopHandle = createLifecyclePty(3402);
    startLifecyclePtyMock.mockReturnValueOnce(runHandle).mockReturnValueOnce(stopHandle);
    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'run') return 'npm run dev';
      if (phase === 'stop') return 'echo bye';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

    const taskId = 'wt-stop-5';
    const taskPath = '/tmp/wt-stop-5';
    const projectPath = '/tmp/project';

    await taskLifecycleService.startRun(taskId, taskPath, projectPath);

    const events: any[] = [];
    taskLifecycleService.onEvent((evt) => {
      if (evt.taskId === taskId) events.push(evt);
    });

    const stopPromise = taskLifecycleService.stopRun(taskId, taskPath, projectPath);
    // Wait for buildLifecycleEnv to resolve so the stop PTY is spawned
    await new Promise((resolve) => setTimeout(resolve, 25));
    stopHandle.emitData('shutting down...\r\n');
    stopHandle.emitExit(0);
    await stopPromise;

    const lineEvents = events.filter((e) => e.phase === 'run' && e.status === 'line');
    expect(lineEvents).toHaveLength(1);
    expect(lineEvents[0].line).toBe('shutting down...\r\n');
  });

  it('clearTask stops in-flight setup/teardown PTYs', async () => {
    vi.resetModules();

    const setupHandle = createLifecyclePty(2601);
    startLifecyclePtyMock.mockReturnValue(setupHandle);
    getScriptMock.mockImplementation((_: string, phase: string) => {
      if (phase === 'setup') return 'npm i';
      return null;
    });

    const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');
    const serviceAny = taskLifecycleService as any;

    const taskId = 'wt-9';
    const taskPath = '/tmp/wt-9';
    const projectPath = '/tmp/project';

    void taskLifecycleService.runSetup(taskId, taskPath, projectPath);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(serviceAny.finitePtys.has(taskId)).toBe(true);
    taskLifecycleService.clearTask(taskId);
    expect(setupHandle.killed).toBe(true);
    expect(serviceAny.finitePtys.has(taskId)).toBe(false);
  });

  describe('lifecycle env sanitization (AppImage)', () => {
    const SAVED_ENV_KEYS = [
      'APPIMAGE',
      'APPDIR',
      'ARGV0',
      'CHROME_DESKTOP',
      'GSETTINGS_SCHEMA_DIR',
      'OWD',
      'PATH',
      'LD_LIBRARY_PATH',
      'XDG_DATA_DIRS',
      'PYTHONHOME',
    ] as const;
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const key of SAVED_ENV_KEYS) originalEnv[key] = process.env[key];

      process.env.APPIMAGE = '/home/user/emdash.AppImage';
      process.env.APPDIR = '/tmp/.mount_emdashXYZ';
      process.env.ARGV0 = 'AppRun';
      process.env.CHROME_DESKTOP = 'emdash.desktop';
      process.env.GSETTINGS_SCHEMA_DIR = '/tmp/.mount_emdashXYZ/usr/share/glib-2.0/schemas';
      process.env.OWD = '/tmp';
      process.env.PATH = '/usr/local/bin:/tmp/.mount_emdashXYZ/usr/bin:/usr/bin';
      process.env.LD_LIBRARY_PATH = '/tmp/.mount_emdashXYZ/usr/lib:/usr/local/cuda/lib64';
      process.env.XDG_DATA_DIRS = '/tmp/.mount_emdashXYZ/usr/share:/usr/share';
      process.env.PYTHONHOME = '/tmp/.mount_emdashXYZ/usr';
    });

    afterEach(() => {
      for (const key of SAVED_ENV_KEYS) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
      }
    });

    it('strips AppImage env vars from lifecycle setup PTY env', async () => {
      vi.resetModules();

      const handle = createLifecyclePty(4001);
      startLifecyclePtyMock.mockReturnValue(handle);
      getScriptMock.mockImplementation((_: string, phase: string) => {
        if (phase === 'setup') return 'pnpm install';
        return null;
      });

      const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

      const setupPromise = taskLifecycleService.runSetup(
        'wt-appimage-1',
        '/tmp/wt-appimage-1',
        '/tmp/project'
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      handle.emitExit(0);
      await setupPromise;

      expect(startLifecyclePtyMock).toHaveBeenCalledTimes(1);
      const passedEnv = startLifecyclePtyMock.mock.calls[0][0].env as NodeJS.ProcessEnv;

      expect(passedEnv.APPIMAGE).toBeUndefined();
      expect(passedEnv.APPDIR).toBeUndefined();
      expect(passedEnv.ARGV0).toBeUndefined();
      expect(passedEnv.CHROME_DESKTOP).toBeUndefined();
      expect(passedEnv.GSETTINGS_SCHEMA_DIR).toBeUndefined();
      expect(passedEnv.OWD).toBeUndefined();
      expect(passedEnv.PYTHONHOME).toBeUndefined();

      expect(passedEnv.PATH).toBe('/usr/local/bin:/usr/bin');
      expect(passedEnv.LD_LIBRARY_PATH).toBe('/usr/local/cuda/lib64');
      expect(passedEnv.XDG_DATA_DIRS).toBe('/usr/share');
    });

    it('still injects task env vars over the sanitized base env', async () => {
      vi.resetModules();

      const handle = createLifecyclePty(4002);
      startLifecyclePtyMock.mockReturnValue(handle);
      getScriptMock.mockImplementation((_: string, phase: string) =>
        phase === 'setup' ? 'pnpm install' : null
      );

      const { taskLifecycleService } = await import('../../main/services/TaskLifecycleService');

      const setupPromise = taskLifecycleService.runSetup(
        'wt-appimage-2',
        '/tmp/wt-appimage-2',
        '/tmp/project',
        'appimage-task'
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      handle.emitExit(0);
      await setupPromise;

      const passedEnv = startLifecyclePtyMock.mock.calls[0][0].env as NodeJS.ProcessEnv;

      expect(passedEnv.EMDASH_TASK_ID).toBe('wt-appimage-2');
      expect(passedEnv.APPIMAGE).toBeUndefined();
    });
  });
});
