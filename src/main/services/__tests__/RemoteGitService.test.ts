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
        'git commit -m \'Fix bug in "authentication" module\'',
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

  describe('getStatusDetailed', () => {
    it('should return empty array for non-git directory', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      } as ExecResult);

      const result = await service.getStatusDetailed('conn-1', '/home/user/project');
      expect(result).toEqual([]);
    });

    it('should return empty array for clean repo', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 } as ExecResult) // rev-parse
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult); // status

      const result = await service.getStatusDetailed('conn-1', '/home/user/project');
      expect(result).toEqual([]);
    });

    it('should parse status with additions/deletions from numstat', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 } as ExecResult) // rev-parse
        .mockResolvedValueOnce({
          stdout: ' M src/app.ts\nA  src/new.ts\n?? untracked.txt\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult) // status
        .mockResolvedValueOnce({
          stdout: '5\t2\tsrc/new.ts\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult) // numstat --cached
        .mockResolvedValueOnce({
          stdout: '10\t3\tsrc/app.ts\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult); // numstat (unstaged)

      const result = await service.getStatusDetailed('conn-1', '/home/user/project');

      expect(result).toHaveLength(3);

      const appTs = result.find((c) => c.path === 'src/app.ts');
      expect(appTs).toBeDefined();
      expect(appTs!.status).toBe('modified');
      expect(appTs!.additions).toBe(10);
      expect(appTs!.deletions).toBe(3);
      expect(appTs!.isStaged).toBe(false);

      const newTs = result.find((c) => c.path === 'src/new.ts');
      expect(newTs).toBeDefined();
      expect(newTs!.status).toBe('added');
      expect(newTs!.isStaged).toBe(true);
      expect(newTs!.additions).toBe(5);
      expect(newTs!.deletions).toBe(2);

      const untracked = result.find((c) => c.path === 'untracked.txt');
      expect(untracked).toBeDefined();
      expect(untracked!.status).toBe('added');
      expect(untracked!.isStaged).toBe(false);
    });

    it('should batch line-count for untracked files', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 } as ExecResult) // rev-parse
        .mockResolvedValueOnce({
          stdout: '?? file1.txt\n?? file2.txt\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult) // status
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // numstat --cached
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // numstat
        .mockResolvedValueOnce({
          stdout: '42\n100\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult); // wc -l batch

      const result = await service.getStatusDetailed('conn-1', '/home/user/project');

      expect(result).toHaveLength(2);
      expect(result[0].additions).toBe(42);
      expect(result[1].additions).toBe(100);
    });

    it('should handle renamed files', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: 'true', stderr: '', exitCode: 0 } as ExecResult)
        .mockResolvedValueOnce({
          stdout: 'R  old.ts -> new.ts\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult)
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult)
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      const result = await service.getStatusDetailed('conn-1', '/home/user/project');

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('new.ts');
      expect(result[0].status).toBe('renamed');
      expect(result[0].isStaged).toBe(true);
    });
  });

  describe('getFileDiff', () => {
    it('should parse unified diff output', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout:
          'diff --git a/file.ts b/file.ts\nindex abc..def 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n hello\n-old line\n+new line\n world\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getFileDiff('conn-1', '/home/user/project', 'file.ts');

      expect(result.lines).toHaveLength(4);
      expect(result.lines[0]).toEqual({ left: 'hello', right: 'hello', type: 'context' });
      expect(result.lines[1]).toEqual({ left: 'old line', type: 'del' });
      expect(result.lines[2]).toEqual({ right: 'new line', type: 'add' });
      expect(result.lines[3]).toEqual({ left: 'world', right: 'world', type: 'context' });
    });

    it('should handle untracked file (no diff, read content)', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // empty diff
        .mockResolvedValueOnce({
          stdout: 'line1\nline2\nline3\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult); // cat fallback

      const result = await service.getFileDiff('conn-1', '/home/user/project', 'newfile.txt');

      expect(result.lines.length).toBeGreaterThan(0);
      expect(result.lines[0].type).toBe('add');
    });

    it('should handle deleted file (show HEAD content)', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // empty diff
        .mockResolvedValueOnce({
          stdout: '__EMDASH_TOO_LARGE__',
          stderr: '',
          exitCode: 0,
        } as ExecResult) // cat returns too large marker
        .mockResolvedValueOnce({
          stdout: 'old content\nwas here\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult); // git show HEAD:file

      const result = await service.getFileDiff('conn-1', '/home/user/project', 'deleted.txt');

      expect(result.lines.length).toBeGreaterThan(0);
      expect(result.lines[0].type).toBe('del');
    });

    it('should return empty lines when all fallbacks fail', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult)
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 } as ExecResult)
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 } as ExecResult);

      const result = await service.getFileDiff('conn-1', '/home/user/project', 'ghost.txt');
      expect(result.lines).toEqual([]);
    });
  });

  describe('stageFile', () => {
    it('should stage a file via git add', async () => {
      mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      await service.stageFile('conn-1', '/home/user/project', 'src/app.ts');

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git add -- 'src/app.ts'",
        '/home/user/project'
      );
    });

    it('should throw on failure', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '',
        stderr: 'fatal: pathspec not found',
        exitCode: 128,
      } as ExecResult);

      await expect(
        service.stageFile('conn-1', '/home/user/project', 'nonexistent.ts')
      ).rejects.toThrow('Failed to stage file');
    });

    it('should escape special characters in file path', async () => {
      mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      await service.stageFile('conn-1', '/home/user/project', "file with spaces & 'quotes'.ts");

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        expect.stringContaining('git add --'),
        '/home/user/project'
      );
    });
  });

  describe('stageAllFiles', () => {
    it('should run git add -A', async () => {
      mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      await service.stageAllFiles('conn-1', '/home/user/project');

      expect(mockExecuteCommand).toHaveBeenCalledWith('conn-1', 'git add -A', '/home/user/project');
    });
  });

  describe('unstageFile', () => {
    it('should run git reset HEAD', async () => {
      mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      await service.unstageFile('conn-1', '/home/user/project', 'src/app.ts');

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git reset HEAD -- 'src/app.ts'",
        '/home/user/project'
      );
    });
  });

  describe('revertFile', () => {
    it('should delete untracked file when not in HEAD', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'fatal: Not a valid object name',
          exitCode: 128,
        } as ExecResult) // cat-file -e fails
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult); // rm -f

      const result = await service.revertFile('conn-1', '/home/user/project', 'newfile.txt');

      expect(result.action).toBe('reverted');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "rm -f -- 'newfile.txt'",
        '/home/user/project'
      );
    });

    it('should checkout from HEAD for tracked file', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // cat-file -e succeeds
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult); // checkout HEAD

      const result = await service.revertFile('conn-1', '/home/user/project', 'existing.ts');

      expect(result.action).toBe('reverted');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git checkout HEAD -- 'existing.ts'",
        '/home/user/project'
      );
    });

    it('should throw when checkout fails', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // cat-file
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'error: pathspec did not match',
          exitCode: 1,
        } as ExecResult); // checkout fails

      await expect(service.revertFile('conn-1', '/home/user/project', 'broken.ts')).rejects.toThrow(
        'Failed to revert file'
      );
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: 'feature/my-branch\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getCurrentBranch('conn-1', '/home/user/project');
      expect(result).toBe('feature/my-branch');
    });

    it('should return empty string for detached HEAD', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: '\n',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.getCurrentBranch('conn-1', '/home/user/project');
      expect(result).toBe('');
    });
  });

  describe('push', () => {
    it('should run git push', async () => {
      mockExecuteCommand.mockResolvedValue({
        stdout: 'Everything up-to-date',
        stderr: '',
        exitCode: 0,
      } as ExecResult);

      const result = await service.push('conn-1', '/home/user/project');

      expect(mockExecuteCommand).toHaveBeenCalledWith('conn-1', 'git push', '/home/user/project');
      expect(result.exitCode).toBe(0);
    });

    it('should set upstream when requested', async () => {
      mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      await service.push('conn-1', '/home/user/project', 'feature-branch', true);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git push --set-upstream origin 'feature-branch'",
        '/home/user/project'
      );
    });
  });

  describe('getBranchStatus', () => {
    it('should return branch status with ahead/behind', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({
          stdout: 'feature-branch\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult) // branch --show-current
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 } as ExecResult) // gh fails
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '', exitCode: 0 } as ExecResult) // remote show origin
        .mockResolvedValueOnce({
          stdout: '3\t5\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult); // rev-list

      const result = await service.getBranchStatus('conn-1', '/home/user/project');

      expect(result.branch).toBe('feature-branch');
      expect(result.defaultBranch).toBe('main');
      expect(result.behind).toBe(3);
      expect(result.ahead).toBe(5);
    });
  });

  describe('renameBranch', () => {
    it('should rename local branch', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 } as ExecResult) // no remote tracking
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 } as ExecResult) // ls-remote empty
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult); // branch -m

      const result = await service.renameBranch(
        'conn-1',
        '/home/user/project',
        'old-name',
        'new-name'
      );

      expect(result.remotePushed).toBe(false);
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        "git branch -m 'old-name' 'new-name'",
        '/home/user/project'
      );
    });

    it('should update remote when branch was pushed', async () => {
      mockExecuteCommand
        .mockResolvedValueOnce({
          stdout: 'origin\n',
          stderr: '',
          exitCode: 0,
        } as ExecResult) // remote tracking
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // branch -m
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult) // push --delete
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as ExecResult); // push -u

      const result = await service.renameBranch(
        'conn-1',
        '/home/user/project',
        'old-name',
        'new-name'
      );

      expect(result.remotePushed).toBe(true);
    });
  });

  describe('execGh and execGit', () => {
    it('should run gh commands with correct cwd', async () => {
      mockExecuteCommand.mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0 } as ExecResult);

      await service.execGh('conn-1', '/home/user/project', 'pr view --json number');

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        'gh pr view --json number',
        '/home/user/project'
      );
    });

    it('should run git commands with correct cwd', async () => {
      mockExecuteCommand.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      await service.execGit('conn-1', '/home/user/project', 'status -sb');

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'conn-1',
        'git status -sb',
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
