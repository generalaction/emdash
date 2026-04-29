import { describe, expect, it, vi } from 'vitest';
import type { ExecFn } from '@main/core/utils/exec';
import { resolveRemoteHome } from './utils';

describe('resolveRemoteHome', () => {
  it('returns trimmed remote home', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: ' /home/ubuntu \n', stderr: '' }) as ExecFn;
    await expect(resolveRemoteHome(exec)).resolves.toBe('/home/ubuntu');
    expect(exec).toHaveBeenCalledWith('sh', ['-c', 'printf %s "$HOME"']);
  });

  it('throws when remote home is empty', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '   ', stderr: '' }) as ExecFn;
    await expect(resolveRemoteHome(exec)).rejects.toThrow('Remote home directory is empty');
  });
});
