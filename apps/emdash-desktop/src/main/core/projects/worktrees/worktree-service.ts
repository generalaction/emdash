import path from 'node:path';
import type { GitBranchRef } from '@emdash/core/git';
import { err, ok, toSerializedError, type Result, type SerializedError } from '@emdash/shared';
import { RuntimeFileSystem } from '@main/core/files/runtime-files';
import { fsErrorMessage, type ScopedFileSystem } from '@main/core/files/scoped-file-system';
import {
  gitErrorMessage,
  type RuntimeGitCheckout,
  type RuntimeGitRepository,
} from '@main/core/git/runtime-git';
import {
  ensureAbsoluteDir,
  isRealPathContained,
  realPathAbsolute,
} from '@main/core/runtime/files-helpers';
import { log } from '@main/lib/logger';
import { DEFAULT_REMOTE_NAME } from '@shared/core/git/types';
import { nativePathFromHost } from '@shared/core/runtime/paths';
import { getEffectiveTaskSettings } from '../settings/effective-task-settings';
import {
  isSafePreservePattern,
  preservedDestinationPath,
  preservedRepoRelativePath,
} from '../settings/preserve-pattern-safety';
import type { ProjectSettingsProvider } from '../settings/provider';

export type ServeWorktreeError =
  | { type: 'worktree-setup-failed'; cause: SerializedError }
  | { type: 'branch-not-found'; branch: string };

function fileErrorCause(error: Parameters<typeof fsErrorMessage>[0]): SerializedError {
  return { name: error.type, message: fsErrorMessage(error) };
}

export class WorktreeService {
  private gitOpQueue: Promise<unknown> = Promise.resolve();
  private readonly resolveWorktreePoolPath: () => Promise<string>;
  private readonly repoPath: string;
  private readonly gitRepository: RuntimeGitRepository;
  private readonly gitCheckout: RuntimeGitCheckout;
  private readonly repoFileSystem: ScopedFileSystem;
  private readonly projectSettings: ProjectSettingsProvider;

  constructor(args: {
    repoPath: string;
    gitRepository: RuntimeGitRepository;
    gitCheckout: RuntimeGitCheckout;
    projectSettings: ProjectSettingsProvider;
    resolveWorktreePoolPath: () => Promise<string>;
  }) {
    this.resolveWorktreePoolPath = args.resolveWorktreePoolPath;
    this.repoPath = args.repoPath;
    this.projectSettings = args.projectSettings;
    this.gitRepository = args.gitRepository;
    this.gitCheckout = args.gitCheckout;
    this.repoFileSystem = new RuntimeFileSystem(args.repoPath);

    void this.gitRepository.pruneWorktrees();
  }

  private enqueueGitOp<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.gitOpQueue.then(fn, fn);
    this.gitOpQueue = result.catch(() => {});
    return result as Promise<T>;
  }

  private async isValidWorktree(worktreePath: string): Promise<boolean> {
    const worktrees = await this.listWorktrees();
    const target = path.resolve(worktreePath);
    return worktrees.some(
      (worktree) => path.resolve(worktree.path) === target && !worktree.prunable
    );
  }

  private async listWorktrees(): Promise<
    Array<{
      path: string;
      head:
        | { kind: 'branch'; name: string }
        | { kind: 'detached' }
        | { kind: 'unborn'; name: string };
      prunable?: boolean;
    }>
  > {
    const result = await this.gitRepository.listWorktrees();
    if (!result.success) return [];
    return result.data.map((worktree) => ({
      path: nativePathFromHost(worktree.worktreePath),
      head: worktree.head,
      prunable: worktree.prunable,
    }));
  }

  /** Returns the resolved path to the worktree pool directory. */
  getWorktreePoolPath(): Promise<string> {
    return this.resolveWorktreePoolPath();
  }

  private async ensureWorktreePoolDirExists(): Promise<Result<void, ServeWorktreeError>> {
    const poolPath = await this.resolveWorktreePoolPath();
    const result = await ensureAbsoluteDir(path.dirname(poolPath), poolPath);
    return result.success
      ? ok()
      : err({ type: 'worktree-setup-failed', cause: fileErrorCause(result.error) });
  }

  private async removePathForReuse(targetPath: string): Promise<void> {
    const poolPath = await this.resolveWorktreePoolPath();
    const contained = await isRealPathContained(poolPath, targetPath, {
      candidateMustExist: true,
    });
    if (!contained.success || !contained.data) {
      throw new Error(`Refusing to remove worktree path outside pool: "${targetPath}"`);
    }

    const removed = await this.removeAbsolute(targetPath, { recursive: true });
    if (!removed.success) {
      throw new Error(
        `Failed to remove stale worktree directory "${targetPath}": ${removed.error.message}`
      );
    }

    if (await this.existsAbsolute(targetPath)) {
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
    return this.existsAbsolute(absPath);
  }

  private async existsAbsolute(absPath: string): Promise<boolean> {
    if (!path.isAbsolute(absPath)) return false;
    const rootPath = containsNativePath(this.repoPath, absPath)
      ? this.repoPath
      : path.dirname(absPath);
    const exists = await new RuntimeFileSystem(rootPath).exists(absPath);
    return exists.success ? exists.data : false;
  }

  private async removeAbsolute(
    absPath: string,
    options?: { recursive?: boolean }
  ): Promise<Result<void, { message: string }>> {
    if (!path.isAbsolute(absPath)) {
      return err({ message: `Expected absolute path: ${absPath}` });
    }
    const poolPath = await this.resolveWorktreePoolPath();
    const rootPath = containsNativePath(poolPath, absPath) ? poolPath : path.dirname(absPath);
    const removed = await new RuntimeFileSystem(rootPath).remove(absPath, options);
    if (!removed.success) return err({ message: fsErrorMessage(removed.error) });
    return ok<void>();
  }

  async findBranchAnywhere(branchName: string): Promise<string | undefined> {
    const worktree = (await this.listWorktrees()).find(
      (candidate) =>
        candidate.head.kind === 'branch' &&
        candidate.head.name === branchName &&
        !candidate.prunable
    );
    if (worktree) return worktree.path;
    void this.gitRepository.pruneWorktrees();
    return undefined;
  }

  private async resolveSourceBaseRef(
    sourceBranch: GitBranchRef | undefined
  ): Promise<string | undefined> {
    if (!sourceBranch) return undefined;

    if (sourceBranch.type === 'local') {
      const refs = await this.gitRepository.getRefs();
      return refs.branches.some(
        (branch) => branch.type === 'local' && branch.branch === sourceBranch.branch
      )
        ? `refs/heads/${sourceBranch.branch}`
        : undefined;
    }

    const remoteName = sourceBranch.remote.name;
    await this.gitRepository.fetch(remoteName);
    const remoteRef = `refs/remotes/${remoteName}/${sourceBranch.branch}`;
    const refs = await this.gitRepository.getRefs();
    return refs.branches.some(
      (branch) =>
        branch.type === 'remote' &&
        branch.remote.name === remoteName &&
        branch.branch === sourceBranch.branch
    )
      ? remoteRef
      : undefined;
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
    const current = await this.gitRepository.getBranchBase(branchName);
    if (current.success && current.data) return;

    const result = await this.gitRepository.setBranchBase(branchName, baseRef);
    if (!result.success) {
      log.warn('WorktreeService: failed to set branch base metadata', {
        branchName,
        baseRef,
        error: gitErrorMessage(result.error),
      });
    }
  }

  async getWorktree(branchName: string): Promise<string | undefined> {
    const worktreePoolPath = await this.resolveWorktreePoolPath();
    const worktreePath = path.join(worktreePoolPath, branchName);
    if (await this.existsAbsolute(worktreePath)) {
      if (await this.isValidWorktree(worktreePath)) return worktreePath;
      try {
        await this.removePathForReuse(worktreePath);
      } catch {
        return undefined;
      }
    }

    const realPoolPath = await realPathAbsolute(worktreePoolPath, worktreePoolPath);
    if (!realPoolPath.success) return undefined;
    const candidate = (await this.listWorktrees()).find(
      (worktree) =>
        worktree.head.kind === 'branch' &&
        worktree.head.name === branchName &&
        containsNativePath(realPoolPath.data, worktree.path) &&
        !worktree.prunable
    );
    if (candidate) return candidate.path;
    void this.gitRepository.pruneWorktrees();
    return undefined;
  }

  async checkoutBranchWorktree(
    sourceBranch: GitBranchRef | undefined,
    branchName: string,
    options: { copyPreservedFiles?: boolean } = {}
  ): Promise<Result<string, ServeWorktreeError>> {
    const poolDir = await this.ensureWorktreePoolDirExists();
    if (!poolDir.success) return poolDir;
    return this.enqueueGitOp(() =>
      this.doCheckoutBranchWorktree(sourceBranch, branchName, options)
    );
  }

  private async doCheckoutBranchWorktree(
    sourceBranch: GitBranchRef | undefined,
    branchName: string,
    options: { copyPreservedFiles?: boolean }
  ): Promise<Result<string, ServeWorktreeError>> {
    const baseConfigValue = this.getBranchBaseConfigValue(sourceBranch);
    const checkedOutPath = await this.findBranchAnywhere(branchName);
    if (checkedOutPath) {
      await this.ensureBranchBaseConfig(branchName, baseConfigValue);
      return ok(checkedOutPath);
    }

    const targetPath = path.join(await this.resolveWorktreePoolPath(), branchName);
    if (await this.existsAbsolute(targetPath)) {
      if (await this.isValidWorktree(targetPath)) {
        await this.ensureBranchBaseConfig(branchName, baseConfigValue);
        return ok(targetPath);
      }
      try {
        await this.removePathForReuse(targetPath);
        await this.gitRepository.pruneWorktrees();
      } catch (cause) {
        return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
      }
    }

    try {
      const refs = await this.gitRepository.getRefs();
      const localExists = refs.branches.some(
        (branch) => branch.type === 'local' && branch.branch === branchName
      );

      if (!localExists) {
        const sourceRef = await this.resolveSourceBaseRef(sourceBranch);
        if (!sourceRef) {
          return err({ type: 'branch-not-found', branch: sourceBranch?.branch ?? branchName });
        }
        const created = await this.gitRepository.createBranch({
          name: branchName,
          from: sourceRef,
        });
        if (!created.success) throw new Error(gitErrorMessage(created.error));
      }
      await this.ensureBranchBaseConfig(branchName, baseConfigValue);

      const poolPath = await this.resolveWorktreePoolPath();
      const parentDir = await ensureAbsoluteDir(poolPath, path.dirname(targetPath));
      if (!parentDir.success) {
        return err({ type: 'worktree-setup-failed', cause: fileErrorCause(parentDir.error) });
      }
      await this.gitRepository.pruneWorktrees();
      const added = await this.gitRepository.addWorktree({ path: targetPath, ref: branchName });
      if (!added.success) throw new Error(gitErrorMessage(added.error));
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
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
    const poolDir = await this.ensureWorktreePoolDirExists();
    if (!poolDir.success) return poolDir;
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

  private async doCheckoutExistingBranch(
    branchName: string,
    options: { copyPreservedFiles?: boolean }
  ): Promise<Result<string, ServeWorktreeError>> {
    const checkedOutPath = await this.findBranchAnywhere(branchName);
    if (checkedOutPath) {
      return ok(checkedOutPath);
    }

    const targetPath = path.join(await this.resolveWorktreePoolPath(), branchName);
    const remoteCandidates = await this.getRemoteCandidates();

    if (await this.existsAbsolute(targetPath)) {
      if (await this.isValidWorktree(targetPath)) return ok(targetPath);
      try {
        await this.removePathForReuse(targetPath);
        await this.gitRepository.pruneWorktrees();
      } catch (cause) {
        return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
      }
    }

    try {
      const poolPath = await this.resolveWorktreePoolPath();
      const parentDir = await ensureAbsoluteDir(poolPath, path.dirname(targetPath));
      if (!parentDir.success) {
        return err({ type: 'worktree-setup-failed', cause: fileErrorCause(parentDir.error) });
      }
      for (const remoteName of remoteCandidates) {
        await this.gitRepository.fetch(remoteName);
      }
      const refs = await this.gitRepository.getRefs();
      const localExists = refs.branches.some(
        (branch) => branch.type === 'local' && branch.branch === branchName
      );

      if (!localExists) {
        const trackingRemote = remoteCandidates.find((remoteName) =>
          refs.branches.some(
            (branch) =>
              branch.type === 'remote' &&
              branch.remote.name === remoteName &&
              branch.branch === branchName
          )
        );
        if (!trackingRemote) {
          return err({ type: 'branch-not-found', branch: branchName });
        }
        const upstream = `${trackingRemote}/${branchName}`;
        const created = await this.gitRepository.createBranch({
          name: branchName,
          from: upstream,
        });
        if (!created.success) throw new Error(gitErrorMessage(created.error));
        const tracked = await this.gitRepository.setUpstream(branchName, upstream);
        if (!tracked.success) throw new Error(gitErrorMessage(tracked.error));
      }

      await this.gitRepository.pruneWorktrees();
      const added = await this.gitRepository.addWorktree({ path: targetPath, ref: branchName });
      if (!added.success) throw new Error(gitErrorMessage(added.error));
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
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
    const moved = await this.gitRepository.moveWorktree(oldPath, newPath);
    if (!moved.success) throw new Error(gitErrorMessage(moved.error));
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    const removed = await this.gitRepository.removeWorktree(worktreePath, true);
    if (!removed.success && (await this.existsAbsolute(worktreePath))) {
      await this.removePathForReuse(worktreePath);
    }
    await this.gitRepository.pruneWorktrees();
  }

  private taskConfigFs(rootPath: string): ScopedFileSystem {
    return new RuntimeFileSystem(rootPath);
  }

  private async isTrackedSourcePath(absPath: string): Promise<boolean> {
    const relPath = path.relative(this.repoPath, absPath);
    const tracked = await this.gitCheckout.isFileTracked(relPath);
    return tracked.success && tracked.data;
  }

  private async copyPreservedFiles(targetPath: string): Promise<void> {
    const taskFs = this.taskConfigFs(targetPath);

    const settings = await getEffectiveTaskSettings({
      projectSettings: this.projectSettings,
      taskFs,
      taskConfigPath: path.join(targetPath, '.emdash.json'),
    });
    const patterns = settings.preservePatterns ?? [];
    for (const pattern of patterns) {
      if (!isSafePreservePattern(nativePathOperations, pattern)) {
        log.warn('WorktreeService: skipping unsafe preserve pattern', { pattern });
        continue;
      }
      const matches = this.repoFileSystem.glob([pattern], { cwd: this.repoPath, dot: true });
      if (!matches.success) {
        log.warn('WorktreeService: failed to match preserve pattern', {
          pattern,
          error: matches.error,
        });
        continue;
      }
      for await (const absPath of matches.data) {
        const relPath = preservedRepoRelativePath(nativePathOperations, this.repoPath, absPath);
        if (!relPath || (await this.isTrackedSourcePath(absPath))) continue;
        const stat = await this.repoFileSystem.stat(absPath);
        if (!stat.success || stat.data.type !== 'file') continue;
        const destPath = preservedDestinationPath(nativePathOperations, targetPath, relPath);
        if (!destPath) continue;
        const contained = await isRealPathContained(targetPath, destPath);
        if (!contained.success || !contained.data) {
          log.warn('WorktreeService: skipping preserved file with out-of-worktree destination', {
            destPath,
          });
          continue;
        }
        const source = await this.repoFileSystem.readBytes(absPath);
        if (!source.success) {
          log.warn('WorktreeService: failed to copy preserved file', {
            sourcePath: absPath,
            destPath,
            error: source.error,
          });
          continue;
        }
        const copied = await taskFs.writeBytes(destPath, source.data.bytes);
        if (!copied.success) {
          log.warn('WorktreeService: failed to copy preserved file', {
            sourcePath: absPath,
            destPath,
            error: copied.error,
          });
        }
      }
    }
  }
}

const nativePathOperations = {
  join: path.join,
  isAbsolute: path.isAbsolute,
  relative: path.relative,
  contains: containsNativePath,
};

function containsNativePath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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
>;
