import path from 'node:path';
import { filesContract } from '@emdash/core/runtimes/files/api';
import {
  gitContract,
  type CheckoutSelector,
  type GitBranchRef,
  type RepositorySelector,
} from '@emdash/core/runtimes/git/api';
import { err, ok, toSerializedError, type Result, type SerializedError } from '@emdash/shared';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { DEFAULT_REMOTE_NAME } from '@core/primitives/git/api';
import {
  fileKey,
  fileMutationKey,
  fileRelativePath,
  filesClientScope,
  fsErrorMessage,
  nativeFilePath,
  runFilesJob,
  singleFileChunk,
  type FilesClientScope,
} from '@main/core/files/runtime-client';
import {
  gitErrorMessage,
  gitFilePath,
  mutationResult,
  runGitJob,
} from '@main/core/git/runtime-client';
import {
  ensureAbsoluteDir,
  isRealPathContained,
  realPathAbsolute,
} from '@main/core/runtime/files-helpers';
import type { FilesRuntimeClient } from '@main/gateway/accessors';
import type { GitRuntimeClient } from '@main/gateway/accessors';
import { log } from '@main/lib/logger';
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
  private readonly git: GitRuntimeClient;
  private readonly files: FilesRuntimeClient;
  private readonly repository: RepositorySelector;
  private readonly checkout: CheckoutSelector;
  private readonly repoFiles: FilesClientScope;
  private readonly projectSettings: ProjectSettingsProvider;

  constructor(args: {
    repoPath: string;
    git: GitRuntimeClient;
    files: FilesRuntimeClient;
    repository: RepositorySelector;
    checkout: CheckoutSelector;
    projectSettings: ProjectSettingsProvider;
    resolveWorktreePoolPath: () => Promise<string>;
  }) {
    this.resolveWorktreePoolPath = args.resolveWorktreePoolPath;
    this.repoPath = args.repoPath;
    this.projectSettings = args.projectSettings;
    this.git = args.git;
    this.files = args.files;
    this.repository = args.repository;
    this.checkout = args.checkout;
    this.repoFiles = filesClientScope(args.files, args.repoPath);

    void mutationResult(
      this.git.repository.model.mutate('pruneWorktrees', {
        key: this.repository,
        input: {},
      })
    );
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
    const result = await this.git.repository.listWorktrees(this.repository);
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
    const scope = filesClientScope(this.files, rootPath);
    const exists = await this.files.fs.exists(fileKey(scope, absPath));
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
    const scope = filesClientScope(this.files, rootPath);
    const removed = await this.files.mutations.delete({
      ...fileMutationKey(scope, absPath),
      recursive: options?.recursive,
    });
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
    void mutationResult(
      this.git.repository.model.mutate('pruneWorktrees', {
        key: this.repository,
        input: {},
      })
    );
    return undefined;
  }

  private async resolveSourceBaseRef(
    sourceBranch: GitBranchRef | undefined
  ): Promise<string | undefined> {
    if (!sourceBranch) return undefined;

    if (sourceBranch.type === 'local') {
      const refs = (await this.git.repository.model.state(this.repository, 'refs').snapshot()).data;
      return refs.branches.some(
        (branch) => branch.type === 'local' && branch.branch === sourceBranch.branch
      )
        ? `refs/heads/${sourceBranch.branch}`
        : undefined;
    }

    const remoteName = sourceBranch.remote.name;
    await runGitJob(gitContract.repository.fetch, this.git.repository.fetch, {
      ...this.repository,
      remote: remoteName,
    });
    const remoteRef = `refs/remotes/${remoteName}/${sourceBranch.branch}`;
    const refs = (await this.git.repository.model.state(this.repository, 'refs').snapshot()).data;
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
    const current = await this.git.repository.getBranchBase({
      ...this.repository,
      branch: branchName,
    });
    if (current.success && current.data) return;

    const result = await mutationResult(
      this.git.repository.model.mutate('setBranchBase', {
        key: this.repository,
        input: { branch: branchName, base: baseRef },
      })
    );
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
    void mutationResult(
      this.git.repository.model.mutate('pruneWorktrees', {
        key: this.repository,
        input: {},
      })
    );
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
        await mutationResult(
          this.git.repository.model.mutate('pruneWorktrees', {
            key: this.repository,
            input: {},
          })
        );
      } catch (cause) {
        return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
      }
    }

    try {
      const refs = (await this.git.repository.model.state(this.repository, 'refs').snapshot()).data;
      const localExists = refs.branches.some(
        (branch) => branch.type === 'local' && branch.branch === branchName
      );

      if (!localExists) {
        const sourceRef = await this.resolveSourceBaseRef(sourceBranch);
        if (!sourceRef) {
          return err({ type: 'branch-not-found', branch: sourceBranch?.branch ?? branchName });
        }
        const created = await mutationResult(
          this.git.repository.model.mutate('createBranch', {
            key: this.repository,
            input: { options: { name: branchName, from: sourceRef } },
          })
        );
        if (!created.success) throw new Error(gitErrorMessage(created.error));
      }
      await this.ensureBranchBaseConfig(branchName, baseConfigValue);

      const poolPath = await this.resolveWorktreePoolPath();
      const parentDir = await ensureAbsoluteDir(poolPath, path.dirname(targetPath));
      if (!parentDir.success) {
        return err({ type: 'worktree-setup-failed', cause: fileErrorCause(parentDir.error) });
      }
      await mutationResult(
        this.git.repository.model.mutate('pruneWorktrees', {
          key: this.repository,
          input: {},
        })
      );
      const added = await mutationResult(
        this.git.repository.model.mutate('addWorktree', {
          key: this.repository,
          input: {
            options: {
              path: hostPathFromNative(targetPath),
              ref: branchName,
            },
          },
        })
      );
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
        await mutationResult(
          this.git.repository.model.mutate('pruneWorktrees', {
            key: this.repository,
            input: {},
          })
        );
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
        await runGitJob(gitContract.repository.fetch, this.git.repository.fetch, {
          ...this.repository,
          remote: remoteName,
        });
      }
      const refs = (await this.git.repository.model.state(this.repository, 'refs').snapshot()).data;
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
        const created = await mutationResult(
          this.git.repository.model.mutate('createBranch', {
            key: this.repository,
            input: { options: { name: branchName, from: upstream } },
          })
        );
        if (!created.success) throw new Error(gitErrorMessage(created.error));
        const tracked = await mutationResult(
          this.git.repository.model.mutate('setUpstream', {
            key: this.repository,
            input: { branch: branchName, upstream },
          })
        );
        if (!tracked.success) throw new Error(gitErrorMessage(tracked.error));
      }

      await mutationResult(
        this.git.repository.model.mutate('pruneWorktrees', {
          key: this.repository,
          input: {},
        })
      );
      const added = await mutationResult(
        this.git.repository.model.mutate('addWorktree', {
          key: this.repository,
          input: {
            options: {
              path: hostPathFromNative(targetPath),
              ref: branchName,
            },
          },
        })
      );
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
    const moved = await mutationResult(
      this.git.repository.model.mutate('moveWorktree', {
        key: this.repository,
        input: { from: hostPathFromNative(oldPath), to: hostPathFromNative(newPath) },
      })
    );
    if (!moved.success) throw new Error(gitErrorMessage(moved.error));
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    const removed = await mutationResult(
      this.git.repository.model.mutate('removeWorktree', {
        key: this.repository,
        input: { worktreePath: hostPathFromNative(worktreePath), force: true },
      })
    );
    if (!removed.success && (await this.existsAbsolute(worktreePath))) {
      await this.removePathForReuse(worktreePath);
    }
    await mutationResult(
      this.git.repository.model.mutate('pruneWorktrees', {
        key: this.repository,
        input: {},
      })
    );
  }

  private async isTrackedSourcePath(absPath: string): Promise<boolean> {
    const relPath = path.relative(this.repoPath, absPath);
    const tracked = await this.git.checkout.isFileTracked({
      ...this.checkout,
      path: gitFilePath(relPath),
    });
    return tracked.success && tracked.data;
  }

  private async copyPreservedFiles(targetPath: string): Promise<void> {
    const taskFiles = filesClientScope(this.files, targetPath);

    const settings = await getEffectiveTaskSettings({
      projectSettings: this.projectSettings,
      taskFiles,
      taskConfigPath: path.join(targetPath, '.emdash.json'),
    });
    const patterns = settings.preservePatterns ?? [];
    for (const pattern of patterns) {
      if (!isSafePreservePattern(nativePathOperations, pattern)) {
        log.warn('WorktreeService: skipping unsafe preserve pattern', { pattern });
        continue;
      }
      const matches = await runFilesJob(filesContract.fs.glob, this.files.fs.glob, {
        root: this.repoFiles.root,
        patterns: [pattern],
        options: { cwd: fileRelativePath(this.repoFiles, this.repoPath), dot: true },
      });
      if (!matches.success) {
        log.warn('WorktreeService: failed to match preserve pattern', {
          pattern,
          error: matches.error,
        });
        continue;
      }
      for (const relativePath of matches.data.paths) {
        const absPath = nativeFilePath(this.repoFiles, relativePath);
        const relPath = preservedRepoRelativePath(nativePathOperations, this.repoPath, absPath);
        if (!relPath || (await this.isTrackedSourcePath(absPath))) continue;
        const stat = await this.files.fs.stat(fileKey(this.repoFiles, absPath));
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
        const source = await this.files.fs.readBytes(fileKey(this.repoFiles, absPath));
        if (!source.success) {
          log.warn('WorktreeService: failed to copy preserved file', {
            sourcePath: absPath,
            destPath,
            error: source.error,
          });
          continue;
        }
        const bytes = await source.data.bytes();
        const copied = await this.files.fs.upload(
          { ...fileMutationKey(taskFiles, destPath), overwrite: true },
          {
            name: path.basename(destPath),
            mimeType: 'application/octet-stream',
            size: bytes.byteLength,
            source: singleFileChunk(bytes),
          }
        );
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
