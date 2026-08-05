import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodePtySpawner } from './node-pty-spawner';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node-pty', () => ({
  spawn: spawnMock,
}));

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.clearAllMocks();
});

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

function mockPtyProcess() {
  const proc = {
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    on: vi.fn(),
  };
  spawnMock.mockReturnValue(proc);
  return proc;
}

describe('NodePtySpawner', () => {
  it('lazy-loads node-pty and adapts the spawned process', async () => {
    setPlatform('linux');
    const proc = mockPtyProcess();

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

  it('launches Windows npm command shims through cmd.exe', async () => {
    setPlatform('win32');
    mockPtyProcess();

    await new NodePtySpawner().spawn({
      command: 'C:\\Users\\Me User\\AppData\\Roaming\\npm\\codex.cmd',
      args: ['login'],
      cwd: 'C:\\Users\\Me User',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      cols: 80,
      rows: 24,
      windowsScript: 'trusted',
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      '/d /s /c "C:\\Users\\Me^ User\\AppData\\Roaming\\npm\\codex.cmd ^"login^""',
      {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: 'C:\\Users\\Me User',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      }
    );
  });

  it('does not shell-wrap Windows scripts without an explicit trust marker', async () => {
    setPlatform('win32');
    mockPtyProcess();

    await new NodePtySpawner().spawn({
      command: 'C:\\npm\\agent.cmd',
      args: ['user-controlled'],
      cwd: 'C:\\workspace',
      env: {},
      cols: 80,
      rows: 24,
    });

    expect(spawnMock).toHaveBeenCalledWith('C:\\npm\\agent.cmd', ['user-controlled'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: 'C:\\workspace',
      env: {},
    });
  });
});
