import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { resolveCommandPath } from './probe';

function makeCtx(
  isWindows: boolean,
  handler: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    isWindows,
    exec: vi.fn().mockImplementation(handler),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IExecutionContext;
}

describe('resolveCommandPath', () => {
  it('uses `which` on POSIX hosts', async () => {
    const ctx = makeCtx(false, async () => ({ stdout: '/usr/local/bin/claude\n', stderr: '' }));

    const path = await resolveCommandPath('claude', ctx);

    expect(ctx.exec).toHaveBeenCalledWith('which', ['claude'], { timeout: 5000 });
    expect(path).toBe('/usr/local/bin/claude');
  });

  it('uses `where` on Windows hosts', async () => {
    const ctx = makeCtx(true, async () => ({ stdout: 'C:\\bin\\claude.exe\n', stderr: '' }));

    const path = await resolveCommandPath('claude', ctx);

    expect(ctx.exec).toHaveBeenCalledWith('where', ['claude'], { timeout: 5000 });
    expect(path).toBe('C:\\bin\\claude.exe');
  });

  // Regression: a Windows client connected to a POSIX remote over SSH must run
  // `which` on the remote host, not `where`. The resolve command follows the
  // execution context's platform, never the local client's. See issue #2474.
  it('uses `which` for a POSIX SSH context even when the client is Windows', async () => {
    const ctx = makeCtx(false, async () => ({
      stdout: '/home/dev/.local/bin/claude\n',
      stderr: '',
    }));

    const path = await resolveCommandPath('claude', ctx);

    expect(ctx.exec).toHaveBeenCalledWith('which', ['claude'], { timeout: 5000 });
    expect(ctx.exec).not.toHaveBeenCalledWith('where', expect.anything(), expect.anything());
    expect(path).toBe('/home/dev/.local/bin/claude');
  });

  it('returns the first match and trims surrounding whitespace', async () => {
    const ctx = makeCtx(true, async () => ({
      stdout: 'C:\\bin\\claude.exe\r\nC:\\other\\claude.exe\r\n',
      stderr: '',
    }));

    const path = await resolveCommandPath('claude', ctx);

    expect(path).toBe('C:\\bin\\claude.exe');
  });

  it('returns null when resolution fails', async () => {
    const ctx = makeCtx(false, async () => {
      throw new Error('not found');
    });

    expect(await resolveCommandPath('claude', ctx)).toBeNull();
  });
});
