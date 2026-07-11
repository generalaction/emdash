import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteShellProfile } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { buildSshCommand, SshExecutionContext } from './ssh-execution-context';

class FakeChannel extends EventEmitter {
  stderr = new EventEmitter();
  destroy = vi.fn();
}

type ExecCallback = (error: Error | undefined, channel: FakeChannel) => void;

function makeProxy(
  execImpl: (command: string, callback: ExecCallback) => void,
  profile: RemoteShellProfile = { shell: '/bin/sh', env: {} }
): SshClientProxy {
  return {
    exec: vi.fn(execImpl),
    getRemoteShellProfile: vi.fn(async () => profile),
    refreshRemoteShellProfile: vi.fn(async () => profile),
  } as unknown as SshClientProxy;
}

function observe<T>(
  promise: Promise<T>
): Promise<{ kind: 'resolved' } | { kind: 'rejected'; error: unknown }> {
  return promise.then(
    () => ({ kind: 'resolved' as const }),
    (error: unknown) => ({ kind: 'rejected' as const, error })
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('buildSshCommand', () => {
  it('uses the shared remote shell command builder for fallback SSH exec commands', () => {
    const command = buildSshCommand('/workspace/project', 'which', ['claude']);

    expect(command).toBe(
      "'/bin/sh' -c 'cd '\\''/workspace/project'\\'' && '\\''which'\\'' '\\''claude'\\'''"
    );
  });

  it('uses the remote shell profile and cwd when building SSH exec commands', () => {
    const profile: RemoteShellProfile = {
      shell: '/bin/zsh',
      env: {
        PATH: '/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin',
      },
    };

    const command = buildSshCommand('/workspace/project', 'which', ['claude'], profile);

    expect(command).toBe(
      "'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; cd '\\''/workspace/project'\\'' && '\\''which'\\'' '\\''claude'\\'''"
    );
  });

  it('disables interactive Git credential prompts for SSH exec commands', () => {
    const command = buildSshCommand('/workspace/project', 'git', ['fetch', 'origin']);

    expect(command).toBe(
      "'/bin/sh' -c 'cd '\\''/workspace/project'\\'' && GIT_ASKPASS='\\'''\\'' GIT_TERMINAL_PROMPT='\\''0'\\'' GCM_INTERACTIVE='\\''never'\\'' SSH_ASKPASS='\\'''\\'' '\\''git'\\'' '\\''fetch'\\'' '\\''origin'\\'''"
    );
  });

  it('uses the selected remote Git executable when provided', () => {
    const command = buildSshCommand(
      '/workspace/project',
      'git',
      ['status'],
      undefined,
      '/opt/homebrew/bin/git'
    );

    expect(command).toBe(
      "'/bin/sh' -c 'cd '\\''/workspace/project'\\'' && GIT_ASKPASS='\\'''\\'' GIT_TERMINAL_PROMPT='\\''0'\\'' GCM_INTERACTIVE='\\''never'\\'' SSH_ASKPASS='\\'''\\'' '\\''/opt/homebrew/bin/git'\\'' '\\''status'\\'''"
    );
  });

  it('quotes hostile executable, root, arguments, and explicit environment values', () => {
    const command = buildSshCommand(
      "/workspace/it's $(root)",
      'tool; touch /tmp/pwn',
      ['arg with spaces', '$(touch /tmp/arg)', "quo'te", 'line\nbreak'],
      { shell: '/bin/zsh', env: { EMDASH_TASK_ID: 'stale' } },
      undefined,
      {
        EMDASH_TASK_ID: "task-1'; touch /tmp/env; '",
        'INVALID-NAME': 'ignored',
      }
    );

    expect(command).toContain("'\\''tool; touch /tmp/pwn'\\''");
    expect(command).toContain("'\\''$(touch /tmp/arg)'\\''");
    const staleIndex = command.indexOf("export EMDASH_TASK_ID='\\''stale'\\''");
    const trustedIndex = command.lastIndexOf('export EMDASH_TASK_ID=');
    expect(staleIndex).toBeGreaterThanOrEqual(0);
    expect(trustedIndex).toBeGreaterThan(staleIndex);
    expect(command.slice(trustedIndex)).toContain('task-1');
    expect(command).not.toContain('INVALID-NAME');
  });
});

describe('SshExecutionContext.exec', () => {
  it('does not forward unrelated local environment values', async () => {
    const original = process.env.EMDASH_LANE_R_SECRET;
    process.env.EMDASH_LANE_R_SECRET = 'must-not-cross-ssh';
    const channel = new FakeChannel();
    let sentCommand = '';
    const proxy = makeProxy((command, callback) => {
      sentCommand = command;
      callback(undefined, channel);
      queueMicrotask(() => channel.emit('close', 0));
    });
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });

    try {
      await ctx.exec('node', ['script.js'], { env: { EMDASH_TASK_ID: 'task-1' } });
    } finally {
      if (original === undefined) delete process.env.EMDASH_LANE_R_SECRET;
      else process.env.EMDASH_LANE_R_SECRET = original;
    }

    expect(sentCommand).toContain('EMDASH_TASK_ID');
    expect(sentCommand).not.toContain('must-not-cross-ssh');
  });

  it('rejects an abort before the SSH exec callback and destroys a late channel', async () => {
    let callback!: ExecCallback;
    const channel = new FakeChannel();
    const proxy = makeProxy((_command, next) => {
      callback = next;
    });
    const controller = new AbortController();
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });
    let settled = false;
    const observed = observe(ctx.exec('node', [], { signal: controller.signal })).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    const settledBeforeCallback = settled;
    callback(undefined, channel);
    channel.emit('close', 0);
    const outcome = await observed;

    expect(settledBeforeCallback).toBe(true);
    expect(outcome).toMatchObject({ kind: 'rejected', error: { name: 'AbortError' } });
    expect(channel.destroy).toHaveBeenCalledOnce();
  });

  it('destroys the active channel and ignores late events after abort', async () => {
    const channel = new FakeChannel();
    const proxy = makeProxy((_command, callback) => callback(undefined, channel));
    const controller = new AbortController();
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });
    const observed = observe(ctx.exec('node', [], { signal: controller.signal }));
    await Promise.resolve();

    controller.abort();
    channel.emit('data', Buffer.from('late stdout'));
    channel.stderr.emit('data', Buffer.from('late stderr'));
    channel.emit('close', 0);

    await expect(observed).resolves.toMatchObject({
      kind: 'rejected',
      error: { name: 'AbortError' },
    });
    expect(channel.destroy).toHaveBeenCalledOnce();
    expect(channel.listenerCount('data')).toBe(0);
    expect(channel.stderr.listenerCount('data')).toBe(0);
  });

  it('times out while waiting for the SSH exec callback and destroys a late channel', async () => {
    vi.useFakeTimers();
    let callback!: ExecCallback;
    const channel = new FakeChannel();
    const proxy = makeProxy((_command, next) => {
      callback = next;
    });
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });
    let settled = false;
    const observed = observe(ctx.exec('node', [], { timeout: 50 })).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(50);
    const settledBeforeCallback = settled;
    callback(undefined, channel);
    channel.emit('close', 0);
    const outcome = await observed;

    expect(settledBeforeCallback).toBe(true);
    expect(outcome).toMatchObject({
      kind: 'rejected',
      error: { code: 'ETIMEDOUT', name: 'TimeoutError' },
    });
    expect(channel.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['stdout', (channel: FakeChannel, value: Buffer) => channel.emit('data', value)],
    ['stderr', (channel: FakeChannel, value: Buffer) => channel.stderr.emit('data', value)],
  ] as const)('rejects when %s exceeds maxBuffer', async (_stream, emitChunk) => {
    const channel = new FakeChannel();
    const proxy = makeProxy((_command, callback) => callback(undefined, channel));
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });
    const observed = observe(ctx.exec('node', [], { maxBuffer: 4 }));
    await Promise.resolve();

    emitChunk(channel, Buffer.from('abcde'));
    channel.emit('close', 0);
    const outcome = await observed;

    expect(outcome).toMatchObject({
      kind: 'rejected',
      error: { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' },
    });
    expect(channel.destroy).toHaveBeenCalledOnce();
  });

  it('accepts multibyte output exactly at the maxBuffer byte boundary', async () => {
    const channel = new FakeChannel();
    const proxy = makeProxy((_command, callback) => callback(undefined, channel));
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });
    const result = ctx.exec('node', [], { maxBuffer: 4 });
    await Promise.resolve();

    channel.emit('data', Buffer.from('éé'));
    channel.emit('close', 0);

    await expect(result).resolves.toEqual({ stdout: 'éé', stderr: '' });
    expect(channel.destroy).not.toHaveBeenCalled();
  });

  it('rejects a negative maxBuffer before opening an SSH channel', async () => {
    const proxy = makeProxy(vi.fn());
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });

    await expect(ctx.exec('node', [], { maxBuffer: -1 })).rejects.toMatchObject({
      code: 'ERR_OUT_OF_RANGE',
      name: 'RangeError',
    });
    expect(proxy.exec).not.toHaveBeenCalled();
  });

  it('reports bounded output and the remote non-zero exit code', async () => {
    const channel = new FakeChannel();
    const proxy = makeProxy((_command, callback) => callback(undefined, channel));
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });
    const result = observe(ctx.exec('node', [], { maxBuffer: 32 }));
    await Promise.resolve();

    channel.emit('data', Buffer.from('stdout'));
    channel.stderr.emit('data', Buffer.from('stderr'));
    channel.emit('close', 23);

    await expect(result).resolves.toMatchObject({
      kind: 'rejected',
      error: { exitCode: 23, stderr: 'stderr', stdout: 'stdout' },
    });
    expect(channel.listenerCount('data')).toBe(0);
    expect(channel.stderr.listenerCount('data')).toBe(0);
  });

  it('destroys the channel and clears owned listeners and timers after a stream error', async () => {
    vi.useFakeTimers();
    const channel = new FakeChannel();
    const proxy = makeProxy((_command, callback) => callback(undefined, channel));
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });
    const result = observe(ctx.exec('node', [], { timeout: 1_000 }));
    await Promise.resolve();

    channel.emit('error', new Error('channel reset'));

    await expect(result).resolves.toMatchObject({
      kind: 'rejected',
      error: { message: 'channel reset' },
    });
    expect(channel.destroy).toHaveBeenCalledOnce();
    expect(channel.listenerCount('data')).toBe(0);
    expect(channel.listenerCount('close')).toBe(0);
    expect(channel.listenerCount('error')).toBe(0);
    expect(channel.stderr.listenerCount('data')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows repeated dispose while aborting an active command exactly once', async () => {
    const channel = new FakeChannel();
    const proxy = makeProxy((_command, callback) => callback(undefined, channel));
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });
    const result = observe(ctx.exec('node'));
    await Promise.resolve();

    ctx.dispose();
    ctx.dispose();
    channel.emit('close', 0);

    await expect(result).resolves.toMatchObject({
      kind: 'rejected',
      error: { name: 'AbortError' },
    });
    expect(channel.destroy).toHaveBeenCalledOnce();
  });

  it('treats a missing remote exit code as an execution failure', async () => {
    const channel = new FakeChannel();
    const proxy = makeProxy((_command, callback) => callback(undefined, channel));
    const ctx = new SshExecutionContext(proxy, { root: '/remote/repo' });
    const result = observe(ctx.exec('node'));
    await Promise.resolve();
    channel.emit('close', null);

    await expect(result).resolves.toMatchObject({
      kind: 'rejected',
      error: { exitCode: null },
    });
  });
});
