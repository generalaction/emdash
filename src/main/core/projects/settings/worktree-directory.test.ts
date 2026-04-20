import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { canonicalizeWorktreeDirectory, normalizeWorktreeDirectory } from './worktree-directory';

describe('worktree-directory', () => {
  describe('normalizeWorktreeDirectory', () => {
    it('resolves local relative paths from project path', async () => {
      await expect(
        normalizeWorktreeDirectory('worktrees', {
          projectPath: '/repo',
          pathApi: path,
          homeDirectory: '/Users/test',
        })
      ).resolves.toEqual({
        success: true,
        data: path.resolve('/repo', 'worktrees'),
      });
    });

    it('expands local tilde paths from home', async () => {
      await expect(
        normalizeWorktreeDirectory('~/worktrees', {
          projectPath: '/repo',
          pathApi: path,
          homeDirectory: '/Users/test',
        })
      ).resolves.toEqual({
        success: true,
        data: path.resolve('/Users/test', 'worktrees'),
      });
    });

    it('resolves ssh relative paths with posix semantics', async () => {
      await expect(
        normalizeWorktreeDirectory('worktrees', {
          projectPath: '/remote/repo',
          pathApi: path.posix,
        })
      ).resolves.toEqual({
        success: true,
        data: '/remote/repo/worktrees',
      });
    });

    it('rejects tilde paths when home cannot be resolved', async () => {
      await expect(
        normalizeWorktreeDirectory('~/worktrees', {
          projectPath: '/remote/repo',
          pathApi: path.posix,
        })
      ).resolves.toEqual({
        success: false,
        error: { type: 'invalid-worktree-directory' },
      });
    });

    it('expands ssh tilde paths with async home resolver', async () => {
      await expect(
        normalizeWorktreeDirectory('~/worktrees', {
          projectPath: '/remote/repo',
          pathApi: path.posix,
          resolveHomeDirectory: async () => '/home/ubuntu',
        })
      ).resolves.toEqual({
        success: true,
        data: '/home/ubuntu/worktrees',
      });
    });
  });

  describe('canonicalizeWorktreeDirectory', () => {
    it('creates and canonicalizes directory through fs provider', async () => {
      const fs = {
        mkdir: vi.fn().mockResolvedValue(undefined),
        realPath: vi.fn().mockResolvedValue('/canonical/path'),
      };

      const resolved = await canonicalizeWorktreeDirectory('/input/path', fs);
      expect(resolved).toEqual({
        success: true,
        data: '/canonical/path',
      });
      expect(fs.mkdir).toHaveBeenCalledWith('/input/path', { recursive: true });
      expect(fs.realPath).toHaveBeenCalledWith('/input/path');
    });
  });
});
