import { describe, expect, it, vi } from 'vitest';
import { NodePtySpawner } from './node-pty-spawner';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node-pty', () => ({
  spawn: spawnMock,
}));

describe('NodePtySpawner', () => {
  it('lazy-loads node-pty and adapts the spawned process', async () => {
    const proc = {
      pid: 123,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    spawnMock.mockReturnValue(proc);

    const spawned = await new NodePtySpawner().spawn({
      command: 'agent',
      args: ['--login'],
      cwd: '/tmp',
      env: { PATH: '/usr/bin' },
      cols: 80,
      rows: 24,
    });

    expect(spawnMock).toHaveBeenCalledWith('agent', ['--login'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: { PATH: '/usr/bin' },
    });
    spawned.write('input');
    spawned.resize(100, 30);
    expect(proc.write).toHaveBeenCalledWith('input');
    expect(proc.resize).toHaveBeenCalledWith(100, 30);
  });

  it('terminates Windows PTY descendants with taskkill tree semantics', async () => {
    let exitHandler:
      | ((event: { exitCode: number | null; signal?: string | null }) => void)
      | undefined;
    const proc = {
      pid: 4321,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn((handler) => {
        exitHandler = handler;
      }),
    };
    spawnMock.mockReturnValue(proc);
    const taskkill = vi.fn(async () => {
      exitHandler?.({ exitCode: null, signal: 'SIGTERM' });
    });
    const spawned = await new NodePtySpawner({ platform: 'win32', taskkill }).spawn({
      command: 'agent.cmd',
      args: [],
      cwd: 'C:\\workspace',
      env: { PATH: 'C:\\Windows\\System32' },
      cols: 80,
      rows: 24,
    });
    spawned.onExit(vi.fn());

    spawned.kill();
    await Promise.resolve();
    await Promise.resolve();

    expect(taskkill).toHaveBeenCalledWith(['/PID', '4321', '/T']);
    expect(proc.kill).toHaveBeenCalledOnce();
  });
});
