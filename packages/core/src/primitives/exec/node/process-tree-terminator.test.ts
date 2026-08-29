import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessTreeTerminator, type ProcessTreeTarget } from './process-tree-terminator';

describe('ProcessTreeTerminator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses direct taskkill argv and force-escalates a live Windows tree', async () => {
    const target = fakeTarget(4321);
    const taskkill = vi.fn(async () => {});
    const terminator = new ProcessTreeTerminator(target, {
      platform: 'win32',
      graceMs: 0,
      taskkill,
    });

    await terminator.terminate();

    expect(taskkill).toHaveBeenNthCalledWith(1, ['/PID', '4321', '/T']);
    expect(taskkill).toHaveBeenNthCalledWith(2, ['/PID', '4321', '/T', '/F']);
    expect(target.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(target.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('does not address a Windows PID again after the original child exits', async () => {
    let exited = false;
    const target = fakeTarget(4321, () => exited);
    const taskkill = vi.fn(async () => {
      exited = true;
    });
    const terminator = new ProcessTreeTerminator(target, {
      platform: 'win32',
      graceMs: 0,
      taskkill,
    });

    await terminator.terminate();

    expect(taskkill).toHaveBeenCalledOnce();
    expect(taskkill).toHaveBeenCalledWith(['/PID', '4321', '/T']);
  });

  it('is idempotent when termination is requested repeatedly', async () => {
    const target = fakeTarget(4321);
    const taskkill = vi.fn(async () => {});
    const terminator = new ProcessTreeTerminator(target, {
      platform: 'win32',
      graceMs: 0,
      taskkill,
    });

    const first = terminator.terminate();
    const second = terminator.terminate('SIGKILL');
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(taskkill).toHaveBeenCalledTimes(2);
  });

  it('does nothing after the owned process has naturally exited', async () => {
    const target = fakeTarget(4321, () => true);
    const taskkill = vi.fn(async () => {});
    const terminator = new ProcessTreeTerminator(target, {
      platform: 'win32',
      taskkill,
    });

    await terminator.terminate();

    expect(taskkill).not.toHaveBeenCalled();
    expect(target.kill).not.toHaveBeenCalled();
  });

  it('signals a detached POSIX process group before the child handle', async () => {
    const target = fakeTarget(4321);
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) throw new Error('not running');
      expect(pid).toBe(-4321);
      return true;
    });
    const terminator = new ProcessTreeTerminator(target, {
      platform: 'linux',
      processGroup: true,
      graceMs: 0,
    });

    await terminator.terminate();

    expect(process.kill).toHaveBeenCalledWith(-4321, 'SIGTERM');
    expect(target.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

function fakeTarget(pid: number, isExited: () => boolean = () => false): ProcessTreeTarget {
  return {
    pid,
    isExited,
    kill: vi.fn(),
  };
}
