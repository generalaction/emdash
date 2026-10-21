import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import type { SshClientProxy } from '@core/primitives/ssh/api/node/ssh-client-proxy';
import { RemoteHostProbe } from './host-probe';

describe('RemoteHostProbe', () => {
  it('classifies POSIX before reading and caching the remote home directory', async () => {
    const exec = vi
      .fn<SshClientProxy['exec']>()
      .mockResolvedValueOnce({ stdout: 'Linux\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'Linux\n', stderr: '', exitCode: 0 });
    const execScript = vi
      .fn<SshClientProxy['execScript']>()
      .mockResolvedValue({ stdout: '/home/devuser\n', stderr: '', exitCode: 0 });
    const proxy = { exec, execScript } as Pick<
      SshClientProxy,
      'exec' | 'execScript'
    > as SshClientProxy;
    const ensureProxy = vi.fn(async () => proxy);
    const probe = new RemoteHostProbe('ssh-1', { ensureProxy });

    await expect(probe.probe()).resolves.toEqual({
      platform: 'posix',
      home: '/home/devuser',
    });
    await probe.probe();
    expect(ensureProxy).toHaveBeenCalledWith('ssh-1');
    expect(exec).toHaveBeenCalledOnce();
    expect(execScript).toHaveBeenCalledOnce();

    probe.drop();
    await probe.probe();
    expect(exec).toHaveBeenCalledTimes(2);
    expect(execScript).toHaveBeenCalledTimes(2);
  });

  it('classifies standard Windows hosts without running POSIX shell syntax', async () => {
    const exec = vi
      .fn<SshClientProxy['exec']>()
      .mockResolvedValueOnce({ stdout: '', stderr: 'uname is not recognized', exitCode: 1 })
      .mockResolvedValueOnce({
        stdout: 'Microsoft Windows [Version 10.0.26100]\n',
        stderr: '',
        exitCode: 0,
      });
    const execScript = vi.fn<SshClientProxy['execScript']>();
    const proxy = { exec, execScript } as Pick<
      SshClientProxy,
      'exec' | 'execScript'
    > as SshClientProxy;
    const probe = new RemoteHostProbe('ssh-1', { ensureProxy: vi.fn(async () => proxy) });

    await expect(probe.probe()).resolves.toEqual({ platform: 'win32' });
    expect(exec).toHaveBeenNthCalledWith(
      1,
      { command: 'uname', args: ['-s'] },
      expect.objectContaining({ timeoutMs: 10_000 })
    );
    expect(exec).toHaveBeenNthCalledWith(
      2,
      { command: 'cmd.exe', args: ['/d', '/s', '/c', 'ver'] },
      expect.objectContaining({ timeoutMs: 10_000 })
    );
    expect(exec).toHaveBeenCalledTimes(2);
    expect(execScript).not.toHaveBeenCalled();
  });

  it('classifies Windows POSIX compatibility shells before reading HOME', async () => {
    const exec = vi
      .fn<SshClientProxy['exec']>()
      .mockResolvedValueOnce({ stdout: 'MINGW64_NT-10.0\n', stderr: '', exitCode: 0 });
    const execScript = vi.fn<SshClientProxy['execScript']>();
    const proxy = { exec, execScript } as Pick<
      SshClientProxy,
      'exec' | 'execScript'
    > as SshClientProxy;
    const probe = new RemoteHostProbe('ssh-1', { ensureProxy: vi.fn(async () => proxy) });

    await expect(probe.probe()).resolves.toEqual({ platform: 'win32' });
    expect(execScript).not.toHaveBeenCalled();
  });

  it('does not read HOME when the remote platform cannot be classified', async () => {
    const exec = vi
      .fn<SshClientProxy['exec']>()
      .mockResolvedValueOnce({ stdout: '', stderr: 'uname: not found', exitCode: 127 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'cmd.exe: not found', exitCode: 127 });
    const execScript = vi.fn<SshClientProxy['execScript']>();
    const proxy = { exec, execScript } as Pick<
      SshClientProxy,
      'exec' | 'execScript'
    > as SshClientProxy;
    const probe = new RemoteHostProbe('ssh-1', { ensureProxy: vi.fn(async () => proxy) });

    await expect(probe.probe()).rejects.toThrow('Remote platform probe failed: uname: not found');
    expect(execScript).not.toHaveBeenCalled();
  });

  it('keeps the replacement probe cached when a dropped probe fails late', async () => {
    const first = deferred<SshClientProxy>();
    const proxy = {
      exec: vi.fn(async () => ({ stdout: 'Linux', stderr: '', exitCode: 0 })),
      execScript: vi.fn(async () => ({ stdout: '/home/replacement', stderr: '', exitCode: 0 })),
    } as unknown as SshClientProxy;
    const ensureProxy = vi.fn(async () => proxy).mockImplementationOnce(() => first.promise);
    const probe = new RemoteHostProbe('ssh-1', { ensureProxy });
    const stale = probe.probe();
    const rejected = expect(stale).rejects.toThrow('old connection closed');
    probe.drop();
    const replacement = probe.probe();
    await replacement;

    first.reject(new Error('old connection closed'));
    await rejected;

    expect(probe.probe()).toBe(replacement);
    expect(ensureProxy).toHaveBeenCalledTimes(2);
  });
});
