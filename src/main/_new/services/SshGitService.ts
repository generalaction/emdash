import type { SFTPWrapper } from 'ssh2';
import type { IGitService } from '../environment/types';
import { RemoteGitService } from '../../services/RemoteGitService';
import { sshConnectionManager } from '../pty/ssh-connection-manager';
import { quoteShellArg } from '../../utils/shellEscape';
import { ExecResult } from '@shared/ssh/types';
import { GitChange } from '@/services/GitService';
import { DiffResult } from '@/utils/diffParser';

/**
 * Thin adapter that provides `executeCommand` and `getSftp` using the
 * `ssh2.Client` managed by `SshConnectionManager`.
 *
 * Cast as `SshService` where constructors require it — the duck-typing
 * is intentional and type-safe within this module boundary.
 */
class SshManagerAdapter {
  private sftpCache = new Map<string, SFTPWrapper>();

  async executeCommand(connectionId: string, command: string, cwd?: string): Promise<ExecResult> {
    const client = sshConnectionManager.getClient(connectionId);
    if (!client) {
      throw new Error(`SSH connection '${connectionId}' is not active in SshConnectionManager`);
    }
    const innerCmd = cwd ? `cd ${quoteShellArg(cwd)} && ${command}` : command;
    const fullCmd = `bash -l -c ${quoteShellArg(innerCmd)}`;

    return new Promise((resolve, reject) => {
      client.exec(fullCmd, (execErr, stream) => {
        if (execErr) return reject(execErr);
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number | null) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? -1 });
        });
        stream.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8');
        });
        stream.on('error', reject);
      });
    });
  }

  async getSftp(connectionId: string): Promise<SFTPWrapper> {
    const cached = this.sftpCache.get(connectionId);
    if (cached) return cached;

    const client = sshConnectionManager.getClient(connectionId);
    if (!client) {
      throw new Error(`SSH connection '${connectionId}' is not active in SshConnectionManager`);
    }
    return new Promise((resolve, reject) => {
      client.sftp((sftpErr, sftp) => {
        if (sftpErr) return reject(sftpErr);
        this.sftpCache.set(connectionId, sftp);
        sftp.on('close', () => {
          this.sftpCache.delete(connectionId);
        });
        resolve(sftp);
      });
    });
  }

  clearSftpCache(connectionId: string): void {
    this.sftpCache.delete(connectionId);
  }
}

/** Singleton adapter — all SshGitService instances share it. */
const sshManagerAdapter = new SshManagerAdapter();

export class SshGitService implements IGitService {
  private remote: RemoteGitService;

  constructor(private connectionId: string) {
    // Cast the adapter to SshService — the adapter provides all methods that
    // RemoteGitService actually calls (executeCommand, getSftp).
    this.remote = new RemoteGitService(sshManagerAdapter as never);
  }

  getStatus(worktreePath: string): Promise<GitChange[]> {
    return this.remote.getStatusDetailed(this.connectionId, worktreePath);
  }

  getFileDiff(worktreePath: string, filePath: string): Promise<DiffResult> {
    return this.remote.getFileDiff(this.connectionId, worktreePath, filePath);
  }

  stageFile(worktreePath: string, filePath: string): Promise<void> {
    return this.remote.stageFile(this.connectionId, worktreePath, filePath);
  }

  stageAllFiles(worktreePath: string): Promise<void> {
    return this.remote.stageAllFiles(this.connectionId, worktreePath);
  }

  unstageFile(worktreePath: string, filePath: string): Promise<void> {
    return this.remote.unstageFile(this.connectionId, worktreePath, filePath);
  }

  async revertFile(worktreePath: string, filePath: string): Promise<{ action: string }> {
    return this.remote.revertFile(this.connectionId, worktreePath, filePath);
  }

  async commit(worktreePath: string, message: string): Promise<{ hash: string }> {
    const result = await this.remote.commit(this.connectionId, worktreePath, message);
    if (result.exitCode !== 0 && !/nothing to commit/i.test(result.stderr || '')) {
      throw new Error(result.stderr || 'Commit failed');
    }
    // Extract hash from stdout if possible, otherwise return empty string
    const hashMatch = (result.stdout || '').match(/\b([0-9a-f]{7,40})\b/);
    return { hash: hashMatch?.[1] ?? '' };
  }

  async push(worktreePath: string): Promise<{ output: string }> {
    const result = await this.remote.push(this.connectionId, worktreePath);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'Push failed');
    }
    return { output: result.stdout || '' };
  }

  async softReset(worktreePath: string): Promise<{ subject: string; body: string }> {
    const result = await this.remote.execGit(
      this.connectionId,
      worktreePath,
      'reset --soft HEAD~1'
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'Soft reset failed');
    }
    return { subject: '', body: '' };
  }

  async pull(worktreePath: string): Promise<{ output: string }> {
    const result = await this.remote.execGit(this.connectionId, worktreePath, 'pull');
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'Pull failed');
    }
    return { output: result.stdout || '' };
  }

  getLog(
    worktreePath: string,
    maxCount?: number,
    skip?: number,
    _aheadCount?: number
  ): Promise<{ commits: unknown[]; aheadCount: number }> {
    const cmd = ['log', '--format=%H|%s|%b|%ai|%an', `--max-count=${maxCount ?? 50}`];
    if (skip) cmd.push(`--skip=${skip}`);
    return this.remote
      .execGit(this.connectionId, worktreePath, cmd.join(' '))
      .then(() => ({ commits: [], aheadCount: 0 }));
  }

  async getLatestCommit(
    worktreePath: string
  ): Promise<{ hash: string; subject: string; body: string; isPushed: boolean } | null> {
    const result = await this.remote.execGit(
      this.connectionId,
      worktreePath,
      'log -1 --format=%H|%s|%b|%ai|%an'
    );
    if (result.exitCode !== 0 || !result.stdout.trim()) return null;
    const [hash = '', subject = ''] = result.stdout.trim().split('|');
    return { hash, subject, body: '', isPushed: false };
  }

  async getCommitFiles(
    worktreePath: string,
    commitHash: string
  ): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>> {
    const result = await this.remote.execGit(
      this.connectionId,
      worktreePath,
      `diff-tree --no-commit-id -r --name-status ${commitHash}`
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || 'getCommitFiles failed');
    return (result.stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split('\t');
        return {
          status: parts[0] || 'modified',
          path: parts[1] || '',
          additions: 0,
          deletions: 0,
        };
      });
  }

  async getCommitFileDiff(
    worktreePath: string,
    commitHash: string,
    filePath: string
  ): Promise<DiffResult> {
    const result = await this.remote.execGit(
      this.connectionId,
      worktreePath,
      `show ${commitHash} -- ${filePath}`
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || 'getCommitFileDiff failed');
    return { lines: [], rawDiff: result.stdout } as DiffResult & { rawDiff?: string };
  }

  getBranchStatus(
    worktreePath: string
  ): Promise<{ branch: string; defaultBranch: string; ahead: number; behind: number }> {
    return this.remote.getBranchStatus(this.connectionId, worktreePath);
  }

  renameBranch(
    repoPath: string,
    oldBranch: string,
    newBranch: string
  ): Promise<{ remotePushed: boolean }> {
    return this.remote.renameBranch(this.connectionId, repoPath, oldBranch, newBranch);
  }
}
