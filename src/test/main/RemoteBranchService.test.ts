import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/emdash-test'),
    getName: vi.fn().mockReturnValue('emdash-test'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
  },
}));

// Mock logger
vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// The promisified execFileAsync mock — returns promises directly.
const mockExecFileAsync = vi.fn();

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: () => mockExecFileAsync,
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let RemoteBranchService: typeof import('../../main/services/RemoteBranchService').RemoteBranchService;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let service: InstanceType<typeof RemoteBranchService>;

beforeEach(async () => {
  vi.resetModules();
  mockExecFileAsync.mockReset();

  const mod = await import('../../main/services/RemoteBranchService');
  RemoteBranchService = mod.RemoteBranchService;
  service = new RemoteBranchService();
});

// =========================================================================
// deleteRemoteBranch
// =========================================================================
describe('RemoteBranchService.deleteRemoteBranch', () => {
  it('successfully deletes a remote branch', async () => {
    // First call: git remote → 'origin\n'
    // Second call: git push origin --delete branch → success
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: 'origin\n' })
      .mockResolvedValueOnce({ stdout: '' });

    const result = await service.deleteRemoteBranch('/repo', 'feature/my-branch');

    expect(result.success).toBe(true);
    expect(result.alreadyAbsent).toBe(false);
    expect(result.noRemote).toBe(false);
    expect(result.message).toContain('Deleted remote branch');
  });

  it('strips origin/ prefix from branch name', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: 'origin\n' })
      .mockResolvedValueOnce({ stdout: '' });

    const result = await service.deleteRemoteBranch('/repo', 'origin/feature/test');

    expect(result.success).toBe(true);
    // Verify the git push command was called with the stripped branch name
    const pushCall = mockExecFileAsync.mock.calls[1];
    expect(pushCall[1]).toEqual(['push', 'origin', '--delete', 'feature/test']);
  });

  it('handles "remote ref does not exist" gracefully', async () => {
    const err = Object.assign(new Error('git push failed'), {
      stderr: "error: unable to delete 'feature/old': remote ref does not exist",
    });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'origin\n' }).mockRejectedValueOnce(err);

    const result = await service.deleteRemoteBranch('/repo', 'feature/old');

    expect(result.success).toBe(true);
    expect(result.alreadyAbsent).toBe(true);
    expect(result.message).toContain('already absent');
  });

  it('returns failure for generic "not found" error (not treated as already-absent)', async () => {
    const err = Object.assign(new Error('branch not found'), {
      stderr: 'error: branch not found',
    });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'origin\n' }).mockRejectedValueOnce(err);

    const result = await service.deleteRemoteBranch('/repo', 'feature/gone');

    expect(result.success).toBe(false);
    expect(result.alreadyAbsent).toBe(false);
  });

  it('handles "unknown revision" error gracefully', async () => {
    const err = Object.assign(new Error('unknown revision'), {
      stderr: "fatal: unknown revision 'feature/x'",
    });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'origin\n' }).mockRejectedValueOnce(err);

    const result = await service.deleteRemoteBranch('/repo', 'feature/x');

    expect(result.success).toBe(true);
    expect(result.alreadyAbsent).toBe(true);
  });

  it('returns failure for unexpected git errors', async () => {
    const err = Object.assign(new Error('auth failed'), {
      stderr: 'fatal: Authentication failed for ...',
    });
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'origin\n' }).mockRejectedValueOnce(err);

    const result = await service.deleteRemoteBranch('/repo', 'feature/auth-fail');

    expect(result.success).toBe(false);
    expect(result.alreadyAbsent).toBe(false);
    expect(result.message).toContain('Failed to delete');
  });

  it('skips deletion when no remote is configured', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'upstream\n' }); // No 'origin'

    const result = await service.deleteRemoteBranch('/repo', 'feature/no-origin');

    expect(result.success).toBe(true);
    expect(result.noRemote).toBe(true);
    expect(result.message).toContain('no remote');
  });

  it('skips deletion for local-only repos (empty remote list)', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '' });

    const result = await service.deleteRemoteBranch('/repo', 'feature/local');

    expect(result.success).toBe(true);
    expect(result.noRemote).toBe(true);
  });

  it('handles error when checking remotes', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('not a git repo'));

    const result = await service.deleteRemoteBranch('/not-a-repo', 'feature/test');

    // hasRemote() catches internally → returns false → noRemote=true
    expect(result.success).toBe(true);
    expect(result.noRemote).toBe(true);
  });

  it('returns failure for empty branch name', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'origin\n' });

    const result = await service.deleteRemoteBranch('/repo', '');

    expect(result.success).toBe(false);
    expect(result.message).toContain('empty branch name');
  });

  it('returns failure for branch that becomes empty after stripping prefix', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'origin\n' });

    const result = await service.deleteRemoteBranch('/repo', 'origin/');

    expect(result.success).toBe(false);
    expect(result.message).toContain('empty branch name');
  });

  it('uses custom remote name when provided', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: 'upstream\n' })
      .mockResolvedValueOnce({ stdout: '' });

    const result = await service.deleteRemoteBranch('/repo', 'feature/test', 'upstream');

    expect(result.success).toBe(true);
    const pushCall = mockExecFileAsync.mock.calls[1];
    expect(pushCall[1]).toEqual(['push', 'upstream', '--delete', 'feature/test']);
  });
});

// =========================================================================
// isBranchStale
// =========================================================================
describe('RemoteBranchService.isBranchStale', () => {
  it('returns true when branch last commit is older than threshold', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    mockExecFileAsync.mockResolvedValueOnce({ stdout: oldDate + '\n' });

    const result = await service.isBranchStale('/repo', 'feature/old', 7);

    expect(result).toBe(true);
  });

  it('returns false when branch last commit is newer than threshold', async () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    mockExecFileAsync.mockResolvedValueOnce({ stdout: recentDate + '\n' });

    const result = await service.isBranchStale('/repo', 'feature/recent', 7);

    expect(result).toBe(false);
  });

  it('returns false when date cannot be determined (fail-closed)', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('unknown revision'));

    const result = await service.isBranchStale('/repo', 'feature/gone', 7);

    expect(result).toBe(false);
  });

  it('returns false when git returns empty output (fail-closed)', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '' });

    const result = await service.isBranchStale('/repo', 'feature/empty', 7);

    expect(result).toBe(false);
  });

  it('returns true for exactly the threshold boundary', async () => {
    const exactBoundary = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    mockExecFileAsync.mockResolvedValueOnce({ stdout: exactBoundary + '\n' });

    const result = await service.isBranchStale('/repo', 'feature/edge', 7);

    expect(result).toBe(true);
  });

  it('returns false for invalid date string (fail-closed)', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'not-a-real-date\n' });

    const result = await service.isBranchStale('/repo', 'feature/bad', 7);

    expect(result).toBe(false);
  });
});

// =========================================================================
// evaluateCleanupAction
// =========================================================================
describe('RemoteBranchService.evaluateCleanupAction', () => {
  it('returns "skip" for mode "never"', async () => {
    const result = await service.evaluateCleanupAction('/repo', 'feature/x', 'never', 7);
    expect(result).toBe('skip');
  });

  it('returns "delete" for mode "always"', async () => {
    const result = await service.evaluateCleanupAction('/repo', 'feature/x', 'always', 7);
    expect(result).toBe('delete');
  });

  it('returns "ask" for mode "ask"', async () => {
    const result = await service.evaluateCleanupAction('/repo', 'feature/x', 'ask', 7);
    expect(result).toBe('ask');
  });

  it('returns "delete" for mode "auto" when branch is stale', async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    mockExecFileAsync.mockResolvedValueOnce({ stdout: oldDate + '\n' });

    const result = await service.evaluateCleanupAction('/repo', 'feature/stale', 'auto', 7);
    expect(result).toBe('delete');
  });

  it('returns "skip" for mode "auto" when branch is fresh', async () => {
    const freshDate = new Date().toISOString();
    mockExecFileAsync.mockResolvedValueOnce({ stdout: freshDate + '\n' });

    const result = await service.evaluateCleanupAction('/repo', 'feature/fresh', 'auto', 7);
    expect(result).toBe('skip');
  });

  it('returns "skip" for mode "auto" when branch date is unknown (fail-closed)', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('unknown revision'));

    const result = await service.evaluateCleanupAction('/repo', 'feature/unknown', 'auto', 7);
    expect(result).toBe('skip');
  });

  it('returns "skip" for unknown mode', async () => {
    const result = await service.evaluateCleanupAction(
      '/repo',
      'feature/x',
      'unknown-mode' as any,
      7
    );
    expect(result).toBe('skip');
  });
});
