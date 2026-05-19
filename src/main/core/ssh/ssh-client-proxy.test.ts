import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RemoteShellProfileModule from './remote-shell-profile';
import { SshClientProxy } from './ssh-client-proxy';

const mocks = vi.hoisted(() => ({
  captureRemoteShellProfile: vi.fn(),
}));

vi.mock('./remote-shell-profile', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof RemoteShellProfileModule;
  return {
    ...actual,
    captureRemoteShellProfile: mocks.captureRemoteShellProfile,
  };
});

describe('SshClientProxy remote shell profile', () => {
  beforeEach(() => {
    mocks.captureRemoteShellProfile.mockReset();
  });

  it('returns a rejected promise when the SSH connection is unavailable', async () => {
    const proxy = new SshClientProxy('ssh-1');

    await expect(proxy.getRemoteShellProfile()).rejects.toThrow('SSH connection is not available');
  });

  it('captures and caches the remote shell profile behind the proxy API', async () => {
    const client = {};
    const profile = {
      shell: '/bin/zsh',
      env: { PATH: '/opt/homebrew/bin:/usr/bin' },
    };
    mocks.captureRemoteShellProfile.mockResolvedValue(profile);
    const proxy = new SshClientProxy('ssh-1');
    proxy.update(client as never);

    await expect(proxy.getRemoteShellProfile()).resolves.toBe(profile);
    await expect(proxy.getRemoteShellProfile()).resolves.toBe(profile);

    expect(mocks.captureRemoteShellProfile).toHaveBeenCalledTimes(1);
    expect(mocks.captureRemoteShellProfile).toHaveBeenCalledWith(proxy);
  });

  it('does not cache an in-flight shell profile after invalidation', async () => {
    let resolveFirst!: (profile: { shell: string; env: Record<string, string> }) => void;
    const firstCapture = new Promise<{ shell: string; env: Record<string, string> }>((resolve) => {
      resolveFirst = resolve;
    });
    const firstClient = {};
    const secondClient = {};
    mocks.captureRemoteShellProfile
      .mockReturnValueOnce(firstCapture)
      .mockResolvedValueOnce({ shell: '/bin/bash', env: { PATH: '/second' } });
    const proxy = new SshClientProxy('ssh-1');

    proxy.update(firstClient as never);
    const staleCapture = proxy.getRemoteShellProfile();
    proxy.invalidate();
    proxy.update(secondClient as never);
    resolveFirst({ shell: '/bin/zsh', env: { PATH: '/first' } });
    await staleCapture;

    await expect(proxy.getRemoteShellProfile()).resolves.toEqual({
      shell: '/bin/bash',
      env: { PATH: '/second' },
    });
    expect(mocks.captureRemoteShellProfile).toHaveBeenCalledTimes(2);
    expect(mocks.captureRemoteShellProfile).toHaveBeenNthCalledWith(2, proxy);
  });

  it('clears cached shell profile on invalidate', async () => {
    const firstClient = {};
    const secondClient = {};
    mocks.captureRemoteShellProfile
      .mockResolvedValueOnce({ shell: '/bin/zsh', env: { PATH: '/first' } })
      .mockResolvedValueOnce({ shell: '/bin/bash', env: { PATH: '/second' } });
    const proxy = new SshClientProxy('ssh-1');

    proxy.update(firstClient as never);
    await proxy.getRemoteShellProfile();
    proxy.invalidate();
    proxy.update(secondClient as never);
    const profile = await proxy.getRemoteShellProfile();

    expect(profile).toEqual({ shell: '/bin/bash', env: { PATH: '/second' } });
    expect(mocks.captureRemoteShellProfile).toHaveBeenCalledTimes(2);
  });
});

describe('SshClientProxy channel health reporting', () => {
  it('reports exec channel success and failure', () => {
    const successCallback = vi.fn();
    const error = new Error('open failed');
    const reporter = {
      reportChannelError: vi.fn(),
      reportChannelRecovered: vi.fn(),
    };
    const client = {
      exec: vi
        .fn()
        .mockImplementationOnce((_command, callback) => callback(undefined, {}))
        .mockImplementationOnce((_command, callback) => callback(error, undefined)),
    };
    const proxy = new SshClientProxy('ssh-1', reporter);
    proxy.update(client as never);

    proxy.exec('true', successCallback);
    proxy.exec('false', vi.fn());

    expect(successCallback).toHaveBeenCalledWith(undefined, {});
    expect(reporter.reportChannelRecovered).toHaveBeenCalledWith('ssh-1');
    expect(reporter.reportChannelError).toHaveBeenCalledWith('ssh-1', error);
  });

  it('reports pty and sftp channel failures', () => {
    const ptyError = new Error('pty failed');
    const sftpError = new Error('sftp failed');
    const reporter = {
      reportChannelError: vi.fn(),
    };
    const client = {
      exec: vi.fn((_command, _options, callback) => callback(ptyError, undefined)),
      sftp: vi.fn((callback) => callback(sftpError, undefined)),
    };
    const proxy = new SshClientProxy('ssh-1', reporter);
    proxy.update(client as never);

    proxy.execPty('bash', { pty: true }, vi.fn());
    proxy.sftp(vi.fn());

    expect(reporter.reportChannelError).toHaveBeenCalledWith('ssh-1', ptyError);
    expect(reporter.reportChannelError).toHaveBeenCalledWith('ssh-1', sftpError);
  });
});

describe('SshClientProxy SFTP channel caching', () => {
  it('reuses an open SFTP channel for the same SSH connection', () => {
    const sftp = new EventEmitter();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const client = {
      sftp: vi.fn((callback) => callback(undefined, sftp)),
    };
    const proxy = new SshClientProxy('ssh-1');
    proxy.update(client as never);

    proxy.sftp(firstCallback);
    proxy.sftp(secondCallback);

    expect(client.sftp).toHaveBeenCalledTimes(1);
    expect(firstCallback).toHaveBeenCalledWith(undefined, sftp);
    expect(secondCallback).toHaveBeenCalledWith(undefined, sftp);
  });

  it('opens a new SFTP channel after the cached channel closes', () => {
    const firstSftp = new EventEmitter();
    const secondSftp = new EventEmitter();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const client = {
      sftp: vi
        .fn()
        .mockImplementationOnce((callback) => callback(undefined, firstSftp))
        .mockImplementationOnce((callback) => callback(undefined, secondSftp)),
    };
    const proxy = new SshClientProxy('ssh-1');
    proxy.update(client as never);

    proxy.sftp(firstCallback);
    firstSftp.emit('close');
    proxy.sftp(secondCallback);

    expect(client.sftp).toHaveBeenCalledTimes(2);
    expect(firstCallback).toHaveBeenCalledWith(undefined, firstSftp);
    expect(secondCallback).toHaveBeenCalledWith(undefined, secondSftp);
  });

  it('drains queued callbacks if the connection is invalidated while SFTP is opening', () => {
    const sftp = new EventEmitter();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    let openSftp!: (err: Error | undefined, sftp: EventEmitter) => void;
    const client = {
      sftp: vi.fn((callback) => {
        openSftp = callback;
      }),
    };
    const proxy = new SshClientProxy('ssh-1');
    proxy.update(client as never);

    proxy.sftp(firstCallback);
    proxy.sftp(secondCallback);
    proxy.invalidate();
    openSftp(undefined, sftp);

    expect(client.sftp).toHaveBeenCalledTimes(1);
    expect(firstCallback).toHaveBeenCalledWith(undefined, sftp);
    expect(secondCallback).toHaveBeenCalledWith(undefined, sftp);
  });

  it('drains queued callbacks without caching stale SFTP after the client changes', () => {
    const staleSftp = new EventEmitter();
    const currentSftp = new EventEmitter();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const thirdCallback = vi.fn();
    let openFirstSftp!: (err: Error | undefined, sftp: EventEmitter) => void;
    const firstClient = {
      sftp: vi.fn((callback) => {
        openFirstSftp = callback;
      }),
    };
    const secondClient = {
      sftp: vi.fn((callback) => callback(undefined, currentSftp)),
    };
    const proxy = new SshClientProxy('ssh-1');
    proxy.update(firstClient as never);

    proxy.sftp(firstCallback);
    proxy.sftp(secondCallback);
    proxy.update(secondClient as never);
    openFirstSftp(undefined, staleSftp);
    proxy.sftp(thirdCallback);

    expect(firstClient.sftp).toHaveBeenCalledTimes(1);
    expect(secondClient.sftp).toHaveBeenCalledTimes(1);
    expect(firstCallback).toHaveBeenCalledWith(undefined, staleSftp);
    expect(secondCallback).toHaveBeenCalledWith(undefined, staleSftp);
    expect(thirdCallback).toHaveBeenCalledWith(undefined, currentSftp);
  });

  it('does not report stale SFTP opens as current channel recovery', () => {
    const staleSftp = new EventEmitter();
    const currentSftp = new EventEmitter();
    const reporter = {
      reportChannelError: vi.fn(),
      reportChannelRecovered: vi.fn(),
    };
    let openFirstSftp!: (err: Error | undefined, sftp: EventEmitter) => void;
    const firstClient = {
      sftp: vi.fn((callback) => {
        openFirstSftp = callback;
      }),
    };
    const secondClient = {
      sftp: vi.fn((callback) => callback(undefined, currentSftp)),
    };
    const proxy = new SshClientProxy('ssh-1', reporter);
    proxy.update(firstClient as never);

    proxy.sftp(vi.fn());
    proxy.update(secondClient as never);
    openFirstSftp(undefined, staleSftp);

    expect(reporter.reportChannelRecovered).not.toHaveBeenCalled();

    proxy.sftp(vi.fn());

    expect(reporter.reportChannelRecovered).toHaveBeenCalledWith('ssh-1');
  });
});
