import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  DiffResult,
  GitChange,
  GitInfo,
  IGitProvider,
} from '@main/core/workspaces/git-provider';
import {
  commit,
  computeBaseRef,
  getCommitFileDiff,
  getCommitFiles,
  getFileDiff,
  getLatestCommit,
  getLog,
  getStatus,
  pull,
  push,
  revertFile,
  softResetLastCommit,
  stageAllFiles,
  stageFile,
  unstageFile,
} from './local-git-utils';

const execFileAsync = promisify(execFile);

function resolveGitBin(): string {
  const candidates = [
    (process.env.GIT_PATH || '').trim(),
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
    '/usr/bin/git',
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return 'git';
}

const GIT = resolveGitBin();

export class LocalGitService implements IGitProvider {
  constructor(private readonly worktreePath: string) {}

  getStatus(): Promise<GitChange[]> {
    return getStatus(this.worktreePath);
  }

  getFileDiff(filePath: string): Promise<DiffResult> {
    return getFileDiff(this.worktreePath, filePath);
  }

  stageFile(filePath: string): Promise<void> {
    return stageFile(this.worktreePath, filePath);
  }

  stageAllFiles(): Promise<void> {
    return stageAllFiles(this.worktreePath);
  }

  unstageFile(filePath: string): Promise<void> {
    return unstageFile(this.worktreePath, filePath);
  }

  async revertFile(filePath: string): Promise<{ action: string }> {
    return revertFile(this.worktreePath, filePath);
  }

  commit(message: string): Promise<{ hash: string }> {
    return commit(this.worktreePath, message);
  }

  push(): Promise<{ output: string }> {
    return push(this.worktreePath);
  }

  pull(): Promise<{ output: string }> {
    return pull(this.worktreePath);
  }

  getLog(
    maxCount?: number,
    skip?: number,
    aheadCount?: number
  ): Promise<{ commits: unknown[]; aheadCount: number }> {
    return getLog(this.worktreePath, maxCount, skip, aheadCount);
  }

  async getLatestCommit(): Promise<{
    hash: string;
    subject: string;
    body: string;
    isPushed: boolean;
  } | null> {
    return getLatestCommit(this.worktreePath);
  }

  async getCommitFiles(
    commitHash: string
  ): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>> {
    return getCommitFiles(this.worktreePath, commitHash);
  }

  getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
    return getCommitFileDiff(this.worktreePath, commitHash, filePath);
  }

  async softReset(): Promise<{ subject: string; body: string }> {
    return softResetLastCommit(this.worktreePath);
  }

  async getBranchStatus(): Promise<{
    branch: string;
    defaultBranch: string;
    ahead: number;
    behind: number;
  }> {
    const { stdout: branchOut } = await execFileAsync(GIT, ['branch', '--show-current'], {
      cwd: this.worktreePath,
    });
    const branch = (branchOut || '').trim();

    let defaultBranch = 'main';
    try {
      const { stdout } = await execFileAsync(
        GIT,
        ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { cwd: this.worktreePath }
      );
      const last = (stdout || '').trim().split('/').pop();
      if (last) defaultBranch = last;
    } catch {}

    let ahead = 0;
    let behind = 0;
    try {
      const { stdout } = await execFileAsync(
        GIT,
        ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
        { cwd: this.worktreePath }
      );
      const parts = (stdout || '').trim().split(/\s+/);
      if (parts.length >= 2) {
        behind = parseInt(parts[0] || '0', 10) || 0;
        ahead = parseInt(parts[1] || '0', 10) || 0;
      }
    } catch {}

    return { branch, defaultBranch, ahead, behind };
  }

  async renameBranch(
    repoPath: string,
    oldBranch: string,
    newBranch: string
  ): Promise<{ remotePushed: boolean }> {
    let remotePushed = false;
    try {
      const { stdout: remoteOut } = await execFileAsync(
        GIT,
        ['config', '--get', `branch.${oldBranch}.remote`],
        { cwd: repoPath }
      );
      remotePushed = Boolean(remoteOut?.trim());
    } catch {}

    await execFileAsync(GIT, ['branch', '-m', oldBranch, newBranch], { cwd: repoPath });

    if (remotePushed) {
      try {
        await execFileAsync(GIT, ['push', 'origin', '--delete', oldBranch], { cwd: repoPath });
      } catch {}
      await execFileAsync(GIT, ['push', '-u', 'origin', newBranch], { cwd: repoPath });
    }

    return { remotePushed };
  }

  async detectInfo(): Promise<GitInfo> {
    const resolvedPath = await fs.promises
      .realpath(this.worktreePath)
      .catch(() => this.worktreePath);

    if (!fs.existsSync(join(resolvedPath, '.git'))) {
      return { isGitRepo: false, baseRef: 'main', rootPath: resolvedPath };
    }

    let remote: string | undefined;
    try {
      const { stdout } = await execFileAsync(GIT, ['remote', 'get-url', 'origin'], {
        cwd: resolvedPath,
      });
      remote = stdout.trim() || undefined;
    } catch {}

    let branch: string | undefined;
    try {
      const { stdout } = await execFileAsync(GIT, ['branch', '--show-current'], {
        cwd: resolvedPath,
      });
      branch = stdout.trim() || undefined;
    } catch {}

    // Fall back to detecting default branch if HEAD is detached
    if (!branch) {
      try {
        const { stdout } = await execFileAsync(GIT, ['remote', 'show', 'origin'], {
          cwd: resolvedPath,
        });
        const match = stdout.match(/HEAD branch:\s*(\S+)/);
        branch = match?.[1] ?? undefined;
      } catch {}
    }

    let rootPath = resolvedPath;
    try {
      const { stdout } = await execFileAsync(GIT, ['rev-parse', '--show-toplevel'], {
        cwd: resolvedPath,
      });
      const trimmed = stdout.trim();
      if (trimmed) rootPath = await fs.promises.realpath(trimmed).catch(() => trimmed);
    } catch {}

    return {
      isGitRepo: true,
      remote,
      branch,
      baseRef: computeBaseRef(remote, branch),
      rootPath,
    };
  }
}
