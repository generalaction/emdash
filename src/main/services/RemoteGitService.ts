import { SshService } from './ssh/SshService';
import { ExecResult } from '../../shared/ssh/types';
import { quoteShellArg } from '../utils/shellEscape';

export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

export interface GitStatusFile {
  status: string;
  path: string;
}

export interface GitStatus {
  branch: string;
  isClean: boolean;
  files: GitStatusFile[];
}

export class RemoteGitService {
  constructor(private sshService: SshService) {}

  private normalizeRemotePath(p: string): string {
    // Remote paths should use forward slashes.
    return p.replace(/\\/g, '/').replace(/\/+$/g, '');
  }

  async getStatus(connectionId: string, worktreePath: string): Promise<GitStatus> {
    const result = await this.sshService.executeCommand(
      connectionId,
      'git status --porcelain -b',
      worktreePath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Git status failed: ${result.stderr}`);
    }

    const lines = result.stdout.split('\n');
    const branchLine = lines[0];
    const files = lines.slice(1).filter((l) => l.trim());

    const branchMatch = branchLine.match(/^## (.+?)(?:\...|$)/);
    const branch = branchMatch ? branchMatch[1] : 'unknown';

    return {
      branch,
      isClean: files.length === 0,
      files: files.map((line) => ({
        status: line.substring(0, 2).trim(),
        path: line.substring(3),
      })),
    };
  }

  async getDefaultBranch(connectionId: string, projectPath: string): Promise<string> {
    const normalizedProjectPath = this.normalizeRemotePath(projectPath);

    // Try to get the current branch
    const currentBranchResult = await this.sshService.executeCommand(
      connectionId,
      'git rev-parse --abbrev-ref HEAD',
      normalizedProjectPath
    );

    if (
      currentBranchResult.exitCode === 0 &&
      currentBranchResult.stdout.trim() &&
      currentBranchResult.stdout.trim() !== 'HEAD'
    ) {
      return currentBranchResult.stdout.trim();
    }

    // Fallback: check common default branch names
    const commonBranches = ['main', 'master', 'develop', 'trunk'];
    for (const branch of commonBranches) {
      const checkResult = await this.sshService.executeCommand(
        connectionId,
        `git rev-parse --verify ${quoteShellArg(branch)} 2>/dev/null`,
        normalizedProjectPath
      );
      if (checkResult.exitCode === 0) {
        return branch;
      }
    }

    return 'HEAD';
  }

  async createWorktree(
    connectionId: string,
    projectPath: string,
    taskName: string,
    baseRef?: string
  ): Promise<WorktreeInfo> {
    const normalizedProjectPath = this.normalizeRemotePath(projectPath);
    const slug = taskName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const worktreeName = `${slug || 'task'}-${Date.now()}`;
    const relWorktreePath = `.emdash/worktrees/${worktreeName}`;
    const worktreePath = `${normalizedProjectPath}/${relWorktreePath}`.replace(/\/+/g, '/');

    // Create worktrees directory (relative so we avoid quoting issues)
    await this.sshService.executeCommand(
      connectionId,
      'mkdir -p .emdash/worktrees',
      normalizedProjectPath
    );

    // Auto-detect default branch if baseRef is not provided or is invalid
    let base = (baseRef || '').trim();

    // If no base provided, use auto-detection
    if (!base) {
      base = await this.getDefaultBranch(connectionId, normalizedProjectPath);
    } else {
      // Always verify the provided branch exists, regardless of what it is
      const verifyResult = await this.sshService.executeCommand(
        connectionId,
        `git rev-parse --verify ${quoteShellArg(base)} 2>/dev/null`,
        normalizedProjectPath
      );

      if (verifyResult.exitCode !== 0) {
        // Branch doesn't exist, auto-detect the actual default branch
        base = await this.getDefaultBranch(connectionId, normalizedProjectPath);
      }
    }

    if (!base) {
      base = 'HEAD';
    }

    const result = await this.sshService.executeCommand(
      connectionId,
      `git worktree add ${quoteShellArg(relWorktreePath)} -b ${quoteShellArg(worktreeName)} ${quoteShellArg(
        base
      )}`,
      normalizedProjectPath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr}`);
    }

    return {
      path: worktreePath,
      branch: worktreeName,
      isMain: false,
    };
  }

  async removeWorktree(
    connectionId: string,
    projectPath: string,
    worktreePath: string
  ): Promise<void> {
    const normalizedProjectPath = this.normalizeRemotePath(projectPath);
    const normalizedWorktreePath = this.normalizeRemotePath(worktreePath);
    const result = await this.sshService.executeCommand(
      connectionId,
      `git worktree remove ${quoteShellArg(normalizedWorktreePath)} --force`,
      normalizedProjectPath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to remove worktree: ${result.stderr}`);
    }
  }

  async listWorktrees(connectionId: string, projectPath: string): Promise<WorktreeInfo[]> {
    const normalizedProjectPath = this.normalizeRemotePath(projectPath);
    const result = await this.sshService.executeCommand(
      connectionId,
      'git worktree list --porcelain',
      normalizedProjectPath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to list worktrees: ${result.stderr}`);
    }

    // Porcelain output is blocks separated by blank lines.
    // Each block begins with: worktree <path>
    // Optional: branch <ref>
    // Optional: detached
    const blocks = result.stdout
      .split(/\n\s*\n/g)
      .map((b) => b.trim())
      .filter(Boolean);

    const out: WorktreeInfo[] = [];
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim());
      const wtLine = lines.find((l) => l.startsWith('worktree '));
      if (!wtLine) continue;
      const wtPath = wtLine.slice('worktree '.length).trim();
      const branchLine = lines.find((l) => l.startsWith('branch '));
      const branchRef = branchLine ? branchLine.slice('branch '.length).trim() : '';
      const branch = branchRef.replace(/^refs\/heads\//, '') || 'HEAD';
      const isMain = this.normalizeRemotePath(wtPath) === normalizedProjectPath;
      out.push({ path: wtPath, branch, isMain });
    }
    return out;
  }

  async getWorktreeStatus(
    connectionId: string,
    worktreePath: string
  ): Promise<{
    hasChanges: boolean;
    stagedFiles: string[];
    unstagedFiles: string[];
    untrackedFiles: string[];
  }> {
    const normalizedWorktreePath = this.normalizeRemotePath(worktreePath);
    const result = await this.sshService.executeCommand(
      connectionId,
      'git status --porcelain --untracked-files=all',
      normalizedWorktreePath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Git status failed: ${result.stderr}`);
    }

    const stagedFiles: string[] = [];
    const unstagedFiles: string[] = [];
    const untrackedFiles: string[] = [];
    const lines = (result.stdout || '')
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);
      if (status.includes('A') || status.includes('M') || status.includes('D')) {
        stagedFiles.push(file);
      }
      if (status[1] === 'M' || status[1] === 'D') {
        unstagedFiles.push(file);
      }
      if (status.includes('??')) {
        untrackedFiles.push(file);
      }
    }

    return {
      hasChanges: stagedFiles.length > 0 || unstagedFiles.length > 0 || untrackedFiles.length > 0,
      stagedFiles,
      unstagedFiles,
      untrackedFiles,
    };
  }

  async getBranchList(connectionId: string, projectPath: string): Promise<string[]> {
    const result = await this.sshService.executeCommand(
      connectionId,
      'git branch -a --format="%(refname:short)"',
      this.normalizeRemotePath(projectPath)
    );

    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout.split('\n').filter((b) => b.trim());
  }

  async commit(
    connectionId: string,
    worktreePath: string,
    message: string,
    files?: string[]
  ): Promise<ExecResult> {
    let command = 'git commit';

    if (files && files.length > 0) {
      const fileList = files.map((f) => quoteShellArg(f)).join(' ');
      command = `git add ${fileList} && ${command}`;
    }

    command += ` -m ${quoteShellArg(message)}`;

    return this.sshService.executeCommand(
      connectionId,
      command,
      this.normalizeRemotePath(worktreePath)
    );
  }
}
