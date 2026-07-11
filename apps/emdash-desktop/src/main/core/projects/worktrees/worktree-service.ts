import type { IFileSystem } from '@emdash/core/files';
import type { GitBranchRef } from '@emdash/core/git';
import { err, ok, toSerializedError, type Result, type SerializedError } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  ensureAbsoluteDir,
  isRealPathContained,
  openFileSystem,
  realPathAbsolute,
} from '@main/core/runtime/files-helpers';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { log } from '@main/lib/logger';
import { DEFAULT_REMOTE_NAME } from '@shared/core/git/types';
import { shareableProjectSettingsSchema } from '@shared/core/project-settings/project-settings';
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

export type CreateWorktreeAtCommitError =
  | { type: 'invalid-commit'; commit: string }
  | { type: 'commit-not-found'; commit: string }
  | { type: 'branch-exists'; branch: string }
  | { type: 'worktree-setup-failed'; cause: SerializedError };

export type CopyPreservedFilesError =
  | { type: 'preserve-config-unavailable'; message: string }
  | { type: 'preserve-glob-failed'; pattern: string; message: string }
  | { type: 'preserve-source-failed'; pattern: string; message: string }
  | { type: 'preserve-copy-failed'; pattern: string; message: string };

export type RemoveGeneratedWorktreeError = {
  type: 'worktree-remove-failed';
  message: string;
};

function fileErrorCause(error: { type?: string; message: string }): SerializedError {
  return { name: error.type ?? 'FileError', message: error.message };
}

export class WorktreeService {
  private gitOpQueue: Promise<unknown> = Promise.resolve();
  private readonly resolveWorktreePoolPath: () => Promise<string>;
  private readonly repoPath: string;
  private readonly ctx: IExecutionContext;
  private readonly files: IFilesRuntime;
  private readonly projectSettings: ProjectSettingsProvider;

  constructor(args: {
    repoPath: string;
    ctx: IExecutionContext;
    files: IFilesRuntime;
    projectSettings: ProjectSettingsProvider;
    resolveWorktreePoolPath: () => Promise<string>;
  }) {
    this.resolveWorktreePoolPath = args.resolveWorktreePoolPath;
    this.repoPath = args.repoPath;
    this.projectSettings = args.projectSettings;
    this.ctx = args.ctx;
    this.files = args.files;

    this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
  }

  private enqueueGitOp<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.gitOpQueue.then(fn, fn);
    this.gitOpQueue = result.catch(() => {});
    return result as Promise<T>;
  }

  private async isValidWorktree(worktreePath: string): Promise<boolean> {
    // A linked worktree contains a .git FILE pointing to the main repo's worktrees
    // directory.
    const hasGitFile = await this.existsAbsolute(this.files.path.join(worktreePath, '.git'));
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

  /** Returns the resolved path to the worktree pool directory. */
  getWorktreePoolPath(): Promise<string> {
    return this.resolveWorktreePoolPath();
  }

  private async ensureWorktreePoolDirExists(): Promise<Result<void, ServeWorktreeError>> {
    const result = await ensureAbsoluteDir(this.files, await this.resolveWorktreePoolPath());
    return result.success
      ? ok()
      : err({ type: 'worktree-setup-failed', cause: fileErrorCause(result.error) });
  }

  private async removePathForReuse(targetPath: string): Promise<void> {
    const poolPath = await this.resolveWorktreePoolPath();
    const contained = await isRealPathContained(this.files, poolPath, targetPath, {
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
    if (!this.files.path.isAbsolute(absPath)) return false;
    const opened = this.files.fileSystem();
    if (!opened.success) return false;
    const exists = await opened.data.exists(absPath);
    return exists.success ? exists.data : false;
  }

  private async removeAbsolute(
    absPath: string,
    options?: { recursive?: boolean }
  ): Promise<Result<void, { message: string }>> {
    if (!this.files.path.isAbsolute(absPath)) {
      return err({ message: `Expected absolute path: ${absPath}` });
    }
    const fs = openFileSystem(this.files);
    if (!fs.success) return err({ message: fs.error.message });
    const removed = await fs.data.remove(absPath, options);
    if (!removed.success) return err({ message: removed.error.message });
    return ok<void>();
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
    const worktreePath = this.files.path.join(worktreePoolPath, branchName);
    if (await this.existsAbsolute(worktreePath)) {
      if (await this.isValidWorktree(worktreePath)) return worktreePath;
      try {
        await this.removePathForReuse(worktreePath);
      } catch {
        return undefined;
      }
    }

    try {
      const realPoolPath = await realPathAbsolute(this.files, worktreePoolPath);
      if (!realPoolPath.success) return undefined;
      const { stdout } = await this.ctx.exec('git', ['worktree', 'list', '--porcelain']);
      const branchLine = `branch refs/heads/${branchName}`;
      for (const block of stdout.split('\n\n')) {
        if (block.split('\n').some((line) => line === branchLine)) {
          const match = /^worktree (.+)$/m.exec(block);
          const candidatePath = match?.[1];
          if (!candidatePath || !this.files.path.contains(realPoolPath.data, candidatePath))
            continue;
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
    const poolDir = await this.ensureWorktreePoolDirExists();
    if (!poolDir.success) {
      return poolDir.error.type === 'worktree-setup-failed'
        ? err(poolDir.error)
        : err({
            type: 'worktree-setup-failed',
            cause: { name: 'WorktreePoolError', message: 'Worktree pool could not be prepared.' },
          });
    }
    return this.enqueueGitOp(() =>
      this.doCheckoutBranchWorktree(sourceBranch, branchName, options)
    );
  }

  async createWorktreeAtCommit(
    commit: string,
    branchName: string
  ): Promise<Result<string, CreateWorktreeAtCommitError>> {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commit)) {
      return err({ type: 'invalid-commit', commit });
    }

    const poolDir = await this.ensureWorktreePoolDirExists();
    if (!poolDir.success) {
      return poolDir.error.type === 'worktree-setup-failed'
        ? err(poolDir.error)
        : err({
            type: 'worktree-setup-failed',
            cause: { name: 'WorktreePoolError', message: 'Worktree pool could not be prepared.' },
          });
    }
    return this.enqueueGitOp(() => this.doCreateWorktreeAtCommit(commit, branchName));
  }

  private async doCreateWorktreeAtCommit(
    commit: string,
    branchName: string
  ): Promise<Result<string, CreateWorktreeAtCommitError>> {
    try {
      await this.ctx.exec('git', ['cat-file', '-e', `${commit}^{commit}`]);
    } catch {
      return err({ type: 'commit-not-found', commit });
    }

    try {
      await this.ctx.exec('git', ['check-ref-format', '--branch', branchName]);
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
    }

    try {
      const ref = `refs/heads/${branchName}`;
      const listed = await this.ctx.exec('git', ['for-each-ref', '--format=%(refname)', ref]);
      if (listed.stdout.trim() === ref) return err({ type: 'branch-exists', branch: branchName });
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
    }

    const targetPath = this.files.path.join(await this.resolveWorktreePoolPath(), branchName);
    if (await this.existsAbsolute(targetPath)) {
      try {
        if (await this.isValidWorktree(targetPath)) {
          return err({ type: 'branch-exists', branch: branchName });
        }
        await this.removePathForReuse(targetPath);
        await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      } catch (cause) {
        return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
      }
    }

    try {
      const parentDir = await ensureAbsoluteDir(this.files, this.files.path.dirname(targetPath));
      if (!parentDir.success) {
        return err({ type: 'worktree-setup-failed', cause: fileErrorCause(parentDir.error) });
      }
      await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      await this.ctx.exec('git', ['worktree', 'add', '-b', branchName, targetPath, commit]);
      const { stdout } = await this.ctx.exec('git', ['-C', targetPath, 'rev-parse', 'HEAD']);
      if (stdout.trim().toLowerCase() !== commit.toLowerCase()) {
        throw new Error('Created worktree did not resolve to the requested immutable commit');
      }
      return ok(targetPath);
    } catch (cause) {
      const rollback = await this.rollbackGeneratedWorktree(targetPath, branchName);
      if (!rollback.success) {
        return err({
          type: 'worktree-setup-failed',
          cause: {
            name: 'WorktreeRollbackError',
            message: 'Generated worktree creation failed and rollback was incomplete.',
          },
        });
      }
      return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
    }
  }

  private async rollbackGeneratedWorktree(
    targetPath: string,
    branchName: string
  ): Promise<Result<void, { message: string }>> {
    let failed = false;
    if (await this.existsAbsolute(targetPath)) {
      await this.removePathForReuse(targetPath).catch(() => {
        failed = true;
      });
    }
    await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {
      failed = true;
    });
    try {
      const ref = `refs/heads/${branchName}`;
      const listed = await this.ctx.exec('git', ['for-each-ref', '--format=%(refname)', ref]);
      if (listed.stdout.trim() === ref) {
        await this.ctx.exec('git', ['branch', '--delete', '--force', branchName]);
      }
    } catch {
      failed = true;
    }
    return failed ? err({ message: 'Generated worktree rollback was incomplete.' }) : ok();
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

    const targetPath = this.files.path.join(await this.resolveWorktreePoolPath(), branchName);
    if (await this.existsAbsolute(targetPath)) {
      if (await this.isValidWorktree(targetPath)) {
        await this.ensureBranchBaseConfig(branchName, baseConfigValue);
        return ok(targetPath);
      }
      try {
        await this.removePathForReuse(targetPath);
        await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      } catch (cause) {
        return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
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

      const parentDir = await ensureAbsoluteDir(this.files, this.files.path.dirname(targetPath));
      if (!parentDir.success) {
        return err({ type: 'worktree-setup-failed', cause: fileErrorCause(parentDir.error) });
      }
      await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      await this.ctx.exec('git', ['worktree', 'add', targetPath, branchName]);
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

    const targetPath = this.files.path.join(await this.resolveWorktreePoolPath(), branchName);
    const remoteCandidates = await this.getRemoteCandidates();

    if (await this.existsAbsolute(targetPath)) {
      if (await this.isValidWorktree(targetPath)) return ok(targetPath);
      try {
        await this.removePathForReuse(targetPath);
        await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
      } catch (cause) {
        return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
      }
    }

    try {
      const parentDir = await ensureAbsoluteDir(this.files, this.files.path.dirname(targetPath));
      if (!parentDir.success) {
        return err({ type: 'worktree-setup-failed', cause: fileErrorCause(parentDir.error) });
      }
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
    await this.ctx.exec('git', ['worktree', 'move', oldPath, newPath]);
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    await this.removePathForReuse(worktreePath).finally(() => {
      this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
    });
  }

  async removeGeneratedWorktreeIfPresent(
    worktreePath: string
  ): Promise<Result<{ removed: boolean }, RemoveGeneratedWorktreeError>> {
    if (!this.files.path.isAbsolute(worktreePath)) {
      return err({
        type: 'worktree-remove-failed',
        message: 'Generated worktree path could not be validated.',
      });
    }
    const fs = openFileSystem(this.files);
    if (!fs.success) {
      return err({
        type: 'worktree-remove-failed',
        message: 'Generated worktree filesystem could not be opened.',
      });
    }
    const exists = await fs.data.exists(worktreePath);
    if (!exists.success) {
      return err({
        type: 'worktree-remove-failed',
        message: 'Generated worktree presence could not be verified.',
      });
    }
    if (exists.data) {
      try {
        await this.removePathForReuse(worktreePath);
      } catch {
        return err({
          type: 'worktree-remove-failed',
          message: 'Generated worktree could not be removed safely.',
        });
      }
    }
    try {
      await this.ctx.exec('git', ['worktree', 'prune']);
    } catch {
      return err({
        type: 'worktree-remove-failed',
        message: 'Generated worktree metadata could not be pruned.',
      });
    }
    return ok({ removed: exists.data });
  }

  private taskConfigFs(): IFileSystem | null {
    const opened = this.files.fileSystem();
    if (opened.success) return opened.data;
    log.warn('WorktreeService: failed to open task config filesystem', opened.error);
    return null;
  }

  private async inspectTrackedSourcePath(
    absPath: string
  ): Promise<Result<boolean, { message: string }>> {
    try {
      const relPath = this.files.path.relative(this.repoPath, absPath);
      const result = await this.ctx.exec('git', ['ls-files', '--cached', '-z', '--', relPath]);
      return ok(result.stdout.length > 0);
    } catch {
      return err({ message: 'Tracked status could not be verified.' });
    }
  }

  private async copyPreservedFiles(targetPath: string): Promise<void> {
    const result = await this.copyPreservedFilesToWorktree(targetPath, { strict: false });
    if (!result.success) {
      log.warn('WorktreeService: failed to copy preserved files', result.error);
    }
  }

  async copyPreservedFilesToWorktree(
    targetPath: string,
    options: { strict?: boolean } = {}
  ): Promise<Result<{ copied: string[] }, CopyPreservedFilesError>> {
    const strict = options.strict ?? true;
    const taskFs = this.taskConfigFs();
    if (!taskFs) {
      return err({
        type: 'preserve-config-unavailable',
        message: 'Required preserve settings could not be resolved.',
      });
    }

    const taskConfigPath = this.files.path.join(targetPath, '.emdash.json');
    if (strict) {
      const validConfig = await this.validateFeatureConfig(taskFs, taskConfigPath);
      if (!validConfig.success) return validConfig;
    }
    let settings: Awaited<ReturnType<typeof getEffectiveTaskSettings>>;
    try {
      settings = await getEffectiveTaskSettings({
        projectSettings: this.projectSettings,
        taskFs,
        taskConfigPath,
      });
    } catch {
      return err({
        type: 'preserve-config-unavailable',
        message: 'Required preserve settings could not be resolved.',
      });
    }
    const patterns = settings.preservePatterns ?? [];
    const repoFs = this.files.fileSystem();
    if (!repoFs.success) {
      return err({
        type: 'preserve-config-unavailable',
        message: 'Required preserve source could not be opened.',
      });
    }
    const copied: string[] = [];
    for (const pattern of patterns) {
      if (!isSafePreservePattern(this.files.path, pattern)) {
        continue;
      }
      const matches = repoFs.data.glob([pattern], { cwd: this.repoPath, dot: true });
      if (!matches.success) {
        if (!strict) continue;
        return err({
          type: 'preserve-glob-failed',
          pattern,
          message: 'Required preserve pattern could not be matched.',
        });
      }
      let matchedSource = false;
      try {
        for await (const absPath of matches.data) {
          matchedSource = true;
          const sourceContained = await isRealPathContained(this.files, this.repoPath, absPath, {
            candidateMustExist: true,
          });
          if (!sourceContained.success) {
            if (!strict) continue;
            return err({
              type: 'preserve-source-failed',
              pattern,
              message: 'Required preserve source could not be validated.',
            });
          }
          if (!sourceContained.data) continue;

          const relPath = preservedRepoRelativePath(this.files.path, this.repoPath, absPath);
          if (!relPath) continue;
          const tracked = await this.inspectTrackedSourcePath(absPath);
          if (!tracked.success) {
            if (!strict) continue;
            return err({
              type: 'preserve-source-failed',
              pattern,
              message: 'Required preserve source tracking status could not be verified.',
            });
          }
          if (tracked.data) continue;
          const stat = await repoFs.data.stat(absPath);
          if (!stat.success) {
            if (!strict) continue;
            return err({
              type: 'preserve-source-failed',
              pattern,
              message: 'Required preserve source could not be read.',
            });
          }
          if (stat.data.type !== 'file') continue;
          const destPath = preservedDestinationPath(this.files.path, targetPath, relPath);
          if (!destPath) continue;
          const contained = await isRealPathContained(this.files, targetPath, destPath);
          if (!contained.success) {
            if (!strict) continue;
            return err({
              type: 'preserve-copy-failed',
              pattern,
              message: 'Required preserve destination could not be validated.',
            });
          }
          if (!contained.data) continue;
          const copyResult = await repoFs.data.copyFile(absPath, destPath);
          if (!copyResult.success) {
            if (!strict) continue;
            return err({
              type: 'preserve-copy-failed',
              pattern,
              message: 'Required preserve pattern could not be copied.',
            });
          }
          copied.push(relPath);
        }
      } catch {
        if (!strict) continue;
        return err({
          type: 'preserve-source-failed',
          pattern,
          message: 'Required preserve source could not be enumerated.',
        });
      }
      if (strict && !matchedSource) {
        return err({
          type: 'preserve-source-failed',
          pattern,
          message: 'Required preserve pattern did not match a source file.',
        });
      }
    }
    return ok({ copied });
  }

  private async validateFeatureConfig(
    taskFs: Pick<IFileSystem, 'exists' | 'readText'>,
    taskConfigPath: string
  ): Promise<Result<void, CopyPreservedFilesError>> {
    const exists = await taskFs.exists(taskConfigPath);
    if (!exists.success) {
      return err({
        type: 'preserve-config-unavailable',
        message: 'Feature .emdash.json could not be read safely.',
      });
    }
    if (!exists.data) return ok();
    const content = await taskFs.readText(taskConfigPath);
    if (!content.success || content.data.truncated) {
      return err({
        type: 'preserve-config-unavailable',
        message: 'Feature .emdash.json could not be read safely.',
      });
    }
    try {
      shareableProjectSettingsSchema.parse(JSON.parse(content.data.content));
      return ok();
    } catch {
      return err({
        type: 'preserve-config-unavailable',
        message: 'Feature .emdash.json could not be read safely.',
      });
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
>;
