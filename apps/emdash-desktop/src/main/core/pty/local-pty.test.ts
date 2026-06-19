import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalPtySession } from './local-pty';
import { collectLocalDescendantPidsAsync } from './process-tree';

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

vi.mock('./process-tree', () => ({
  collectLocalDescendantPidsAsync: vi.fn(() => Promise.resolve([])),
}));

/** Let the async descendant snapshot (a resolved promise + its .then) settle. */
async function flushSnapshot(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('LocalPtySession', () => {
  type MockPtyProcess = ConstructorParameters<typeof LocalPtySession>[1];

  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  let mockProc: MockPtyProcess;
  let pty: LocalPtySession;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      ...originalPlatform,
      value: platform,
    });
  }

  /** Register an onExit handler and return a trigger for the captured callback. */
  function captureExit(): () => void {
    let exitHandler: ((info: { exitCode: number; signal: number }) => void) | undefined;
    vi.mocked(mockProc.onExit).mockImplementation((handler) => {
      exitHandler = handler;
      return { dispose: vi.fn() };
    });
    pty.onExit(() => {});
    return () => exitHandler?.({ exitCode: 0, signal: 0 });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collectLocalDescendantPidsAsync).mockResolvedValue([]);
    vi.useFakeTimers();

    mockProc = {
      pid: 1234,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    } as unknown as MockPtyProcess;
    pty = new LocalPtySession('test-id', mockProc);

    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('kill() sends SIGTERM to the process group on POSIX', async () => {
    setPlatform('linux');

    pty.kill();
    await flushSnapshot();

    expect(process.kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it('kill() escalates the group to SIGKILL after 2 seconds if not exited', async () => {
    setPlatform('linux');

    pty.kill();
    await flushSnapshot();
    expect(process.kill).not.toHaveBeenCalledWith(-1234, 'SIGKILL');

    vi.advanceTimersByTime(2000);
    expect(process.kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
  });

  it('kill() does not send the group SIGKILL if the shell exits before the timeout', async () => {
    setPlatform('linux');
    const triggerExit = captureExit();

    pty.kill();
    await flushSnapshot();
    triggerExit();

    vi.advanceTimersByTime(2000);
    expect(process.kill).not.toHaveBeenCalledWith(-1234, 'SIGKILL');
  });

  it('kill() does not use process groups on Windows', () => {
    setPlatform('win32');

    pty.kill();

    expect(collectLocalDescendantPidsAsync).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalledWith(-1234, expect.any(String));
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it('kill() is idempotent', async () => {
    setPlatform('linux');

    pty.kill();
    pty.kill();
    await flushSnapshot();

    expect(collectLocalDescendantPidsAsync).toHaveBeenCalledTimes(1);
    expect(mockProc.kill).toHaveBeenCalledTimes(1);
  });

  it('kill() SIGTERMs setsid()-detached descendants individually', async () => {
    setPlatform('linux');
    vi.mocked(collectLocalDescendantPidsAsync).mockResolvedValue([5678, 9012]);

    pty.kill();
    await flushSnapshot();

    expect(collectLocalDescendantPidsAsync).toHaveBeenCalledWith(1234);
    expect(process.kill).toHaveBeenCalledWith(5678, 'SIGTERM');
    expect(process.kill).toHaveBeenCalledWith(9012, 'SIGTERM');
  });

  it('kill() escalates surviving descendants to SIGKILL after 2 seconds', async () => {
    setPlatform('linux');
    vi.mocked(collectLocalDescendantPidsAsync).mockResolvedValue([5678]);

    pty.kill();
    await flushSnapshot();
    expect(process.kill).not.toHaveBeenCalledWith(5678, 'SIGKILL');

    vi.advanceTimersByTime(2000);
    expect(process.kill).toHaveBeenCalledWith(5678, 'SIGKILL');
  });

  it('kill() still SIGKILLs detached descendants even when the shell exits first', async () => {
    setPlatform('linux');
    vi.mocked(collectLocalDescendantPidsAsync).mockResolvedValue([5678]);
    const triggerExit = captureExit();

    pty.kill();
    await flushSnapshot();
    // The shell exits right after SIGTERM, while watchman/ts-checker daemons keep running.
    triggerExit();

    vi.advanceTimersByTime(2000);
    // The dead group's SIGKILL is cancelled...
    expect(process.kill).not.toHaveBeenCalledWith(-1234, 'SIGKILL');
    // ...but the detached descendant is still force-killed — this is the bug the
    // independent descendant timer fixes.
    expect(process.kill).toHaveBeenCalledWith(5678, 'SIGKILL');
  });

  it('kill() snapshots descendants once and reuses the snapshot for both passes', async () => {
    setPlatform('linux');
    vi.mocked(collectLocalDescendantPidsAsync).mockResolvedValue([5678]);

    pty.kill();
    await flushSnapshot();
    vi.advanceTimersByTime(2000);

    expect(collectLocalDescendantPidsAsync).toHaveBeenCalledTimes(1);
  });
});
