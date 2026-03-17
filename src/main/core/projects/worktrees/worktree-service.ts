import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import { ExecFn } from '@main/core/utils/exec';
import { ProjectSettingsProvider } from '../settings/schema';

function createStableWorktreeReserveId(sourceBranch: string) {
  // Replace slashes with dashes so the reserve always lives as a flat directory
  // under the pool (e.g. "feature/foo" → "_reserve-feature-foo").
  return `_reserve-${sourceBranch.replace(/\//g, '-')}`;
}

export class WorktreeService {
  private readonly reserveInProgress = new Map<string, Promise<void>>();
  private gitOpQueue: Promise<unknown> = Promise.resolve();
  private readonly worktreePoolPath: string;
  private readonly defaultBranch: string;
  private readonly repoPath: string;
  private readonly exec: ExecFn;
  private readonly projectSettings: ProjectSettingsProvider;

  constructor(args: {
    worktreePoolPath: string;
    defaultBranch: string;
    repoPath: string;
    exec: ExecFn;
    projectSettings: ProjectSettingsProvider;
  }) {
    this.worktreePoolPath = args.worktreePoolPath;
    this.defaultBranch = args.defaultBranch;
    this.repoPath = args.repoPath;
    this.projectSettings = args.projectSettings;
    this.exec = args.exec;

    this.ensureReserve(this.defaultBranch).catch(() => {});
  }

  private async isValidWorktree(worktreePath: string): Promise<boolean> {
    try {
      await this.exec('git', ['rev-parse', '--git-dir'], { cwd: worktreePath });
      return true;
    } catch {
      return false;
    }
  }

  // Serialize all git worktree creation operations so concurrent ensureReserve
  // calls for different branches don't race on git's ref/lock files.
  private enqueueGitOp<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.gitOpQueue.then(fn, fn);
    this.gitOpQueue = result.catch(() => {});
    return result as Promise<T>;
  }

  async ensureReserve(sourceBranch: string): Promise<void> {
    const reservePath = path.join(
      this.worktreePoolPath,
      createStableWorktreeReserveId(sourceBranch)
    );
    if (fs.existsSync(reservePath)) {
      if (await this.isValidWorktree(reservePath)) return;
      // Stale directory: exists on disk but not registered as a git worktree.
      // Remove it so createReserve can set it up correctly.
      await fs.promises.rm(reservePath, { recursive: true, force: true });
      await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
    }
    const inProgress = this.reserveInProgress.get(sourceBranch);
    if (inProgress) return inProgress;
    const creation = this.enqueueGitOp(() => this.createReserve(sourceBranch)).finally(() => {
      this.reserveInProgress.delete(sourceBranch);
    });
    this.reserveInProgress.set(sourceBranch, creation);
    return creation;
  }

  private async createReserve(sourceBranch: string): Promise<void> {
    await this.ensureWorktreePoolDirExists();
    const reserveBranchName = createStableWorktreeReserveId(sourceBranch);
    const worktreePath = path.join(this.worktreePoolPath, reserveBranchName);
    // Check whether the reserve branch exists in git at all
    let branchExists = false;
    try {
      await this.exec('git', ['rev-parse', '--verify', reserveBranchName], { cwd: this.repoPath });
      branchExists = true;
    } catch {}
    if (!branchExists) {
      // Case 1: fresh — create the branch and worktree together
      await this.exec(
        'git',
        ['worktree', 'add', '-b', reserveBranchName, worktreePath, sourceBranch],
        { cwd: this.repoPath }
      );
      return;
    }
    // Case 2 & 3: branch exists — try to re-add the worktree at the expected path.
    // If the branch is already checked out at a different (stale) path, git will
    // reject the add and tell us where it lives — move it instead.
    try {
      await this.exec('git', ['worktree', 'add', worktreePath, reserveBranchName], {
        cwd: this.repoPath,
      });
    } catch (e: unknown) {
      const stderr = (e as { stderr?: string })?.stderr ?? '';
      const match = /already checked out at '(.+)'/.exec(stderr);
      if (match?.[1]) {
        // Case 3: branch is checked out at old/different path — move it to where we expect it
        await this.exec('git', ['worktree', 'move', match[1], worktreePath], {
          cwd: this.repoPath,
        });
      } else {
        throw e;
      }
    }
  }

  private async ensureWorktreePoolDirExists(): Promise<void> {
    await fs.promises.mkdir(this.worktreePoolPath, { recursive: true });
  }

  async getWorktree(branchName: string): Promise<string | undefined> {
    const worktreePath = path.join(this.worktreePoolPath, branchName);
    if (fs.existsSync(worktreePath)) return worktreePath;
    return undefined;
  }

  async claimReserve(
    sourceBranch: string,
    branchName: string,
    options?: { syncWithRemote?: boolean }
  ): Promise<string> {
    await this.ensureWorktreePoolDirExists();
    const { syncWithRemote = true } = options ?? {};
    const reserveBranchName = createStableWorktreeReserveId(sourceBranch);
    const reservePath = path.join(this.worktreePoolPath, reserveBranchName);
    const targetPath = path.join(this.worktreePoolPath, branchName);

    // If this branch has already been claimed, return the existing path immediately.
    if (fs.existsSync(targetPath)) return targetPath;

    if (!fs.existsSync(reservePath) || !(await this.isValidWorktree(reservePath))) {
      await this.ensureReserve(sourceBranch);
    }

    if (syncWithRemote) {
      await this.exec('git', ['fetch', 'origin'], { cwd: reservePath }).catch(() => {});
      await this.exec('git', ['reset', '--hard', `origin/${sourceBranch}`], {
        cwd: reservePath,
      }).catch(() => {});
    } else {
      await this.exec('git', ['reset', '--hard', sourceBranch], { cwd: reservePath }).catch(
        () => {}
      );
    }

    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await this.exec('git', ['worktree', 'move', reservePath, targetPath], { cwd: this.repoPath });
    await this.exec('git', ['branch', '-m', reserveBranchName, branchName], { cwd: this.repoPath });

    await this.copyPreservedFiles(targetPath);

    if (sourceBranch === this.defaultBranch) {
      this.ensureReserve(sourceBranch).catch(() => {});
    }

    return targetPath;
  }

  async moveWorktree(oldPath: string, newPath: string): Promise<void> {
    await this.exec('git', ['worktree', 'move', oldPath, newPath], { cwd: this.repoPath });
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    await fs.promises.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
  }

  private async copyPreservedFiles(targetPath: string): Promise<void> {
    const settings = await this.projectSettings.get();
    const patterns = settings.preservePatterns ?? [];
    for (const pattern of patterns) {
      // glob the pattern against the main repo
      const matches = await glob(pattern, {
        cwd: this.repoPath,
        dot: true, // match dotfiles like .env
        absolute: false,
      });
      for (const relPath of matches) {
        const src = path.join(this.repoPath, relPath);
        const stat = await fs.promises.stat(src).catch(() => null);
        // Skip directories — glob patterns like `.claude/**` may match the dir itself.
        if (!stat || !stat.isFile()) continue;
        const dest = path.join(targetPath, relPath);
        // ensure parent directory exists (e.g. nested paths)
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.copyFile(src, dest);
      }
    }
  }
}
