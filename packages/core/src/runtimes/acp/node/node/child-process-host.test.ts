import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChildAcpProcessHost } from './child-process-host';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

describe('ChildAcpProcessHost', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeChild());
  });

  it('wraps cmd shims for ACP primary processes', async () => {
    const shim = 'C:\\Program Files\\npm\\provider.cmd';
    const host = windowsHost(shim);

    await host.spawn({
      command: 'provider',
      args: ['--acp', 'hello world'],
      cwd: 'C:\\workspace',
      env: windowsEnv(),
    });

    const [executable, args, options] = spawnMock.mock.calls[0]!;
    expect(executable).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(args[3].toLowerCase()).toContain(shim.toLowerCase());
    expect(options).toMatchObject({ windowsVerbatimArguments: true });
    expect(options).not.toHaveProperty('shell');
  });

  it('wraps cmd shims for ACP agent-requested terminals', async () => {
    const shim = 'C:\\Program Files\\npm\\provider.cmd';
    const host = windowsHost(shim);

    await host.spawnTerminal({
      command: 'provider.cmd',
      args: ['run'],
      cwd: 'C:\\workspace',
      env: windowsEnv(),
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', expect.stringContaining(shim)],
      expect.objectContaining({ windowsVerbatimArguments: true })
    );
    expect(spawnMock.mock.calls[0]?.[2]).not.toHaveProperty('shell');
  });
});

function windowsHost(shim: string): ChildAcpProcessHost {
  return new ChildAcpProcessHost({
    platform: 'win32',
    fileExists: (candidate) => candidate.toLowerCase() === shim.toLowerCase(),
  });
}

function windowsEnv(): Record<string, string> {
  return {
    Path: 'C:\\Program Files\\npm',
    PATHEXT: '.EXE;.CMD',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  };
}

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    kill: vi.fn(),
  });
}
