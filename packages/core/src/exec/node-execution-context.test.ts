import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeExecutionContext } from './node-execution-context';
import { resolveWindowsScriptCommand } from './windows-script-command';

const { execFileAsyncMock } = vi.hoisted(() => ({
  execFileAsyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: () => execFileAsyncMock,
}));

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.clearAllMocks();
});

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('NodeExecutionContext', () => {
  it('runs a Windows Codex status command through cmd.exe', async () => {
    setPlatform('win32');
    execFileAsyncMock.mockResolvedValue({ stdout: 'Logged in', stderr: '' });
    const env = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
    const context = new NodeExecutionContext({ env });

    await context.exec('C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd', ['login', 'status'], {
      windowsScript: 'trusted',
    });

    expect(execFileAsyncMock).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', '"C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd ^"login^" ^"status^""'],
      expect.objectContaining({
        env,
        windowsVerbatimArguments: true,
      })
    );
  });

  it('leaves non-Windows commands unchanged', async () => {
    setPlatform('linux');
    execFileAsyncMock.mockResolvedValue({ stdout: 'agent 1.0.0', stderr: '' });
    const context = new NodeExecutionContext();

    await context.exec('/usr/bin/agent', ['--version']);

    expect(execFileAsyncMock).toHaveBeenCalledWith(
      '/usr/bin/agent',
      ['--version'],
      expect.objectContaining({ windowsVerbatimArguments: undefined })
    );
  });

  it('does not shell-wrap Windows scripts without an explicit trust marker', async () => {
    setPlatform('win32');
    execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' });
    const context = new NodeExecutionContext();

    await context.exec('C:\\npm\\agent.cmd', ['user-controlled']);

    expect(execFileAsyncMock).toHaveBeenCalledWith(
      'C:\\npm\\agent.cmd',
      ['user-controlled'],
      expect.objectContaining({ windowsVerbatimArguments: undefined })
    );
  });
});

describe('resolveWindowsScriptCommand', () => {
  it('escapes cmd.exe metacharacters, quotes, empty arguments, and trailing backslashes', () => {
    const resolved = resolveWindowsScriptCommand(
      'C:\\Program Files (x86)\\npm\\codex.cmd',
      ['A&B', '%PATH%', '!', '^', 'say "hi"', '', 'ends\\'],
      { ComSpec: 'cmd.exe' },
      'win32',
      true
    );

    expect(resolved).toEqual({
      command: 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        expect.stringContaining(
          'C:\\Program^ Files^ ^(x86^)\\npm\\codex.cmd ^"A^&B^" ^"^%PATH^%^"'
        ),
      ],
      ptyCommandLine: expect.stringContaining('/d /s /c'),
      windowsVerbatimArguments: true,
    });
    expect(resolved.args[3]).toContain('^"^!^"');
    expect(resolved.args[3]).toContain('^"^^^"');
    expect(resolved.args[3]).toContain('^"^"');
    expect(resolved.args[3]).toContain('ends\\\\');
  });
});
