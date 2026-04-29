import path from 'node:path';
import type { Branch } from '@shared/git';
import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import type { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import type { ProjectSettingsProvider } from '../settings/schema';
import type { WorktreeHost } from './hosts/worktree-host';

export type ServeWorktreeError =
  | { type: 'worktree-setup-failed'; cause: unknown }
  | { type: 'branch-not-found'; branch: string };

export class WorktreeService {
  private gitOpQueue: Promise<unknown> = Promise.resolve();
  private readonly worktreePoolPath: string;
  private readonly repoPath: string;
  private readonly exec: ExecFn;
  private readonly host: WorktreeHost;
  private readonly projectSettings: ProjectSettingsProvider;

  constructor(args: {
    worktreePoolPath: string;
    repoPath: string;
    exec: ExecFn;
    host: WorktreeHost;
    projectSettings: ProjectSettingsProvider;
  }) {
    this.worktreePoolPath = args.worktreePoolPath;
    this.repoPath = args.repoPath;
    this.projectSettings = args.projectSettings;
    this.exec = args.exec;
    this.host = args.host;

    this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
  }

  private enqueueGitOp<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.gitOpQueue.then(fn, fn);
    this.gitOpQueue = result.catch(() => {});
    return result as Promise<T>;
  }

  private async isValidWorktree(worktreePath: string): Promise<boolean> {
    try {
      await this.exec('git', ['rev-parse', '--git-dir'], { cwd: worktreePath });
      return true;
    } catch {
      return false;
    }
  }

  private async ensureWorktreePoolDirExists(): Promise<void> {
    await this.host.mkdirAbsolute(this.worktreePoolPath, { recursive: true });
  }

  private async getRemoteCandidates(): Promise<string[]> {
    const configuredRemote = (await this.projectSettings.getRemote().catch(() => '')).trim();
    if (!configuredRemote || configuredRemote === DEFAULT_REMOTE_NAME) {
      return [DEFAULT_REMOTE_NAME];
    }
    return [configuredRemote, DEFAULT_REMOTE_NAME];
  }

  private async findCheckedOutPathForBranch(branchName: string): Promise<string | undefined> {
    try {
      const { stdout } = await this.exec('git', ['worktree', 'list', '--porcelain'], {
        cwd: this.repoPath,
      });
      const branchLine = `branch refs/heads/${branchName}`;
      for (const block of stdout.split('\n\n')) {
        if (!block.split('\n').some((line) => line === branchLine)) {
          continue;
        }
        const match = /^worktree (.+)$/m.exec(block);
        const candidatePath = match?.[1];
        if (!candidatePath) continue;
        if (await this.isValidWorktree(candidatePath)) {
          return candidatePath;
        }
        await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
      }
    } catch {}
    return undefined;
  }

  private async resolveSourceBaseRef(
    sourceBranch: Branch | undefined
  ): Promise<string | undefined> {
    if (!sourceBranch) return undefined;

    if (sourceBranch.type === 'local') {
      const localRef = `refs/heads/${sourceBranch.branch}`;
      try {
        await this.exec('git', ['rev-parse', '--verify', localRef], { cwd: this.repoPath });
        return localRef;
      } catch {
        return undefined;
      }
    }

    const remoteName = sourceBranch.remote.name;
    await this.exec('git', ['fetch', remoteName], { cwd: this.repoPath }).catch(() => {});
    const remoteRef = `refs/remotes/${remoteName}/${sourceBranch.branch}`;
    try {
      await this.exec('git', ['rev-parse', '--verify', remoteRef], { cwd: this.repoPath });
      return remoteRef;
    } catch {
      return undefined;
    }
  }

  async getWorktree(branchName: string): Promise<string | undefined> {
    const worktreePath = path.join(this.worktreePoolPath, branchName);
    if (await this.host.existsAbsolute(worktreePath)) {
      if (await this.isValidWorktree(worktreePath)) return worktreePath;
      await this.host.removeAbsolute(worktreePath, { recursive: true }).catch(() => {});
    }

    try {
      const realPoolPath = await this.host.realPathAbsolute(this.worktreePoolPath);
      const { stdout } = await this.exec('git', ['worktree', 'list', '--porcelain'], {
        cwd: this.repoPath,
      });
      const branchLine = `branch refs/heads/${branchName}`;
      for (const block of stdout.split('\n\n')) {
        if (block.split('\n').some((line) => line === branchLine)) {
          const match = /^worktree (.+)$/m.exec(block);
          if (match?.[1]?.startsWith(realPoolPath)) return match[1];
        }
      }
    } catch {}
    return undefined;
  }

  async checkoutBranchWorktree(
    sourceBranch: Branch | undefined,
    branchName: string
  ): Promise<Result<string, ServeWorktreeError>> {
    await this.ensureWorktreePoolDirExists();
    return this.enqueueGitOp(() => this.doCheckoutBranchWorktree(sourceBranch, branchName));
  }

  private async doCheckoutBranchWorktree(
    sourceBranch: Branch | undefined,
    branchName: string
  ): Promise<Result<string, ServeWorktreeError>> {
    const checkedOutPath = await this.findCheckedOutPathForBranch(branchName);
    if (checkedOutPath) {
      return ok(checkedOutPath);
    }

    const targetPath = path.join(this.worktreePoolPath, branchName);
    if (await this.host.existsAbsolute(targetPath)) {
      if (await this.isValidWorktree(targetPath)) return ok(targetPath);
      await this.host.removeAbsolute(targetPath, { recursive: true }).catch(() => {});
      await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
    }

    try {
      let localExists = false;
      try {
        await this.exec('git', ['rev-parse', '--verify', `refs/heads/${branchName}`], {
          cwd: this.repoPath,
        });
        localExists = true;
      } catch {}

      if (!localExists) {
        const sourceRef = await this.resolveSourceBaseRef(sourceBranch);
        if (!sourceRef) {
          return err({ type: 'branch-not-found', branch: sourceBranch?.branch ?? branchName });
        }
        await this.exec('git', ['branch', '--no-track', branchName, sourceRef], {
          cwd: this.repoPath,
        });
      }

      await this.host.mkdirAbsolute(path.dirname(targetPath), { recursive: true });
      await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
      await this.exec('git', ['worktree', 'add', targetPath, branchName], {
        cwd: this.repoPath,
      });
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause });
    }

    await this.copyPreservedFiles(targetPath).catch((e) => {
      log.warn('WorktreeService: failed to copy preserved files', {
        targetPath,
        error: String(e),
      });
    });

    return ok(targetPath);
  }

  async checkoutExistingBranch(branchName: string): Promise<Result<string, ServeWorktreeError>> {
    await this.ensureWorktreePoolDirExists();
    return this.enqueueGitOp(() => this.doCheckoutExistingBranch(branchName));
  }

  private async doCheckoutExistingBranch(
    branchName: string
  ): Promise<Result<string, ServeWorktreeError>> {
    const checkedOutPath = await this.findCheckedOutPathForBranch(branchName);
    if (checkedOutPath) {
      return ok(checkedOutPath);
    }

    const targetPath = path.join(this.worktreePoolPath, branchName);
    const remoteCandidates = await this.getRemoteCandidates();

    if (await this.host.existsAbsolute(targetPath)) {
      if (await this.isValidWorktree(targetPath)) return ok(targetPath);
      await this.host.removeAbsolute(targetPath, { recursive: true });
      await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
    }

    try {
      await this.host.mkdirAbsolute(path.dirname(targetPath), { recursive: true });
      for (const remoteName of remoteCandidates) {
        await this.exec('git', ['fetch', remoteName], { cwd: this.repoPath }).catch(() => {});
      }
      let localExists = false;
      try {
        await this.exec('git', ['rev-parse', '--verify', `refs/heads/${branchName}`], {
          cwd: this.repoPath,
        });
        localExists = true;
      } catch {}

      if (!localExists) {
        let trackingRemote: string | undefined;
        for (const remoteName of remoteCandidates) {
          try {
            await this.exec(
              'git',
              ['rev-parse', '--verify', `refs/remotes/${remoteName}/${branchName}`],
              {
                cwd: this.repoPath,
              }
            );
            trackingRemote = remoteName;
            break;
          } catch {}
        }
        if (!trackingRemote) {
          return err({ type: 'branch-not-found', branch: branchName });
        }
        await this.exec(
          'git',
          ['branch', '--track', branchName, `${trackingRemote}/${branchName}`],
          {
            cwd: this.repoPath,
          }
        );
      }

      await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
      await this.exec('git', ['worktree', 'add', targetPath, branchName], {
        cwd: this.repoPath,
      });
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause });
    }

    await this.copyPreservedFiles(targetPath).catch((e) => {
      log.warn('WorktreeService: failed to copy preserved files', {
        targetPath,
        error: String(e),
      });
    });

    return ok(targetPath);
  }

  async moveWorktree(oldPath: string, newPath: string): Promise<void> {
    await this.exec('git', ['worktree', 'move', oldPath, newPath], { cwd: this.repoPath });
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    await this.host.removeAbsolute(worktreePath, { recursive: true }).catch(() => {});
    await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
  }

  private async copyPreservedFiles(targetPath: string): Promise<void> {
    const settings = await this.projectSettings.get();
    const patterns = settings.preservePatterns ?? [];
    for (const pattern of patterns) {
      const matches = await this.host.globAbsolute(pattern, {
        cwd: this.repoPath,
        dot: true,
      });
      for (const relPath of matches) {
        const src = path.join(this.repoPath, relPath);
        const stat = await this.host.statAbsolute(src).catch(() => null);
        if (!stat || stat.type !== 'file') continue;
        const dest = path.join(targetPath, relPath);
        await this.host.mkdirAbsolute(path.dirname(dest), { recursive: true });
        await this.host.copyFileAbsolute(src, dest);
      }
    }
  }
}
