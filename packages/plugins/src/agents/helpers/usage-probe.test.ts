import type * as ChildProcessModule from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type * as ExecModule from '@emdash/core/primitives/exec/node';
import { createChildProcessTreeTerminator } from '@emdash/core/primitives/exec/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeCodexUsage } from '../impl/codex/usage';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  spawn: vi.fn(),
}));
vi.mock('@emdash/core/primitives/exec/node', async (original) => ({
  ...(await original<typeof ExecModule>()),
  createChildProcessTreeTerminator: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());

function peer(respond = true) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const requests: { method: string; params?: unknown }[] = [];
  child.stdin.on('data', (chunk) => {
    const message = JSON.parse(String(chunk));
    requests.push(message);
    if (!respond || message.id === undefined) return;
    const result =
      message.method === 'initialize'
        ? {}
        : message.method === 'account/read'
          ? { account: { type: 'chatgpt', email: 'test@example.com', planType: 'pro' } }
          : { accountId: 'account-1', rateLimits: { primary: { usedPercent: 30 } } };
    queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, result }) + '\n'));
  });
  const terminate = vi.fn(async () => {
    child.emit('exit', 0);
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  vi.mocked(createChildProcessTreeTerminator).mockReturnValue({
    terminate,
  } as unknown as ReturnType<typeof createChildProcessTreeTerminator>);
  return { requests, terminate };
}

describe('Codex usage probe transport', () => {
  it('only initializes and reads account/limits, and terminates its subprocess', async () => {
    const { requests, terminate } = peer();
    const result = await probeCodexUsage({
      cli: '/path with spaces/codex',
      cwd: '/home/test',
      env: { PATH: '/bin' },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: 'ready',
      account: { id: 'account-1', email: 'test@example.com' },
    });
    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'initialized',
      'account/read',
      'account/rateLimits/read',
    ]);
    expect(spawn).toHaveBeenCalledWith(
      '/path with spaces/codex',
      ['app-server'],
      expect.objectContaining({ cwd: '/home/test', env: { PATH: '/bin' } })
    );
    expect(terminate).toHaveBeenCalledOnce();
  });
  it('cancels pending RPCs and cleans up when the observing scope is aborted', async () => {
    const { terminate } = peer(false);
    const controller = new AbortController();
    const probe = probeCodexUsage({
      cli: 'codex',
      cwd: '/home/test',
      env: {},
      signal: controller.signal,
    });
    controller.abort();
    await expect(probe).rejects.toThrow();
    expect(terminate).toHaveBeenCalled();
  });
});
