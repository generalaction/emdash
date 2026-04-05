import { describe, it, expect, vi } from 'vitest';
import { getDefaultBranchFallback } from '../../../main/services/gitPlatformOperations/shared';
import type { CommandExecutor } from '../../../main/services/gitPlatformOperations/types';

function mockExecutor(overrides: Partial<CommandExecutor> = {}): CommandExecutor {
  return {
    cwd: '/fake',
    exec: vi.fn().mockRejectedValue(new Error('not implemented')),
    execGit: vi.fn().mockRejectedValue(new Error('not implemented')),
    execPlatformCli: vi.fn().mockRejectedValue(new Error('not implemented')),
    ...overrides,
  };
}

describe('getDefaultBranchFallback', () => {
  it('returns branch from git remote show origin', async () => {
    const executor = mockExecutor({
      exec: vi.fn().mockResolvedValue({ stdout: '  main\n', stderr: '' }),
    });
    const result = await getDefaultBranchFallback(executor);
    expect(result).toBe('main');
  });

  it('falls back to symbolic-ref when remote show fails', async () => {
    const executor = mockExecutor({
      exec: vi.fn().mockRejectedValue(new Error('fail')),
      execGit: vi.fn().mockResolvedValue({ stdout: 'origin/develop\n', stderr: '' }),
    });
    const result = await getDefaultBranchFallback(executor);
    expect(result).toBe('develop');
  });

  it('returns main when all fallbacks fail', async () => {
    const executor = mockExecutor({
      exec: vi.fn().mockRejectedValue(new Error('fail')),
      execGit: vi.fn().mockRejectedValue(new Error('fail')),
    });
    const result = await getDefaultBranchFallback(executor);
    expect(result).toBe('main');
  });
});
