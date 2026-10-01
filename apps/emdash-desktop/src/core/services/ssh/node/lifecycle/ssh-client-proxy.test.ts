import { describe, expect, it, vi } from 'vitest';
import type { SshSession } from '../openssh/session';
import { deferred, fakeSession } from '../openssh/testing/session';
import { SshClientProxy } from './ssh-client-proxy';

const operations = {
  exec: (proxy: SshClientProxy, signal?: AbortSignal) =>
    proxy.exec({ command: 'pwd', args: [] }, { signal }),
  script: (proxy: SshClientProxy, signal?: AbortSignal) => proxy.execScript('pwd', { signal }),
  stream: (proxy: SshClientProxy, signal?: AbortSignal) =>
    proxy.openStream({ command: 'cat', args: [] }, { signal }),
  forward: (proxy: SshClientProxy, signal?: AbortSignal) => proxy.forwardPort(3000, { signal }),
};

describe.each(Object.entries(operations))('%s generation ownership', (_name, operation) => {
  it('rejects an unavailable connection', async () => {
    await expect(operation(new SshClientProxy('host'))).rejects.toThrow('not available');
  });
  it('does not start work after caller cancellation', async () => {
    const session = fakeSession();
    const proxy = new SshClientProxy('host');
    proxy.update(session);
    await expect(operation(proxy, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow(
      'cancelled'
    );
    expect(session.exec).not.toHaveBeenCalled();
    expect(session.openStream).not.toHaveBeenCalled();
    expect(session.forwardPort).not.toHaveBeenCalled();
  });
  it.each(['caller', 'invalidate', 'replace'] as const)(
    'revokes the original operation on %s',
    async (cause) => {
      const cancelled = (_value: unknown, options?: { signal?: AbortSignal }): Promise<never> =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          });
        });
      const session: SshSession = {
        ...fakeSession(),
        exec: cancelled,
        openStream: cancelled,
        forwardPort: cancelled,
      };
      const proxy = new SshClientProxy('host');
      proxy.update(session);
      const caller = new AbortController();
      const pending = operation(proxy, caller.signal);
      const rejected = expect(pending).rejects.toThrow();
      if (cause === 'caller') caller.abort(new Error('caller cancelled'));
      else if (cause === 'invalidate') proxy.invalidate();
      else proxy.update(fakeSession());
      await rejected;
      expect(proxy.isConnected).toBe(cause !== 'invalidate');
    }
  );
});

it('keeps a pending operation attached to its original session after replacement', async () => {
  const old = fakeSession();
  const next = fakeSession();
  const result = deferred<{ stdout: string; stderr: string; exitCode: number }>();
  old.exec = vi.fn(() => result.promise);
  const proxy = new SshClientProxy('host');
  proxy.update(old);
  const pending = proxy.execScript('old');
  proxy.update(next);
  await proxy.execScript('new');
  expect(next.exec).toHaveBeenCalledWith('new', expect.anything());
  expect(old.exec).toHaveBeenCalledWith('old', expect.anything());
  result.resolve({ stdout: 'old', stderr: '', exitCode: 0 });
  await pending;
});
