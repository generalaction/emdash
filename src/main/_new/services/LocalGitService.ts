import type { IGitService } from '../environment/types';
import {
  getStatus,
  getFileDiff,
  stageFile,
  stageAllFiles,
  unstageFile,
  revertFile,
  commit,
  push,
  pull,
  getLog,
  getLatestCommit,
  getCommitFiles,
  getCommitFileDiff,
  softResetLastCommit,
  GitChange,
} from '../../services/GitService';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { DiffResult } from '@/utils/diffParser';

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
      if (existsSync(p)) return p;
    } catch {}
  }
  return 'git';
}

const GIT = resolveGitBin();

export class LocalGitService implements IGitService {
  getStatus(worktreePath: string): Promise<GitChange[]> {
    return getStatus(worktreePath);
  }

  getFileDiff(worktreePath: string, filePath: string): Promise<DiffResult> {
    return getFileDiff(worktreePath, filePath);
  }

  stageFile(worktreePath: string, filePath: string): Promise<void> {
    return stageFile(worktreePath, filePath);
  }

  stageAllFiles(worktreePath: string): Promise<void> {
    return stageAllFiles(worktreePath);
  }

  unstageFile(worktreePath: string, filePath: string): Promise<void> {
    return unstageFile(worktreePath, filePath);
  }

  async revertFile(worktreePath: string, filePath: string): Promise<{ action: string }> {
    return revertFile(worktreePath, filePath);
  }

  commit(worktreePath: string, message: string): Promise<{ hash: string }> {
    return commit(worktreePath, message);
  }

  push(worktreePath: string): Promise<{ output: string }> {
    return push(worktreePath);
  }

  pull(worktreePath: string): Promise<{ output: string }> {
    return pull(worktreePath);
  }

  getLog(
    worktreePath: string,
    maxCount?: number,
    skip?: number,
    aheadCount?: number
  ): Promise<{ commits: unknown[]; aheadCount: number }> {
    return getLog(worktreePath, maxCount, skip, aheadCount);
  }

  async getLatestCommit(
    worktreePath: string
  ): Promise<{ hash: string; subject: string; body: string; isPushed: boolean } | null> {
    return getLatestCommit(worktreePath);
  }

  async getCommitFiles(
    worktreePath: string,
    commitHash: string
  ): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>> {
    return getCommitFiles(worktreePath, commitHash);
  }

  getCommitFileDiff(
    worktreePath: string,
    commitHash: string,
    filePath: string
  ): Promise<DiffResult> {
    return getCommitFileDiff(worktreePath, commitHash, filePath);
  }

  async softReset(worktreePath: string): Promise<{ subject: string; body: string }> {
    return softResetLastCommit(worktreePath);
  }

  async getBranchStatus(
    worktreePath: string
  ): Promise<{ branch: string; defaultBranch: string; ahead: number; behind: number }> {
    const { stdout: branchOut } = await execFileAsync(GIT, ['branch', '--show-current'], {
      cwd: worktreePath,
    });
    const branch = (branchOut || '').trim();

    let defaultBranch = 'main';
    try {
      const { stdout } = await execFileAsync(
        GIT,
        ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { cwd: worktreePath }
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
        { cwd: worktreePath }
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
}

export const localGitService = new LocalGitService();
