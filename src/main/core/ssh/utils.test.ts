import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { resolveRemoteHome } from './utils';

function makeCtx(stdout: string): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec: vi.fn().mockResolvedValue({ stdout, stderr: '' }),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IExecutionContext;
}

describe('resolveRemoteHome', () => {
  it('returns trimmed remote home', async () => {
    const ctx = makeCtx(' /home/ubuntu \n');
    await expect(resolveRemoteHome(ctx)).resolves.toBe('/home/ubuntu');
    expect(ctx.exec).toHaveBeenCalledWith('sh', ['-c', 'printf %s "$HOME"']);
  });

  it('throws when remote home is empty', async () => {
    const ctx = makeCtx('   ');
    await expect(resolveRemoteHome(ctx)).rejects.toThrow('Remote home directory is empty');
  });
});
