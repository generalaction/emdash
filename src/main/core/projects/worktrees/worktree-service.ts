import path from 'node:path';
import { err, ok, Result } from '@shared/result';
import { FileSystemProvider } from '@main/core/fs/types';
import { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { ProjectSettingsProvider } from '../settings/schema';

export type ServeWorktreeError =
  | { type: 'reserve-failed'; sourceBranch: string; cause: unknown }
  | { type: 'worktree-setup-failed'; cause: unknown };

function createStableWorktreeReserveId(sourceBranch: string) {
  // Replace slashes with dashes so the reserve always lives as a flat directory
  // under the pool (e.g. "feature/foo" → "_reserve-feature-foo").
  return `_reserve-${sourceBranch.replace(/\//g, '-')}`;
}

export class WorktreeService {
  private readonly reserveInProgress = new Map<string, Promise<void>>();
  private gitOpQueue: Promise<unknown> = Promise.resolve();
  private readonly worktreePoolPath: string;
  private readonly repoPath: string;
  private readonly exec: ExecFn;
  private readonly rootFs: FileSystemProvider;
  private readonly projectSettings: ProjectSettingsProvider;

  constructor(args: {
    worktreePoolPath: string;
    repoPath: string;
    exec: ExecFn;
    rootFs: FileSystemProvider;
    projectSettings: ProjectSettingsProvider;
  }) {
    this.worktreePoolPath = args.worktreePoolPath;
    this.repoPath = args.repoPath;
    this.projectSettings = args.projectSettings;
    this.exec = args.exec;
    this.rootFs = args.rootFs;

    this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath })
      .catch(() => {})
      .then(() => this.projectSettings.getDefaultBranch())
      .then((branch) => this.ensureReserve(branch))
      .catch(() => {});
  }

  private async isValidWorktree(worktreePath: string): Promise<boolean> {
    try {
      await this.exec('git', ['rev-parse', '--git-dir'], { cwd: worktreePath });
      return true;
    } catch {
      return false;
    }
  }

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
    if (await this.rootFs.exists(reservePath)) {
      if (await this.isValidWorktree(reservePath)) return;
      await this.rootFs.remove(reservePath, { recursive: true });
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

  private async doEnsureReserve(sourceBranch: string): Promise<void> {
    const reservePath = path.join(
      this.worktreePoolPath,
      createStableWorktreeReserveId(sourceBranch)
    );
    if (await this.rootFs.exists(reservePath)) {
      if (await this.isValidWorktree(reservePath)) return;
      await this.rootFs.remove(reservePath, { recursive: true });
      await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
    }
    await this.createReserve(sourceBranch);
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
      // Case 1: fresh — create the branch and worktree together.
      // Use refs/heads/ prefix to avoid ambiguity when a tag exists with the same name.
      await this.exec(
        'git',
        ['worktree', 'add', '-b', reserveBranchName, worktreePath, `refs/heads/${sourceBranch}`],
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
      const match = /already (?:checked out|used by worktree) at '(.+)'/.exec(stderr);
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
    await this.rootFs.mkdir(this.worktreePoolPath, { recursive: true });
  }

  async getWorktree(branchName: string): Promise<string | undefined> {
    const worktreePath = path.join(this.worktreePoolPath, branchName);
    if (await this.rootFs.exists(worktreePath)) {
      if (await this.isValidWorktree(worktreePath)) return worktreePath;
      await this.rootFs.remove(worktreePath, { recursive: true }).catch(() => {});
    }

    try {
      const realPoolPath = await this.rootFs.realPath(this.worktreePoolPath);
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

  async serveWorktree(
    sourceBranch: string,
    branchName: string
  ): Promise<Result<string, ServeWorktreeError>> {
    await this.ensureWorktreePoolDirExists();
    return this.enqueueGitOp(() => this.doServeWorktree(sourceBranch, branchName));
  }

  private async doServeWorktree(
    sourceBranch: string,
    branchName: string
  ): Promise<Result<string, ServeWorktreeError>> {
    const reserveBranchName = createStableWorktreeReserveId(sourceBranch);
    const reservePath = path.join(this.worktreePoolPath, reserveBranchName);
    const targetPath = path.join(this.worktreePoolPath, branchName);

    // Fast path: worktree already exists on disk.
    if (await this.rootFs.exists(targetPath)) return ok(targetPath);

    // Ensure the reserve worktree is ready. Use doEnsureReserve (not ensureReserve)
    // because we're already inside enqueueGitOp — calling ensureReserve here would
    // deadlock by trying to re-enqueue into the same serialised queue.
    if (!(await this.rootFs.exists(reservePath)) || !(await this.isValidWorktree(reservePath))) {
      try {
        await this.doEnsureReserve(sourceBranch);
      } catch (cause) {
        return err({ type: 'reserve-failed', sourceBranch, cause });
      }
    }

    try {
      await this.rootFs.mkdir(path.dirname(targetPath), { recursive: true });
      // Move the reserve worktree directory to the task's permanent path.
      await this.exec('git', ['worktree', 'move', reservePath, targetPath], {
        cwd: this.repoPath,
      });
      // Switch the worktree HEAD to the already-created task branch (fast: same commit).
      await this.exec('git', ['switch', branchName], { cwd: targetPath });
      // Clean up the now-unused reserve branch.
      await this.exec('git', ['branch', '-D', reserveBranchName], { cwd: this.repoPath });
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause });
    }

    await this.copyPreservedFiles(targetPath).catch((e) => {
      log.warn('WorktreeService: failed to copy preserved files', { targetPath, error: String(e) });
    });

    const defaultBranch = await this.projectSettings.getDefaultBranch();
    if (sourceBranch === defaultBranch) {
      this.ensureReserve(sourceBranch).catch(() => {});
    }

    return ok(targetPath);
  }

  async checkoutExistingBranch(branchName: string): Promise<Result<string, ServeWorktreeError>> {
    await this.ensureWorktreePoolDirExists();
    return this.enqueueGitOp(() => this.doCheckoutExistingBranch(branchName));
  }

  private async doCheckoutExistingBranch(
    branchName: string
  ): Promise<Result<string, ServeWorktreeError>> {
    const targetPath = path.join(this.worktreePoolPath, branchName);

    if (await this.rootFs.exists(targetPath)) {
      if (await this.isValidWorktree(targetPath)) return ok(targetPath);
      await this.rootFs.remove(targetPath, { recursive: true });
      await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
    }

    try {
      await this.rootFs.mkdir(path.dirname(targetPath), { recursive: true });
      await this.exec('git', ['fetch', 'origin'], { cwd: this.repoPath }).catch(() => {});
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
    await this.rootFs.remove(worktreePath, { recursive: true }).catch(() => {});
    await this.exec('git', ['worktree', 'prune'], { cwd: this.repoPath }).catch(() => {});
  }

  private async copyPreservedFiles(targetPath: string): Promise<void> {
    const settings = await this.projectSettings.get();
    const patterns = settings.preservePatterns ?? [];
    for (const pattern of patterns) {
      const matches = await this.rootFs.glob(pattern, {
        cwd: this.repoPath,
        dot: true,
      });
      for (const relPath of matches) {
        const src = path.join(this.repoPath, relPath);
        const stat = await this.rootFs.stat(src).catch(() => null);
        // Skip directories — glob patterns like `.claude/**` may match the dir itself.
        if (!stat || stat.type !== 'file') continue;
        const dest = path.join(targetPath, relPath);
        await this.rootFs.mkdir(path.dirname(dest), { recursive: true });
        await this.rootFs.copyFile(src, dest);
      }
    }
  }
}
