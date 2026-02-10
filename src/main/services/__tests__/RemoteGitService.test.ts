import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RemoteGitService, WorktreeInfo, GitStatus } from '../RemoteGitService';
import { SshService } from '../ssh/SshService';
import { ExecResult } from '../../../shared/ssh/types';

// Mock SshService
const mockExecuteCommand = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('../ssh/SshService', () => ({
  SshService: vi.fn().mockImplementation(() => ({
    executeCommand: mockExecuteCommand,
    connect: mockConnect,
    disconnect: mockDisconnect,
  })),
}));

describe('RemoteGitService', () => {
  let service: RemoteGitService;
  let mockSshService: SshService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSshService = new SshService();
    service = new RemoteGitService(mockSshService);
  });

  describe('getStatus', () => {
    it('should parse clean repository status', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '## main...origin/main\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getStatus('conn-1', '/home/user/project');

      expect(result.branch).toBe('main');
      expect(result.isClean).toBe(true);
      expect(result.files).toHaveLength(0);
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        'git status --porcelain -b',
        '/home/user/project'
      );
    });

    it('should parse repository with uncommitted changes', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '## feature-branch\n M modified.ts\n?? untracked.txt\nA  staged.js',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getStatus('conn-1', '/home/user/project');

      expect(result.branch).toBe('feature-branch');
      expect(result.isClean).toBe(false);
      expect(result.files).toHaveLength(3);
      expect(result.files).toContainEqual({ status: 'M', path: 'modified.ts' });
      expect(result.files).toContainEqual({ status: '??', path: 'untracked.txt' });
      expect(result.files).toContainEqual({ status: 'A', path: 'staged.js' });
    });

    it('should handle ahead/behind status', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '## main...origin/main [ahead 2, behind 1]\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getStatus('conn-1', '/home/user/project');

      expect(result.branch).toBe('main');
    });

    it('should handle detached HEAD', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '## HEAD (no branch)\n M file.txt',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getStatus('conn-1', '/home/user/project');

      expect(result.branch).toBe('HEAD (no branch)');
    });

    it('should throw error when git status fails', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      } as ExecResult);

      await expect(service.getStatus('conn-1', '/home/user/project')).rejects.toThrow(
        'Git status failed: fatal: not a git repository'
      );
    });

    it('should handle unknown branch format', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '##\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getStatus('conn-1', '/home/user/project');

      expect(result.branch).toBe('unknown');
    });
  });

  describe('createWorktree', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T10:30:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should create worktree with default base ref', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: "Preparing worktree (new branch 'task-name-1705314600000')\n",
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.createWorktree('conn-1', '/home/user/project', 'task name');

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        'mkdir -p .emdash/worktrees',
        '/home/user/project'
      );
      // When no baseRef is provided, getDefaultBranch is called first (git rev-parse),
      // then git worktree add is called
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        expect.stringContaining('git worktree add'),
        '/home/user/project'
      );
      expect(result.branch).toContain('task-name');
      expect(result.isMain).toBe(false);
      expect(result.path).toContain('.emdash/worktrees');
    });

    it('should create worktree with custom base ref', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.createWorktree(
        'conn-1',
        '/home/user/project',
        'feature-task',
        'origin/develop'
      );

      expect(mockExecuteCommand).toHaveBeenNthCalledWith(
        2,
        'conn-1',
        expect.stringContaining('origin/develop'),
        '/home/user/project'
      );
    });

    it('should sanitize task name for branch', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.createWorktree(
        'conn-1',
        '/home/user/project',
        'task with spaces & symbols!@#'
      );

      expect(result.branch).toMatch(/^task-with-spaces-/);
      expect(result.branch).not.toContain(' ');
      expect(result.branch).not.toContain('&');
      expect(result.branch).not.toContain('!');
      expect(result.branch).not.toContain('@');
      expect(result.branch).not.toContain('#');
    });

    it('should throw error when worktree creation fails', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // mkdir succeeds
        .mockResolvedValueOnce({ stdout: 'main', stderr: '', exitCode: 0 } as ExecResult) // getDefaultBranch (git rev-parse)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'fatal: A branch named \"test\" already exists',
          exitCode: 128,
        } as ExecResult); // git worktree add fails

      await expect(service.createWorktree('conn-1', '/home/user/project', 'test')).rejects.toThrow(
        'Failed to create worktree: fatal: A branch named'
      );
    });

    it('should construct correct worktree path', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.createWorktree(
        'conn-1',
        '/home/user/repos/myproject',
        'test-task'
      );

      expect(result.path).toContain('/.emdash/worktrees/');
      expect(result.path).toContain('test-task');
    });
  });

  describe('removeWorktree', () => {
    it('should remove worktree successfully', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      await service.removeWorktree(
        'conn-1',
        '/home/user/project',
        '/home/user/project/.emdash/worktrees/test-123'
      );

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git worktree remove '/home/user/project/.emdash/worktrees/test-123' --force",
        '/home/user/project'
      );
    });

    it('should throw error when removal fails', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a valid worktree',
        exitCode: 128,
      } as ExecResult);

      await expect(
        service.removeWorktree('conn-1', '/home/user/project', '/invalid/path')
      ).rejects.toThrow('Failed to remove worktree: fatal: not a valid worktree');
    });

    it('should handle paths with spaces', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      await service.removeWorktree(
        'conn-1',
        '/home/user/my project',
        '/home/user/my project/.emdash/worktrees/test'
      );

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git worktree remove '/home/user/my project/.emdash/worktrees/test' --force",
        '/home/user/my project'
      );
    });
  });

  describe('getBranchList', () => {
    it('should return list of branches', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: 'main\ndevelop\nfeature/new-thing\n* current-branch\n  remotes/origin/main\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getBranchList('conn-1', '/home/user/project');

      expect(result).toHaveLength(5);
      expect(result).toContain('main');
      expect(result).toContain('develop');
      expect(result).toContain('feature/new-thing');
      expect(result).toContain('* current-branch');
      expect(result).toContain('  remotes/origin/main');
    });

    it('should return empty array when git command fails', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      } as ExecResult);

      const result = await service.getBranchList('conn-1', '/home/user/project');

      expect(result).toEqual([]);
    });

    it('should filter out empty lines', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: 'main\n\ndevelop\n\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getBranchList('conn-1', '/home/user/project');

      expect(result).toHaveLength(2);
      expect(result).toContain('main');
      expect(result).toContain('develop');
    });
  });

  describe('commit', () => {
    it('should commit with message', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '[main abc1234] Test commit\n 1 file changed, 1 insertion(+)\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.commit('conn-1', '/home/user/project', 'Test commit');

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git commit -m 'Test commit'",
        '/home/user/project'
      );
      expect(result.exitCode).toBe(0);
    });

    it('should stage and commit specific files', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '[main abc1234] Commit specific files\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.commit('conn-1', '/home/user/project', 'Commit specific files', [
        'file1.ts',
        'file2.ts',
      ]);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git add 'file1.ts' 'file2.ts' && git commit -m 'Commit specific files'",
        '/home/user/project'
      );
    });

    it('should escape quotes in commit message', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      await service.commit('conn-1', '/home/user/project', 'Fix bug in "authentication" module');

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git commit -m 'Fix bug in \"authentication\" module'",
        '/home/user/project'
      );
    });

    it('should handle multiline commit messages', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      await service.commit('conn-1', '/home/user/project', 'First line\n\nSecond paragraph');

      // The message should be properly escaped
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        expect.stringContaining('git commit'),
        '/home/user/project'
      );
    });

    it('should handle empty files array', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      await service.commit('conn-1', '/home/user/project', 'Commit message', []);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git commit -m 'Commit message'",
        '/home/user/project'
      );
    });

    it('should handle commit failure', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: 'nothing to commit, working tree clean',
        exitCode: 1,
      } as ExecResult);

      const result = await service.commit('conn-1', '/home/user/project', 'Empty commit');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('nothing to commit, working tree clean');
    });

    it('should commit files with special characters in names', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      await service.commit('conn-1', '/home/user/project', 'Special files', [
        'file with spaces.ts',
      ]);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        expect.stringContaining("git add 'file with spaces.ts'"),
        '/home/user/project'
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle full workflow: create, check status, commit, remove', async () => {
      // Create worktree
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult); // worktree add

      const worktree = await service.createWorktree('conn-1', '/home/user/project', 'feature');

      // Check status (clean)
      mockExecuteCommand.mockResolvedValue({
        stdout: `## ${worktree.branch}\n`,
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const status = await service.getStatus('conn-1', worktree.path);
      expect(status.isClean).toBe(true);

      // Commit
      mockExecuteCommand.mockResolvedValue({
        stdout: `[${worktree.branch} abc1234] Initial commit\n`,
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const commitResult = await service.commit('conn-1', worktree.path, 'Initial commit');
      expect(commitResult.exitCode).toBe(0);

      // Remove worktree
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      await expect(
        service.removeWorktree('conn-1', '/home/user/project', worktree.path)
      ).resolves.not.toThrow();
    });
  });
});
