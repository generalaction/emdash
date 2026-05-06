import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { cloneRepository } from './git-repo-utils';

function makeContext(): IExecutionContext & {
  exec: ReturnType<typeof vi.fn>;
} {
  return {
    root: '/repo-parent',
    supportsLocalSpawn: false,
    exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IExecutionContext & { exec: ReturnType<typeof vi.fn> };
}

describe('cloneRepository', () => {
  it('passes logical git command to the execution context', async () => {
    const ctx = makeContext();

    await cloneRepository('https://github.com/example/repo.git', '/work/repo', ctx);

    expect(ctx.exec).toHaveBeenCalledWith('git', [
      'clone',
      'https://github.com/example/repo.git',
      '/work/repo',
    ]);
  });
});
