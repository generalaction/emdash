import { promises as fsPromises } from 'node:fs';
import type { GitBranchRef } from '@emdash/core/git';
import { err, ok, type Result } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import { DEFAULT_REMOTE_NAME } from '@shared/core/git/types';
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
    let hasGitFile = false;
    if (this.ctx.supportsLocalSpawn) {
      try {
        await fsPromises.access(this.host.pathApi.join(worktreePath, '.git'));
        hasGitFile = true;
      } catch {
        return false;
      }
    } else {
      hasGitFile = await this.host.existsAbsolute(this.host.pathApi.join(worktreePath, '.git'));
    }
    if (!hasGitFile) return false;

    try {
      const { stdout } = await this.ctx.exec('git', [
        '-C',
        worktreePath,
        'rev-parse',
        '--is-inside-work-tree',
      ]);
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  private async isValidBranchWorktree(worktreePath: string, branchName: string): Promise<boolean> {
    if (!(await this.isValidWorktree(worktreePath))) return false;

    try {
      const { stdout } = await this.ctx.exec('git', [
        '-C',
        worktreePath,
        'rev-parse',
        '--abbrev-ref',
        'HEAD',
      ]);
      return stdout.trim() === branchName;
    } catch {
      return false;
    }
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

  private async assertStaleTargetSafeForReuse(targetPath: string): Promise<void> {
    const allowedGeneratedDirectories = new Set(['node_modules']);
    const entries = await this.host.globAbsolute('*', { cwd: targetPath, dot: true });
    for (const entry of entries) {
      const stat = await this.host.statAbsolute(this.host.pathApi.join(targetPath, entry));
      if (stat?.type === 'dir' && allowedGeneratedDirectories.has(entry)) continue;
      throw new Error(
        `Refusing to remove stale worktree directory "${targetPath}" because it contains "${entry}"`
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

  private async isInCurrentWorktreePool(candidatePath: string): Promise<boolean> {
    try {
      const realPoolPath = await this.host.realPathAbsolute(await this.resolveWorktreePoolPath());
      const realCandidatePath = await this.host.realPathAbsolute(candidatePath);
      return (
        realCandidatePath === realPoolPath ||
        realCandidatePath.startsWith(`${realPoolPath}/`) ||
        realCandidatePath.startsWith(`${realPoolPath}\\`)
      );
    } catch {
      return false;
    }
  }

  private async resolveSourceBaseRef(
    sourceBranch: GitBranchRef | undefined
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

  private getBranchBaseConfigValue(sourceBranch: GitBranchRef | undefined): string | undefined {
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
    sourceBranch: GitBranchRef | undefined,
    branchName: string,
    options: { copyPreservedFiles?: boolean } = {}
  ): Promise<Result<string, ServeWorktreeError>> {
    await this.ensureWorktreePoolDirExists();
    return this.enqueueGitOp(() =>
      this.doCheckoutBranchWorktree(sourceBranch, branchName, options)
    );
  }

  private async doCheckoutBranchWorktree(
    sourceBranch: GitBranchRef | undefined,
    branchName: string,
    options: { copyPreservedFiles?: boolean; targetPath?: string }
  ): Promise<Result<string, ServeWorktreeError>> {
    const baseConfigValue = this.getBranchBaseConfigValue(sourceBranch);
    const targetPath =
      options.targetPath ??
      this.host.pathApi.join(await this.resolveWorktreePoolPath(), branchName);

    if (options.targetPath) {
      const prepared = await this.prepareExplicitWorktreeTarget(
        branchName,
        targetPath,
        baseConfigValue
      );
      if (!prepared.success) return prepared;
      if (prepared.data.kind === 'ready') return ok(prepared.data.path);
    } else {
      const checkedOutPath = await this.findBranchAnywhere(branchName);
      if (checkedOutPath) {
        await this.ensureBranchBaseConfig(branchName, baseConfigValue);
        return ok(checkedOutPath);
      }
    }

    if (await this.host.existsAbsolute(targetPath)) {
      if (await this.isValidWorktree(targetPath)) {
        await this.ensureBranchBaseConfig(branchName, baseConfigValue);
        return ok(targetPath);
      }
      try {
        await this.assertStaleTargetSafeForReuse(targetPath);
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

    if (options.copyPreservedFiles ?? true) {
      await this.copyPreservedFiles(targetPath).catch((e) => {
        log.warn('WorktreeService: failed to copy preserved files', {
          targetPath,
          error: String(e),
        });
      });
    }

    return ok(targetPath);
  }

  async checkoutExistingBranch(
    branchName: string,
    options: { copyPreservedFiles?: boolean } = {}
  ): Promise<Result<string, ServeWorktreeError>> {
    await this.ensureWorktreePoolDirExists();
    return this.enqueueGitOp(() => this.doCheckoutExistingBranch(branchName, options));
  }

  async serveBranchWorktree(
    branchName: string,
    sourceBranch?: GitBranchRef,
    copyPreservedFiles?: boolean
  ): Promise<Result<string, ServeWorktreeError>> {
    const existing = await this.getWorktree(branchName);
    if (existing) return ok(existing);

    if (!sourceBranch || branchName === sourceBranch.branch) {
      return this.checkoutExistingBranch(branchName, { copyPreservedFiles });
    }

    return this.checkoutBranchWorktree(sourceBranch, branchName, { copyPreservedFiles });
  }

  async serveBranchWorktreeAtPath(
    branchName: string,
    sourceBranch: GitBranchRef | undefined,
    targetPath: string,
    copyPreservedFiles?: boolean
  ): Promise<Result<string, ServeWorktreeError>> {
    return this.enqueueGitOp(() => {
      if (!sourceBranch || branchName === sourceBranch.branch) {
        return this.doCheckoutExistingBranch(branchName, { copyPreservedFiles, targetPath });
      }
      return this.doCheckoutBranchWorktree(sourceBranch, branchName, {
        copyPreservedFiles,
        targetPath,
      });
    });
  }

  private async prepareExplicitWorktreeTarget(
    branchName: string,
    targetPath: string,
    baseConfigValue?: string
  ): Promise<Result<{ kind: 'ready'; path: string } | { kind: 'create' }, ServeWorktreeError>> {
    await this.host.allowPath?.(targetPath);
    const targetIsInCurrentPool = await this.isInCurrentWorktreePool(targetPath);

    if (await this.host.existsAbsolute(targetPath)) {
      if (await this.isValidBranchWorktree(targetPath, branchName)) {
        await this.ensureBranchBaseConfig(branchName, baseConfigValue);
        return ok({ kind: 'ready', path: targetPath });
      }

      if (await this.isValidWorktree(targetPath)) {
        return err({
          type: 'worktree-setup-failed',
          cause: new Error(
            `Stored worktree path "${targetPath}" is already a valid worktree for another branch`
          ),
        });
      }

      if (!targetIsInCurrentPool) {
        return err({
          type: 'worktree-setup-failed',
          cause: new Error(
            `Stored worktree path "${targetPath}" exists but is not an Emdash-managed worktree path`
          ),
        });
      }

      try {
        await this.assertStaleTargetSafeForReuse(targetPath);
        await this.removePathForReuse(targetPath);
        await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      } catch (cause) {
        return err({ type: 'worktree-setup-failed', cause });
      }
    }

    const checkedOutPath = await this.findBranchAnywhere(branchName);
    if (!checkedOutPath) return ok({ kind: 'create' });

    if (!(await this.isInCurrentWorktreePool(checkedOutPath))) {
      return err({
        type: 'worktree-setup-failed',
        cause: new Error(
          `Branch "${branchName}" is already checked out at "${checkedOutPath}", outside the stored workspace path`
        ),
      });
    }

    try {
      await this.host.mkdirAbsolute(this.host.pathApi.dirname(targetPath), { recursive: true });
      await this.ctx.exec('git', ['worktree', 'move', checkedOutPath, targetPath]);
      await this.ensureBranchBaseConfig(branchName, baseConfigValue);
      return ok({ kind: 'ready', path: targetPath });
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause });
    }
  }

  private async doCheckoutExistingBranch(
    branchName: string,
    options: { copyPreservedFiles?: boolean; targetPath?: string }
  ): Promise<Result<string, ServeWorktreeError>> {
    const targetPath =
      options.targetPath ??
      this.host.pathApi.join(await this.resolveWorktreePoolPath(), branchName);
    const remoteCandidates = await this.getRemoteCandidates();

    if (options.targetPath) {
      const prepared = await this.prepareExplicitWorktreeTarget(branchName, targetPath);
      if (!prepared.success) return prepared;
      if (prepared.data.kind === 'ready') return ok(prepared.data.path);
    } else {
      const checkedOutPath = await this.findBranchAnywhere(branchName);
      if (checkedOutPath) {
        return ok(checkedOutPath);
      }

      if (await this.host.existsAbsolute(targetPath)) {
        if (await this.isValidWorktree(targetPath)) return ok(targetPath);
        try {
          await this.assertStaleTargetSafeForReuse(targetPath);
          await this.removePathForReuse(targetPath);
          await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
        } catch (cause) {
          return err({ type: 'worktree-setup-failed', cause });
        }
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

    if (options.copyPreservedFiles ?? true) {
      await this.copyPreservedFiles(targetPath).catch((e) => {
        log.warn('WorktreeService: failed to copy preserved files', {
          targetPath,
          error: String(e),
        });
      });
    }

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
  | 'serveBranchWorktree'
  | 'serveBranchWorktreeAtPath'
>;
