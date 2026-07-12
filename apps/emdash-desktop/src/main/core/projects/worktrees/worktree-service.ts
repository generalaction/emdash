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
  | { type: 'cancelled'; message: string }
  | { type: 'deadline-exceeded'; message: string }
  | { type: 'worktree-rollback-incomplete'; message: string }
  | { type: 'worktree-setup-failed'; cause: SerializedError };

export type CopyPreservedFilesError =
  | { type: 'invalid-generated-worktree'; message: string }
  | { type: 'preserve-config-unavailable'; message: string }
  | { type: 'preserve-glob-failed'; pattern: string; message: string }
  | { type: 'preserve-source-failed'; pattern: string; message: string }
  | { type: 'preserve-copy-failed'; pattern: string; message: string };

export type RemoveGeneratedWorktreeError = {
  type: 'worktree-remove-failed';
  message: string;
};

export type GeneratedWorktreeValidationError = {
  type: 'invalid-generated-worktree';
  message: string;
};

export type CreateWorktreeOperationControl = {
  signal?: AbortSignal;
  deadlineAt?: number;
  expectedTargetPath?: string;
};

class WorktreeOperationStopped extends Error {
  constructor(
    readonly failure: Extract<
      CreateWorktreeAtCommitError,
      { type: 'cancelled' | 'deadline-exceeded' }
    >
  ) {
    super(failure.message);
  }
}

const WORKTREE_GIT_TIMEOUT_MS = 120_000;
const FULL_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

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

  private async isValidWorktree(
    worktreePath: string,
    control: CreateWorktreeOperationControl = {}
  ): Promise<boolean> {
    // A linked worktree contains a .git FILE pointing to the main repo's worktrees
    // directory.
    this.throwIfCreateStopped(control);
    const hasGitFile = await this.existsAbsolute(this.files.path.join(worktreePath, '.git'));
    if (!hasGitFile) return false;

    try {
      const { stdout } = await this.gitForCreate(
        ['-C', worktreePath, 'rev-parse', '--is-inside-work-tree'],
        control
      );
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /** Returns the resolved path to the worktree pool directory. */
  getWorktreePoolPath(): Promise<string> {
    return this.resolveWorktreePoolPath();
  }

  async resolveGeneratedWorktreePath(
    branchName: string
  ): Promise<Result<string, GeneratedWorktreeValidationError>> {
    try {
      await this.ctx.exec('git', ['check-ref-format', '--branch', branchName], {
        timeout: WORKTREE_GIT_TIMEOUT_MS,
      });
      const location = await this.resolveGeneratedLocation(branchName);
      return location.success ? ok(location.data.targetPath) : location;
    } catch {
      return invalidGeneratedWorktree();
    }
  }

  async attestGeneratedWorktree(
    targetPath: string,
    expectedBranchName?: string
  ): Promise<Result<void, GeneratedWorktreeValidationError>> {
    try {
      const poolPath = await this.resolveWorktreePoolPath();
      if (
        !this.files.path.isAbsolute(targetPath) ||
        !this.files.path.contains(poolPath, targetPath) ||
        targetPath === poolPath
      ) {
        return invalidGeneratedWorktree();
      }
      const branchName =
        expectedBranchName ?? this.files.path.relative(poolPath, targetPath).replaceAll('\\', '/');
      const resolved = await this.resolveGeneratedWorktreePath(branchName);
      if (!resolved.success || resolved.data !== targetPath) return invalidGeneratedWorktree();
      return this.attestGeneratedWorktreeAtLocation(targetPath, branchName, poolPath);
    } catch {
      return invalidGeneratedWorktree();
    }
  }

  private async resolveGeneratedLocation(
    branchName: string
  ): Promise<Result<{ poolPath: string; targetPath: string }, GeneratedWorktreeValidationError>> {
    try {
      const poolPath = await this.resolveWorktreePoolPath();
      const targetPath = this.files.path.join(poolPath, branchName);
      if (
        !this.files.path.isAbsolute(poolPath) ||
        !this.files.path.isAbsolute(targetPath) ||
        !this.files.path.contains(poolPath, targetPath) ||
        targetPath === poolPath
      ) {
        return invalidGeneratedWorktree();
      }
      return ok({ poolPath, targetPath });
    } catch {
      return invalidGeneratedWorktree();
    }
  }

  private async attestGeneratedWorktreeAtLocation(
    targetPath: string,
    branchName: string,
    poolPath: string,
    expectedCommit?: string,
    control: CreateWorktreeOperationControl = {}
  ): Promise<Result<void, GeneratedWorktreeValidationError>> {
    try {
      const contained = await isRealPathContained(this.files, poolPath, targetPath, {
        candidateMustExist: true,
      });
      if (
        !contained.success ||
        !contained.data ||
        !(await this.isValidWorktree(targetPath, control))
      ) {
        return invalidGeneratedWorktree();
      }
      const ref = `refs/heads/${branchName}`;
      const symbolic = await this.gitForCreate(
        ['-C', targetPath, 'symbolic-ref', '--quiet', 'HEAD'],
        control
      );
      if (symbolic.stdout.trim() !== ref) return invalidGeneratedWorktree();
      if (expectedCommit) {
        const head = await this.gitForCreate(['-C', targetPath, 'rev-parse', 'HEAD'], control);
        if (head.stdout.trim().toLowerCase() !== expectedCommit.toLowerCase()) {
          return invalidGeneratedWorktree();
        }
      }
      const mainCommonDir = await this.readCanonicalCommonDir(this.repoPath, control);
      const targetCommonDir = await this.readCanonicalCommonDir(targetPath, control);
      if (
        !mainCommonDir ||
        !targetCommonDir ||
        !this.sameCanonicalPath(mainCommonDir, targetCommonDir)
      ) {
        return invalidGeneratedWorktree();
      }
      const canonicalTarget = await this.canonicalWorktreePath(targetPath);
      if (!canonicalTarget) return invalidGeneratedWorktree();
      const records = await this.listRegisteredWorktrees(control);
      for (const record of records) {
        if (
          record.branch !== ref ||
          (expectedCommit && record.head?.toLowerCase() !== expectedCommit.toLowerCase())
        ) {
          continue;
        }
        const canonicalRecordPath = await this.canonicalWorktreePath(record.path);
        if (canonicalRecordPath && this.sameCanonicalPath(canonicalRecordPath, canonicalTarget)) {
          return ok();
        }
      }
      return invalidGeneratedWorktree();
    } catch {
      return invalidGeneratedWorktree();
    }
  }

  private async readCanonicalCommonDir(
    worktreePath: string,
    control: CreateWorktreeOperationControl
  ): Promise<string | undefined> {
    try {
      const result = await this.gitForCreate(
        ['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        control
      );
      const output = result.stdout.trim();
      const absolute = this.files.path.isAbsolute(output)
        ? output
        : this.files.path.join(worktreePath, output);
      const real = await realPathAbsolute(this.files, absolute);
      return real.success ? real.data : undefined;
    } catch {
      return undefined;
    }
  }

  private async listRegisteredWorktrees(
    control?: CreateWorktreeOperationControl
  ): Promise<GitWorktreeRecord[]> {
    const args = ['worktree', 'list', '--porcelain', '-z'];
    const listed = control
      ? await this.gitForCreate(args, control)
      : await this.ctx.exec('git', args);
    const parsed = parseGitWorktreePorcelainZ(listed.stdout);
    if (!parsed.success) throw new Error(parsed.error.message);
    return parsed.data;
  }

  private async canonicalWorktreePath(candidate: string): Promise<string | undefined> {
    if (!this.files.path.isAbsolute(candidate)) return undefined;
    const canonical = await realPathAbsolute(this.files, candidate);
    return canonical.success ? canonical.data : undefined;
  }

  private sameCanonicalPath(left: string, right: string): boolean {
    return this.files.path.relative(left, right) === '';
  }

  private async ensureWorktreePoolDirExists(): Promise<Result<void, ServeWorktreeError>> {
    try {
      const result = await ensureAbsoluteDir(this.files, await this.resolveWorktreePoolPath());
      return result.success
        ? ok()
        : err({ type: 'worktree-setup-failed', cause: fileErrorCause(result.error) });
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
    }
  }

  private async removePathForReuse(targetPath: string): Promise<void> {
    const poolPath = await this.resolveWorktreePoolPath();
    return this.removePathForReuseAtPool(poolPath, targetPath);
  }

  private async removePathForReuseAtPool(poolPath: string, targetPath: string): Promise<void> {
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
      const branchRef = `refs/heads/${branchName}`;
      for (const record of await this.listRegisteredWorktrees()) {
        if (record.branch !== branchRef) continue;
        const candidatePath = await this.canonicalWorktreePath(record.path);
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
      const branchRef = `refs/heads/${branchName}`;
      for (const record of await this.listRegisteredWorktrees()) {
        if (record.branch !== branchRef) continue;
        const candidatePath = await this.canonicalWorktreePath(record.path);
        if (!candidatePath || !this.files.path.contains(realPoolPath.data, candidatePath)) {
          continue;
        }
        if (await this.isValidWorktree(candidatePath)) return candidatePath;
        await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
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
    branchName: string,
    control: CreateWorktreeOperationControl = {}
  ): Promise<Result<string, CreateWorktreeAtCommitError>> {
    if (!FULL_COMMIT_PATTERN.test(commit)) {
      return err({ type: 'invalid-commit', commit });
    }

    const stopped = worktreeOperationFailure(control);
    if (stopped) return err(stopped);
    try {
      return await this.enqueueGitOp(() =>
        this.doCreateWorktreeAtCommit(commit, branchName, control)
      );
    } catch (cause) {
      const operationStopped = stoppedWorktreeFailure(cause, control);
      return operationStopped ? err(operationStopped) : createSetupFailure(cause);
    }
  }

  private async doCreateWorktreeAtCommit(
    commit: string,
    branchName: string,
    control: CreateWorktreeOperationControl
  ): Promise<Result<string, CreateWorktreeAtCommitError>> {
    const stoppedBeforeLocation = worktreeOperationFailure(control);
    if (stoppedBeforeLocation) return err(stoppedBeforeLocation);
    let location;
    try {
      location = await awaitWithWorktreeControl(this.resolveGeneratedLocation(branchName), control);
    } catch (cause) {
      const stopped = stoppedWorktreeFailure(cause, control);
      return stopped ? err(stopped) : createSetupFailure(cause);
    }
    if (!location.success) return createSetupFailure(new Error(location.error.message));
    const { poolPath, targetPath } = location.data;
    if (control.expectedTargetPath && control.expectedTargetPath !== targetPath) {
      return createSetupFailure(new Error('Generated worktree target changed before creation.'));
    }
    this.throwIfCreateStopped(control);
    let poolDir;
    try {
      poolDir = await awaitWithWorktreeControl(ensureAbsoluteDir(this.files, poolPath), control);
    } catch (cause) {
      const stopped = stoppedWorktreeFailure(cause, control);
      return stopped ? err(stopped) : createSetupFailure(cause);
    }
    if (!poolDir.success) return createSetupFailure(fileErrorCause(poolDir.error));

    try {
      await this.gitForCreate(['cat-file', '-e', `${commit}^{commit}`], control);
    } catch (cause) {
      const stopped = stoppedWorktreeFailure(cause, control);
      if (stopped) return err(stopped);
      return err({ type: 'commit-not-found', commit });
    }

    try {
      await this.gitForCreate(['check-ref-format', '--branch', branchName], control);
    } catch (cause) {
      const stopped = stoppedWorktreeFailure(cause, control);
      if (stopped) return err(stopped);
      return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
    }

    try {
      const ref = `refs/heads/${branchName}`;
      const listed = await this.gitForCreate(['for-each-ref', '--format=%(refname)', ref], control);
      if (listed.stdout.trim() === ref) return err({ type: 'branch-exists', branch: branchName });
    } catch (cause) {
      const stopped = stoppedWorktreeFailure(cause, control);
      if (stopped) return err(stopped);
      return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
    }

    this.throwIfCreateStopped(control);
    if (await this.existsAbsolute(targetPath)) {
      try {
        this.throwIfCreateStopped(control);
        const validWorktree = await this.isValidWorktree(targetPath, control);
        this.throwIfCreateStopped(control);
        if (validWorktree) {
          return err({ type: 'branch-exists', branch: branchName });
        }
        await this.removePathForReuseAtPool(poolPath, targetPath);
        this.throwIfCreateStopped(control);
        await this.gitForCreate(['worktree', 'prune'], control).catch(() => {});
      } catch (cause) {
        const stopped = stoppedWorktreeFailure(cause, control);
        if (stopped) return err(stopped);
        return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
      }
    }

    let addReturned = false;
    try {
      this.throwIfCreateStopped(control);
      const safeParent = await isRealPathContained(
        this.files,
        poolPath,
        this.files.path.dirname(targetPath)
      );
      if (!safeParent.success || !safeParent.data) {
        return createSetupFailure(new Error('Generated worktree parent escaped the pool.'));
      }
      this.throwIfCreateStopped(control);
      const parentDir = await awaitWithWorktreeControl(
        ensureAbsoluteDir(this.files, this.files.path.dirname(targetPath)),
        control
      );
      this.throwIfCreateStopped(control);
      if (!parentDir.success) {
        return err({ type: 'worktree-setup-failed', cause: fileErrorCause(parentDir.error) });
      }
      await this.gitForCreate(['worktree', 'prune'], control).catch(() => {});
      this.throwIfCreateStopped(control);
      await this.gitForCreate(['worktree', 'add', '-b', branchName, targetPath, commit], control);
      addReturned = true;
      this.throwIfCreateStopped(control);
      const attested = await this.attestGeneratedWorktreeAtLocation(
        targetPath,
        branchName,
        poolPath,
        commit,
        control
      );
      if (!attested.success) throw new Error(attested.error.message);
      this.throwIfCreateStopped(control);
      return ok(targetPath);
    } catch (cause) {
      if (!addReturned) {
        const ambiguous = await this.hasGeneratedResources(targetPath, branchName);
        if (ambiguous) {
          return err({
            type: 'worktree-rollback-incomplete',
            message: 'Generated worktree ownership was ambiguous after creation failed.',
          });
        }
        const stopped = stoppedWorktreeFailure(cause, control);
        if (stopped) return err(stopped);
        return createSetupFailure(cause);
      }
      const rollback = await this.rollbackGeneratedWorktree(
        targetPath,
        branchName,
        commit,
        poolPath
      );
      if (!rollback.success) {
        return err({
          type: 'worktree-rollback-incomplete',
          message: 'Generated worktree creation failed and rollback was incomplete.',
        });
      }
      const stopped = stoppedWorktreeFailure(cause, control);
      if (stopped) return err(stopped);
      return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
    }
  }

  private async rollbackGeneratedWorktree(
    targetPath: string,
    branchName: string,
    ownedCommit: string,
    poolPath: string
  ): Promise<Result<void, { message: string }>> {
    let failed = false;
    if (!(await this.existsAbsolute(targetPath))) {
      return err({ message: 'Generated worktree rollback ownership could not be proven.' });
    }
    const owned = await this.attestRollbackTarget(targetPath, branchName, ownedCommit, poolPath);
    if (!owned) {
      return err({ message: 'Generated worktree rollback ownership could not be proven.' });
    }
    try {
      await this.removePathForReuseAtPool(poolPath, targetPath);
    } catch {
      return err({ message: 'Generated worktree rollback path could not be removed.' });
    }
    await this.ctx.exec('git', ['worktree', 'prune']).catch(() => {
      failed = true;
    });
    try {
      const ref = `refs/heads/${branchName}`;
      const listed = await this.ctx.exec('git', ['for-each-ref', '--format=%(objectname)', ref]);
      const currentHead = listed.stdout.trim();
      if (currentHead) {
        if (currentHead.toLowerCase() !== ownedCommit.toLowerCase()) {
          failed = true;
        } else {
          await this.ctx.exec('git', ['update-ref', '-d', ref, ownedCommit]);
        }
      }
    } catch {
      failed = true;
    }
    return failed ? err({ message: 'Generated worktree rollback was incomplete.' }) : ok();
  }

  private async hasGeneratedResources(targetPath: string, branchName: string): Promise<boolean> {
    try {
      if (await this.existsAbsolute(targetPath)) return true;
      const ref = `refs/heads/${branchName}`;
      const listed = await this.ctx.exec('git', ['for-each-ref', '--format=%(objectname)', ref]);
      return Boolean(listed.stdout.trim());
    } catch {
      return true;
    }
  }

  private async attestRollbackTarget(
    targetPath: string,
    branchName: string,
    ownedCommit: string,
    poolPath: string
  ): Promise<boolean> {
    const attested = await this.attestGeneratedWorktreeAtLocation(
      targetPath,
      branchName,
      poolPath,
      ownedCommit
    );
    if (!attested.success) return false;
    try {
      const status = await this.ctx.exec(
        'git',
        ['-C', targetPath, 'status', '--porcelain', '--untracked-files=all', '--ignored=matching'],
        { timeout: WORKTREE_GIT_TIMEOUT_MS }
      );
      return status.stdout.trim() === '';
    } catch {
      return false;
    }
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
    worktreePath: string,
    options: { expectedBranchName: string; expectedHead: string | null }
  ): Promise<Result<{ removed: boolean }, RemoveGeneratedWorktreeError>> {
    try {
      const location = await this.resolveGeneratedLocation(options.expectedBranchName);
      if (
        !location.success ||
        location.data.targetPath !== worktreePath ||
        !this.files.path.isAbsolute(worktreePath)
      ) {
        return err({
          type: 'worktree-remove-failed',
          message: 'Generated worktree path could not be validated.',
        });
      }
      await this.ctx.exec('git', ['check-ref-format', '--branch', options.expectedBranchName], {
        timeout: WORKTREE_GIT_TIMEOUT_MS,
      });
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
        if (!options.expectedHead || !FULL_COMMIT_PATTERN.test(options.expectedHead)) {
          return err({
            type: 'worktree-remove-failed',
            message: 'Generated worktree ownership could not be attested.',
          });
        }
        const attested = await this.attestGeneratedWorktreeAtLocation(
          worktreePath,
          options.expectedBranchName,
          location.data.poolPath,
          options.expectedHead
        );
        if (!attested.success) {
          return err({
            type: 'worktree-remove-failed',
            message: 'Generated worktree ownership could not be attested.',
          });
        }
        await this.removePathForReuseAtPool(location.data.poolPath, worktreePath);
      }
      await this.ctx.exec('git', ['worktree', 'prune'], { timeout: WORKTREE_GIT_TIMEOUT_MS });
      return ok({ removed: exists.data });
    } catch {
      return err({
        type: 'worktree-remove-failed',
        message: 'Generated worktree could not be removed safely.',
      });
    }
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
    options: { strict?: boolean; generatedBranchName?: string } = {}
  ): Promise<Result<{ copied: string[] }, CopyPreservedFilesError>> {
    const strict = options.strict ?? true;
    if (strict) {
      const attested = await this.attestGeneratedWorktree(targetPath, options.generatedBranchName);
      if (!attested.success) return err(attested.error);
    }
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

  private throwIfCreateStopped(control: CreateWorktreeOperationControl): void {
    const stopped = worktreeOperationFailure(control);
    if (stopped) throw new WorktreeOperationStopped(stopped);
  }

  private gitForCreate(args: string[], control: CreateWorktreeOperationControl) {
    this.throwIfCreateStopped(control);
    const timeout =
      control.deadlineAt === undefined
        ? WORKTREE_GIT_TIMEOUT_MS
        : Math.max(1, Math.min(WORKTREE_GIT_TIMEOUT_MS, control.deadlineAt - Date.now()));
    return awaitWithWorktreeControl(
      this.ctx.exec('git', args, { timeout, signal: control.signal }),
      control
    );
  }
}

type GitWorktreeRecord = {
  path: string;
  head?: string;
  branch?: string;
};

function parseGitWorktreePorcelainZ(
  output: string
): Result<GitWorktreeRecord[], { message: string }> {
  const records: GitWorktreeRecord[] = [];
  let current: GitWorktreeRecord | undefined;

  for (const field of output.split('\0')) {
    if (field === '') {
      if (current) {
        records.push(current);
        current = undefined;
      }
      continue;
    }
    if (field.startsWith('worktree ')) {
      const worktreePath = field.slice('worktree '.length);
      if (current || !worktreePath) return invalidWorktreeList();
      current = { path: worktreePath };
      continue;
    }
    if (!current) return invalidWorktreeList();
    if (field.startsWith('HEAD ')) {
      const head = field.slice('HEAD '.length);
      if (current.head || !FULL_COMMIT_PATTERN.test(head)) return invalidWorktreeList();
      current.head = head;
      continue;
    }
    if (field.startsWith('branch ')) {
      const branch = field.slice('branch '.length);
      if (current.branch || !branch.startsWith('refs/heads/')) return invalidWorktreeList();
      current.branch = branch;
      continue;
    }
    if (
      field === 'bare' ||
      field === 'detached' ||
      field === 'locked' ||
      field.startsWith('locked ') ||
      field === 'prunable' ||
      field.startsWith('prunable ')
    ) {
      continue;
    }
    return invalidWorktreeList();
  }
  if (current) return invalidWorktreeList();
  return ok(records);
}

function invalidWorktreeList(): Result<never, { message: string }> {
  return err({ message: 'Git worktree registration data could not be parsed safely.' });
}

function invalidGeneratedWorktree(): Result<never, GeneratedWorktreeValidationError> {
  return err({
    type: 'invalid-generated-worktree',
    message: 'Generated worktree identity could not be validated.',
  });
}

function createSetupFailure(cause: unknown): Result<never, CreateWorktreeAtCommitError> {
  return err({ type: 'worktree-setup-failed', cause: toSerializedError(cause) });
}

function worktreeOperationFailure(
  control: CreateWorktreeOperationControl
): Extract<CreateWorktreeAtCommitError, { type: 'cancelled' | 'deadline-exceeded' }> | undefined {
  if (control.signal?.aborted) {
    return { type: 'cancelled', message: 'Generated worktree creation was cancelled.' };
  }
  if (control.deadlineAt !== undefined && control.deadlineAt <= Date.now()) {
    return {
      type: 'deadline-exceeded',
      message: 'Generated worktree creation deadline was exceeded.',
    };
  }
  return undefined;
}

function stoppedWorktreeFailure(
  cause: unknown,
  control: CreateWorktreeOperationControl
): Extract<CreateWorktreeAtCommitError, { type: 'cancelled' | 'deadline-exceeded' }> | undefined {
  if (cause instanceof WorktreeOperationStopped) return cause.failure;
  return worktreeOperationFailure(control);
}

function awaitWithWorktreeControl<T>(
  operation: Promise<T>,
  control: CreateWorktreeOperationControl
): Promise<T> {
  const stopped = worktreeOperationFailure(control);
  if (stopped) return Promise.reject(new WorktreeOperationStopped(stopped));
  if (!control.signal && control.deadlineAt === undefined) return operation;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      control.signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      const failure = worktreeOperationFailure(control) ?? {
        type: 'cancelled' as const,
        message: 'Generated worktree creation was cancelled.',
      };
      finish(() => reject(new WorktreeOperationStopped(failure)));
    };
    const remaining =
      control.deadlineAt === undefined ? undefined : Math.max(0, control.deadlineAt - Date.now());
    const timer =
      remaining === undefined
        ? undefined
        : setTimeout(() => {
            finish(() =>
              reject(
                new WorktreeOperationStopped({
                  type: 'deadline-exceeded',
                  message: 'Generated worktree creation deadline was exceeded.',
                })
              )
            );
          }, remaining);
    control.signal?.addEventListener('abort', onAbort, { once: true });
    if (control.signal?.aborted) onAbort();
    operation.then(
      (value) => finish(() => resolve(value)),
      (cause) => finish(() => reject(cause))
    );
  });
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
