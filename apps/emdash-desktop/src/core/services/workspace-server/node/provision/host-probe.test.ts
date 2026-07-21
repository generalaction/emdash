import { describe, expect, it, vi } from 'vitest';
import { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';
import { RemoteHostProbe } from './host-probe';

describe('RemoteHostProbe', () => {
  it('normalizes and caches host metadata until explicitly dropped', async () => {
    const proxy = new SshClientProxy('ssh-1');
    const exec = vi
      .spyOn(proxy, 'exec')
      .mockResolvedValue({ stdout: '/home/devuser\nLinux\naarch64\n', stderr: '', exitCode: 0 });
    const ensureProxy = vi.fn(async () => proxy);
    const probe = new RemoteHostProbe({ ensureProxy });

    await expect(probe.probe('ssh-1')).resolves.toEqual({
      home: '/home/devuser',
      os: 'linux',
      arch: 'arm64',
    });
    await probe.probe('ssh-1');
    expect(exec).toHaveBeenCalledOnce();

    probe.drop('ssh-1');
    await probe.probe('ssh-1');
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
