import { promises as fsPromises } from 'node:fs';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import type { Branch } from '@shared/git';
import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import { getEffectiveTaskSettings } from '../settings/effective-task-settings';
import type { ProjectSettingsProvider } from '../settings/provider';
import type { WorktreeHost } from './hosts/worktree-host';

export type ServeWorktreeError =
  | { type: 'worktree-setup-failed'; cause: unknown }
  | { type: 'branch-not-found'; branch: string };

export class WorktreeService {
  private gitOpQueue: Promise<unknown> = Promise.resolve();
  private readonly resolveWorktreePoolPath: () => Promise<string>;
  private readonly repoPath: string;
  private readonly ctx: IExecutionContext;
  private readonly host: WorktreeHost;
  private readonly projectSettings: ProjectSettingsProvider;

  constructor(args: {
    repoPath: string;
    ctx: IExecutionContext;
    host: WorktreeHost;
    projectSettings: ProjectSettingsProvider;
    resolveWorktreePoolPath: () => Promise<string>;
  }) {
    this.resolveWorktreePoolPath = args.resolveWorktreePoolPath;
    this.repoPath = args.repoPath;
    this.projectSettings = args.projectSettings;
    this.ctx = args.ctx;
    this.host = args.host;

    this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
  }

  private enqueueGitOp<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.gitOpQueue.then(fn, fn);
    this.gitOpQueue = result.catch(() => {});
    return result as Promise<T>;
  }

  private async isValidWorktree(worktreePath: string): Promise<boolean> {
    // A linked worktree contains a .git FILE pointing to the main repo's worktrees
    // directory. For local execution we bypass host path-restriction checks and use
    // fs directly so external worktrees (outside allowedRoots) are still detected.
    // For SSH we rely on the host (SshWorktreeHost has no root restrictions).
    if (this.ctx.supportsLocalSpawn) {
      try {
        await fsPromises.access(this.host.pathApi.join(worktreePath, '.git'));
        return true;
      } catch {
        return false;
      }
    }
    return this.host.existsAbsolute(this.host.pathApi.join(worktreePath, '.git'));
  }

  /** Returns the resolved path to the worktree pool directory. */
  getWorktreePoolPath(): Promise<string> {
    return this.resolveWorktreePoolPath();
  }

  private async ensureWorktreePoolDirExists(): Promise<void> {
    await this.host.mkdirAbsolute(await this.resolveWorktreePoolPath(), { recursive: true });
  }

  private async removePathForReuse(targetPath: string): Promise<void> {
    const result = await this.host.removeAbsolute(targetPath, { recursive: true });
    if (!result.success) {
      throw new Error(
        result.error
          ? `Failed to remove stale worktree directory "${targetPath}": ${result.error}`
          : `Failed to remove stale worktree directory "${targetPath}"`
      );
    }

    if (await this.host.existsAbsolute(targetPath)) {
      throw new Error(
        `Failed to remove stale worktree directory "${targetPath}": path still exists`
      );
    }
  }

  private async getRemoteCandidates(): Promise<string[]> {
    const baseRemote = (await this.projectSettings.getBaseRemote().catch(() => '')).trim();
    if (!baseRemote || baseRemote === DEFAULT_REMOTE_NAME) {
      return [DEFAULT_REMOTE_NAME];
    }
    return [baseRemote, DEFAULT_REMOTE_NAME];
  }

  async existsAtAbsolutePath(absPath: string): Promise<boolean> {
    if (this.ctx.supportsLocalSpawn) {
      try {
        await fsPromises.access(absPath);
        return true;
      } catch {
        return false;
      }
    }
    return this.host.existsAbsolute(absPath);
  }

  async findBranchAnywhere(branchName: string): Promise<string | undefined> {
    try {
      const { stdout } = await this.ctx.exec('git', ['worktree', 'list', '--porcelain']);
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
        await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
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
        await this.ctx.exec('git', ['rev-parse', '--verify', localRef]);
        return localRef;
      } catch {
        return undefined;
      }
    }

    const remoteName = sourceBranch.remote.name;
    await this.ctx.exec('git', ['fetch', remoteName]).catch(() => {});
    const remoteRef = `refs/remotes/${remoteName}/${sourceBranch.branch}`;
    try {
      await this.ctx.exec('git', ['rev-parse', '--verify', remoteRef]);
      return remoteRef;
    } catch {
      return undefined;
    }
  }

  private getBranchBaseConfigValue(sourceBranch: Branch | undefined): string | undefined {
    if (!sourceBranch) return undefined;
    if (sourceBranch.type === 'local') return sourceBranch.branch;
    return `${sourceBranch.remote.name}/${sourceBranch.branch}`;
  }

  private async ensureBranchBaseConfig(
    branchName: string,
    baseRef: string | undefined
  ): Promise<void> {
    if (!baseRef) return;
    const key = `branch.${branchName}.base`;
    try {
      const { stdout } = await this.ctx.exec('git', ['config', '--get', key]);
      if (stdout.trim()) return;
    } catch {}

    try {
      await this.ctx.exec('git', ['config', key, baseRef]);
    } catch (error) {
      log.warn('WorktreeService: failed to set branch base metadata', {
        branchName,
        baseRef,
        error: String(error),
      });
    }
  }

  async getWorktree(branchName: string): Promise<string | undefined> {
    const worktreePoolPath = await this.resolveWorktreePoolPath();
    const worktreePath = this.host.pathApi.join(worktreePoolPath, branchName);
    if (await this.host.existsAbsolute(worktreePath)) {
      if (await this.isValidWorktree(worktreePath)) return worktreePath;
      try {
        await this.removePathForReuse(worktreePath);
      } catch {
        return undefined;
      }
    }

    try {
      const realPoolPath = await this.host.realPathAbsolute(worktreePoolPath);
      const { stdout } = await this.ctx.exec('git', ['worktree', 'list', '--porcelain']);
      const branchLine = `branch refs/heads/${branchName}`;
      for (const block of stdout.split('\n\n')) {
        if (block.split('\n').some((line) => line === branchLine)) {
          const match = /^worktree (.+)$/m.exec(block);
          const candidatePath = match?.[1];
          if (!candidatePath?.startsWith(realPoolPath)) continue;
          if (await this.isValidWorktree(candidatePath)) return candidatePath;
          await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
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
    const baseConfigValue = this.getBranchBaseConfigValue(sourceBranch);
    const checkedOutPath = await this.findBranchAnywhere(branchName);
    if (checkedOutPath) {
      await this.ensureBranchBaseConfig(branchName, baseConfigValue);
      return ok(checkedOutPath);
    }

    const targetPath = this.host.pathApi.join(await this.resolveWorktreePoolPath(), branchName);
    if (await this.host.existsAbsolute(targetPath)) {
      if (await this.isValidWorktree(targetPath)) {
        await this.ensureBranchBaseConfig(branchName, baseConfigValue);
        return ok(targetPath);
      }
      try {
        await this.removePathForReuse(targetPath);
        await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      } catch (cause) {
        return err({ type: 'worktree-setup-failed', cause });
      }
    }

    try {
      let localExists = false;
      try {
        await this.ctx.exec('git', ['rev-parse', '--verify', `refs/heads/${branchName}`]);
        localExists = true;
      } catch {}

      if (!localExists) {
        const sourceRef = await this.resolveSourceBaseRef(sourceBranch);
        if (!sourceRef) {
          return err({ type: 'branch-not-found', branch: sourceBranch?.branch ?? branchName });
        }
        await this.ctx.exec('git', ['branch', '--no-track', branchName, sourceRef]);
      }
      await this.ensureBranchBaseConfig(branchName, baseConfigValue);

      await this.host.mkdirAbsolute(this.host.pathApi.dirname(targetPath), { recursive: true });
      await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      await this.ctx.exec('git', ['worktree', 'add', targetPath, branchName]);
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
    const checkedOutPath = await this.findBranchAnywhere(branchName);
    if (checkedOutPath) {
      return ok(checkedOutPath);
    }

    const targetPath = this.host.pathApi.join(await this.resolveWorktreePoolPath(), branchName);
    const remoteCandidates = await this.getRemoteCandidates();

    if (await this.host.existsAbsolute(targetPath)) {
      if (await this.isValidWorktree(targetPath)) return ok(targetPath);
      try {
        await this.removePathForReuse(targetPath);
        await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      } catch (cause) {
        return err({ type: 'worktree-setup-failed', cause });
      }
    }

    try {
      await this.host.mkdirAbsolute(this.host.pathApi.dirname(targetPath), { recursive: true });
      for (const remoteName of remoteCandidates) {
        await this.ctx.exec('git', ['fetch', remoteName]).catch(() => {});
      }
      let localExists = false;
      try {
        await this.ctx.exec('git', ['rev-parse', '--verify', `refs/heads/${branchName}`]);
        localExists = true;
      } catch {}

      if (!localExists) {
        let trackingRemote: string | undefined;
        for (const remoteName of remoteCandidates) {
          try {
            await this.ctx.exec('git', [
              'rev-parse',
              '--verify',
              `refs/remotes/${remoteName}/${branchName}`,
            ]);
            trackingRemote = remoteName;
            break;
          } catch {}
        }
        if (!trackingRemote) {
          return err({ type: 'branch-not-found', branch: branchName });
        }
        await this.ctx.exec('git', [
          'branch',
          '--track',
          branchName,
          `${trackingRemote}/${branchName}`,
        ]);
      }

      await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      await this.ctx.exec('git', ['worktree', 'add', targetPath, branchName]);
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
    await this.ctx.exec('git', ['worktree', 'move', oldPath, newPath]);
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    await this.removePathForReuse(worktreePath).finally(() => {
      this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
    });
  }

  private taskConfigFs(targetPath: string): Pick<FileSystemProvider, 'exists' | 'read'> {
    return {
      exists: (filePath) => this.host.existsAbsolute(this.host.pathApi.join(targetPath, filePath)),
      read: async (filePath) => {
        const content = await this.host.readFileAbsolute(
          this.host.pathApi.join(targetPath, filePath)
        );
        return {
          content,
          truncated: false,
          totalSize: Buffer.byteLength(content),
        };
      },
    };
  }

  private async isTrackedSourcePath(relPath: string): Promise<boolean> {
    try {
      await this.ctx.exec('git', ['ls-files', '--error-unmatch', '--', relPath]);
      return true;
    } catch {
      return false;
    }
  }

  private async copyPreservedFiles(targetPath: string): Promise<void> {
    const settings = await getEffectiveTaskSettings({
      projectSettings: this.projectSettings,
      taskFs: this.taskConfigFs(targetPath) as FileSystemProvider,
    });
    const patterns = settings.preservePatterns ?? [];
    for (const pattern of patterns) {
      const matches = await this.host.globAbsolute(pattern, {
        cwd: this.repoPath,
        dot: true,
      });
      for (const relPath of matches) {
        if (relPath === '.emdash.json' || (await this.isTrackedSourcePath(relPath))) continue;
        const src = this.host.pathApi.join(this.repoPath, relPath);
        const stat = await this.host.statAbsolute(src).catch(() => null);
        if (!stat || stat.type !== 'file') continue;
        const dest = this.host.pathApi.join(targetPath, relPath);
        await this.host.mkdirAbsolute(this.host.pathApi.dirname(dest), { recursive: true });
        await this.host.copyFileAbsolute(src, dest);
      }
    }
  }
}

/**
 * The subset of WorktreeService methods required by WorkspaceBootstrapService.
 * Using Pick keeps signatures in sync automatically.
 */
export type WorktreeBootstrapOps = Pick<
  WorktreeService,
  | 'existsAtAbsolutePath'
  | 'findBranchAnywhere'
  | 'checkoutExistingBranch'
  | 'checkoutBranchWorktree'
>;
