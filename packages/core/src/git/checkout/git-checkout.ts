import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { BoundExec } from '../../exec';
import type {
  CommitOptions,
  GitLogOptions,
  MergeOptions,
  PushOptions,
  RebaseOptions,
  ResetMode,
  StashPushOptions,
  SwitchOptions,
} from '../api/commands';
import type {
  CommitError,
  GitCommandError,
  MergeError,
  PullError,
  PushError,
  RebaseError,
  SwitchError,
  SyncError,
} from '../api/errors';
import type { GitSyncProgress } from '../api/jobs';
import {
  type BlameResult,
  type Commit,
  type CommitFile,
  type ConflictVersions,
  type DiffTarget,
  type FileDiff,
  type GitChange,
  type GitLogResult,
  type ImageReadResult,
} from '../api/queries';
import {
  classifyCommitError,
  classifyMergeError,
  classifyPullError,
  classifyPushError,
  classifyRebaseError,
  classifySwitchError,
  gitErrorMessage,
  isUnbornHeadError,
  toGitCommandError,
} from '../errors';
import {
  execGitWithProgress,
  syncStepProgress,
  throwIfGitOpAborted,
  type GitOpContext,
} from '../transfer-progress';
import type { GitHeadModel } from './models/head';
import type { CheckoutStatusModel } from './models/status';
import { blame as readBlame } from './ops/blame';
import {
  extractHunkPatch,
  getChangedFiles as readChangedFiles,
  getUntrackedFileDiff,
  parseUnifiedFileDiff,
  resolveDiffTarget,
} from './ops/diff';
import { computeHeadModel } from './ops/head';
import { getImageBlob } from './ops/images';
import {
  getCommit as readCommit,
  getCommitFiles as readCommitFiles,
  getLog as readLog,
} from './ops/log';
import { computeStatusModel } from './ops/status';
import type { CheckoutRepository, GitCheckoutOptions, IGitCheckout } from './types';

/**
 * A single working tree capability. It knows Git commands and fresh reads;
 * live-state ownership lives in the checkout live-model runtime.
 */
export class GitCheckout implements IGitCheckout {
  readonly checkoutPath: string;
  readonly gitDir: string;

  private readonly repository: CheckoutRepository;
  private readonly exec: BoundExec;

  static async create(options: GitCheckoutOptions): Promise<GitCheckout> {
    return new GitCheckout(options);
  }

  private constructor(options: GitCheckoutOptions) {
    this.checkoutPath = options.checkoutPath;
    this.gitDir = options.gitDir;
    this.repository = options.repository;
    this.exec = options.exec;
  }

  getStatus(): Promise<CheckoutStatusModel> {
    return computeStatusModel(this.exec, this.gitDir, this.checkoutPath);
  }

  async getHead(): Promise<GitHeadModel> {
    return computeHeadModel(this.exec).catch(
      (): GitHeadModel => ({ kind: 'unborn', name: 'unknown' })
    );
  }

  async dispose(): Promise<void> {}

  // -- Staging ----------------------------------------------------------------

  async stage(paths: string[]): Promise<Result<void, GitCommandError>> {
    if (paths.length === 0) return ok(undefined);
    return this.commandMutation(() =>
      this.exec.exec(['add', '--', ...this.toRelativePaths(paths)])
    );
  }

  async unstage(paths: string[]): Promise<Result<void, GitCommandError>> {
    if (paths.length === 0) return ok(undefined);
    return this.commandMutation(() =>
      this.exec.exec(['reset', 'HEAD', '--', ...this.toRelativePaths(paths)])
    );
  }

  async stageAll(): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['add', '-A']));
  }

  async unstageAll(): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(async () => {
      try {
        await this.exec.exec(['reset', 'HEAD']);
      } catch (error) {
        if (!isUnbornHeadError(error)) throw error;
        await this.exec.exec(['rm', '-r', '--cached', '--', '.']).catch((rmError) => {
          if (!gitErrorMessage(rmError).includes('did not match any files')) throw rmError;
        });
      }
    });
  }

  async revert(paths: string[]): Promise<Result<void, GitCommandError>> {
    if (paths.length === 0) return ok(undefined);
    const relativePaths = this.toRelativePaths(paths);
    return this.commandMutation(async () => {
      const indexedPaths = await this.getIndexedPaths(relativePaths);
      const headPaths = await this.getHeadPaths(relativePaths);
      const indexedPathSet = new Set(indexedPaths);
      const headOnlyPaths = headPaths.filter((filePath) => !indexedPathSet.has(filePath));
      if (indexedPaths.length > 0) {
        await this.exec.exec(['checkout', '--', ...indexedPaths]);
      }
      if (headOnlyPaths.length > 0) {
        await this.exec.exec(['checkout', 'HEAD', '--', ...headOnlyPaths]);
      }
      const trackedPathSet = new Set([...indexedPaths, ...headPaths]);
      const untrackedPaths = relativePaths.filter((filePath) => !trackedPathSet.has(filePath));
      if (untrackedPaths.length > 0) {
        await this.exec.exec(['clean', '-fd', '--', ...untrackedPaths]);
      }
    });
  }

  async revertAll(): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(async () => {
      try {
        await this.exec.exec(['reset', '--hard', 'HEAD']);
      } catch (error) {
        if (!isUnbornHeadError(error)) throw error;
      }
      await this.exec.exec(['clean', '-fd']);
    });
  }

  async clean(
    options: { paths?: string[]; force?: boolean } = {}
  ): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() =>
      this.exec.exec([
        'clean',
        '-d',
        options.force ? '-ff' : '-f',
        ...(options.paths && options.paths.length > 0
          ? ['--', ...this.toRelativePaths(options.paths)]
          : []),
      ])
    );
  }

  async stageHunk(filePath: string, hunkHeader: string): Promise<Result<void, GitCommandError>> {
    return this.applyHunk(filePath, hunkHeader, { source: 'worktree', cached: true });
  }

  async unstageHunk(filePath: string, hunkHeader: string): Promise<Result<void, GitCommandError>> {
    return this.applyHunk(filePath, hunkHeader, { source: 'index', cached: true, reverse: true });
  }

  async discardHunk(filePath: string, hunkHeader: string): Promise<Result<void, GitCommandError>> {
    return this.applyHunk(filePath, hunkHeader, { source: 'worktree', reverse: true });
  }

  // -- Commit / history-changing operations -----------------------------------

  async commit(
    message: string,
    options: CommitOptions = {}
  ): Promise<Result<{ hash: string }, CommitError>> {
    try {
      await this.exec.exec([
        'commit',
        '-m',
        message,
        ...(options.amend ? ['--amend'] : []),
        ...(options.signoff ? ['--signoff'] : []),
        ...(options.noVerify ? ['--no-verify'] : []),
        ...(options.allowEmpty ? ['--allow-empty'] : []),
      ]);
      const { stdout } = await this.exec.exec(['rev-parse', 'HEAD']);
      return ok({ hash: stdout.trim() });
    } catch (error) {
      return err(classifyCommitError(error));
    }
  }

  async switch(options: SwitchOptions): Promise<Result<void, SwitchError>> {
    try {
      await this.exec.exec([
        'switch',
        ...(options.force ? ['--force'] : []),
        ...(options.newBranch ? ['-c', options.newBranch] : []),
        options.ref,
      ]);
      return ok(undefined);
    } catch (error) {
      return err(classifySwitchError(error, options.ref));
    }
  }

  async reset(ref: string, mode: ResetMode = 'mixed'): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['reset', `--${mode}`, ref]));
  }

  async merge(options: MergeOptions): Promise<Result<void, MergeError>> {
    try {
      await this.exec.exec([
        'merge',
        ...(options.noFf ? ['--no-ff'] : []),
        ...(options.squash ? ['--squash'] : []),
        ...(options.message ? ['-m', options.message] : []),
        options.branch,
      ]);
      return ok(undefined);
    } catch (error) {
      return err(classifyMergeError(error, await this.getConflictedPaths()));
    }
  }

  async mergeContinue(message?: string): Promise<Result<void, MergeError>> {
    try {
      if (message !== undefined) {
        await this.exec.exec(['commit', '-m', message]);
      } else {
        await this.exec.exec(['merge', '--continue'], { env: { GIT_EDITOR: 'true' } });
      }
      return ok(undefined);
    } catch (error) {
      return err(classifyMergeError(error, await this.getConflictedPaths()));
    }
  }

  async mergeAbort(): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['merge', '--abort']));
  }

  async rebase(options: RebaseOptions): Promise<Result<void, RebaseError>> {
    try {
      await this.exec.exec(['rebase', options.onto], { env: { GIT_EDITOR: 'true' } });
      return ok(undefined);
    } catch (error) {
      return err(classifyRebaseError(error, await this.getConflictedPaths()));
    }
  }

  async rebaseContinue(): Promise<Result<void, RebaseError>> {
    try {
      await this.exec.exec(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } });
      return ok(undefined);
    } catch (error) {
      return err(classifyRebaseError(error, await this.getConflictedPaths()));
    }
  }

  async rebaseAbort(): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['rebase', '--abort']));
  }

  async rebaseSkip(): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() =>
      this.exec.exec(['rebase', '--skip'], { env: { GIT_EDITOR: 'true' } })
    );
  }

  async cherryPick(commits: string[], noCommit = false): Promise<Result<void, MergeError>> {
    if (commits.length === 0) return ok(undefined);
    try {
      await this.exec.exec(['cherry-pick', ...(noCommit ? ['-n'] : []), ...commits]);
      return ok(undefined);
    } catch (error) {
      return err(classifyMergeError(error, await this.getConflictedPaths()));
    }
  }

  async revertCommit(commit: string, noCommit = false): Promise<Result<void, MergeError>> {
    try {
      await this.exec.exec(['revert', '--no-edit', ...(noCommit ? ['-n'] : []), commit]);
      return ok(undefined);
    } catch (error) {
      return err(classifyMergeError(error, await this.getConflictedPaths()));
    }
  }

  // -- Sync --------------------------------------------------------------------

  async push(
    options: PushOptions = {},
    context: GitOpContext = {}
  ): Promise<Result<{ output: string }, PushError>> {
    try {
      const { stdout, stderr } = await execGitWithProgress(
        this.exec,
        [
          'push',
          '--progress',
          ...(options.force ? ['--force-with-lease'] : []),
          ...(options.setUpstream
            ? ['--set-upstream', options.remote ?? 'origin', 'HEAD']
            : options.remote
              ? [options.remote]
              : []),
        ],
        context
      );
      return ok({ output: (stdout || stderr).trim() });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return err(classifyPushError(error));
    }
  }

  async pull(context: GitOpContext = {}): Promise<Result<{ output: string }, PullError>> {
    try {
      const { stdout, stderr } = await execGitWithProgress(
        this.exec,
        ['pull', '--progress'],
        context
      );
      return ok({ output: (stdout || stderr).trim() });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return err(classifyPullError(error, await this.getConflictedPaths()));
    }
  }

  async sync(
    context: GitOpContext<GitSyncProgress> = {}
  ): Promise<Result<{ output: string }, SyncError>> {
    throwIfGitOpAborted(context.signal);
    const pullResult = await this.pull({
      signal: context.signal,
      onProgress: syncStepProgress('pull', context.onProgress),
    });
    if (!pullResult.success) return pullResult;
    throwIfGitOpAborted(context.signal);
    const pushResult = await this.push(undefined, {
      signal: context.signal,
      onProgress: syncStepProgress('push', context.onProgress),
    });
    if (!pushResult.success) return pushResult;
    const output = [pullResult.data.output, pushResult.data.output].filter(Boolean).join('\n');
    return ok({ output });
  }

  // -- Stash --------------------------------------------------------------------

  async stashPush(options: StashPushOptions = {}): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() =>
      this.exec.exec([
        'stash',
        'push',
        ...(options.includeUntracked ? ['-u'] : []),
        ...(options.keepIndex ? ['--keep-index'] : []),
        ...(options.message ? ['-m', options.message] : []),
        ...(options.paths && options.paths.length > 0
          ? ['--', ...this.toRelativePaths(options.paths)]
          : []),
      ])
    );
  }

  async stashApply(stashIndex?: number): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() =>
      this.exec.exec([
        'stash',
        'apply',
        ...(stashIndex !== undefined ? [`stash@{${stashIndex}}`] : []),
      ])
    );
  }

  async stashPop(stashIndex?: number): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() =>
      this.exec.exec([
        'stash',
        'pop',
        ...(stashIndex !== undefined ? [`stash@{${stashIndex}}`] : []),
      ])
    );
  }

  // -- Diff / conflict reads -----------------------------------------------------

  async getFileDiff(
    filePath: string,
    base: DiffTarget = { kind: 'head' }
  ): Promise<Result<FileDiff, GitCommandError>> {
    const relativePath = this.toRelativePath(filePath);
    const absolutePath = this.toAbsolutePath(filePath);
    const resolved = resolveDiffTarget(base);
    try {
      const args = resolved.cached
        ? ['diff', '--no-color', '--cached', '--', relativePath]
        : ['diff', '--no-color', resolved.ref, '--', relativePath];
      const { stdout } = await this.exec.exec(args);
      if (stdout.trim().length > 0 || resolved.cached) {
        return ok(parseUnifiedFileDiff(stdout, absolutePath));
      }
      const untrackedDiff = await getUntrackedFileDiff(this.exec, relativePath, absolutePath);
      return ok(untrackedDiff ?? parseUnifiedFileDiff(stdout, absolutePath));
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async getChangedFiles(base: DiffTarget): Promise<GitChange[]> {
    return readChangedFiles(this.exec, base, (filePath) => this.toAbsolutePath(filePath));
  }

  async getConflictVersions(filePath: string): Promise<Result<ConflictVersions, GitCommandError>> {
    const relativePath = this.toRelativePath(filePath);
    const readStage = async (stage: 1 | 2 | 3): Promise<string | undefined> => {
      try {
        const { stdout } = await this.exec.exec(['show', `:${stage}:${relativePath}`]);
        return stdout;
      } catch {
        return undefined;
      }
    };
    const [base, ours, theirs, working] = await Promise.all([
      readStage(1),
      readStage(2),
      readStage(3),
      fs.readFile(this.toAbsolutePath(relativePath), 'utf8').catch(() => undefined),
    ]);
    return ok({ base, ours, theirs, working });
  }

  // -- Content / history reads ----------------------------------------------------

  async getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    return this.repository.readBlobAtRef(ref, this.toRelativePath(filePath));
  }

  async getFileAtIndex(filePath: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec.exec(['show', `:${this.toRelativePath(filePath)}`]);
      return stdout;
    } catch {
      return null;
    }
  }

  async getImageAtRef(filePath: string, ref: string): Promise<ImageReadResult> {
    const relativePath = this.toRelativePath(filePath);
    return getImageBlob(this.exec, relativePath, `${ref}:${relativePath}`);
  }

  async getImageAtIndex(filePath: string): Promise<ImageReadResult> {
    const relativePath = this.toRelativePath(filePath);
    return getImageBlob(this.exec, relativePath, `:${relativePath}`);
  }

  async getLog(options: GitLogOptions = {}): Promise<GitLogResult> {
    return readLog(this.exec, options);
  }

  async getCommit(hash: string): Promise<Commit | null> {
    return readCommit(this.exec, hash);
  }

  async getCommitFiles(hash: string): Promise<CommitFile[]> {
    return readCommitFiles(this.exec, hash, (filePath) => this.toAbsolutePath(filePath));
  }

  async blame(filePath: string, ref?: string): Promise<Result<BlameResult, GitCommandError>> {
    return readBlame(this.exec, this.toRelativePath(filePath), ref);
  }

  // -- Internals --------------------------------------------------------------------

  private async commandMutation(
    run: () => Promise<unknown>
  ): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  private async applyHunk(
    filePath: string,
    hunkHeader: string,
    options: { source: 'worktree' | 'index'; cached?: boolean; reverse?: boolean }
  ): Promise<Result<void, GitCommandError>> {
    const relativePath = this.toRelativePath(filePath);
    try {
      const diffArgs =
        options.source === 'index'
          ? ['diff', '--no-color', '--cached', '--', relativePath]
          : ['diff', '--no-color', '--', relativePath];
      const { stdout } = await this.exec.exec(diffArgs);
      const patch = extractHunkPatch(stdout, hunkHeader);
      if (!patch) {
        return err({ type: 'git_error', message: `Hunk not found for ${relativePath}` });
      }

      const patchFile = path.join(
        os.tmpdir(),
        `emdash-hunk-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`
      );
      await fs.writeFile(patchFile, patch, 'utf8');
      try {
        await this.exec.exec([
          'apply',
          ...(options.cached ? ['--cached'] : []),
          ...(options.reverse ? ['-R'] : []),
          patchFile,
        ]);
      } finally {
        await fs.rm(patchFile, { force: true });
      }
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  private async getConflictedPaths(): Promise<string[] | undefined> {
    try {
      const { stdout } = await this.exec.exec(['diff', '--name-only', '--diff-filter=U']);
      const paths = stdout.trim().split('\n').filter(Boolean);
      return paths.length > 0 ? paths : undefined;
    } catch {
      return undefined;
    }
  }

  private async getIndexedPaths(paths: string[]): Promise<string[]> {
    const { stdout } = await this.exec.exec(['ls-files', '-z', '--', ...paths]);
    return [...new Set(stdout.split('\0').filter(Boolean))];
  }

  private async getHeadPaths(paths: string[]): Promise<string[]> {
    try {
      const { stdout } = await this.exec.exec([
        'ls-tree',
        '-z',
        '--name-only',
        'HEAD',
        '--',
        ...paths,
      ]);
      return [...new Set(stdout.split('\0').filter(Boolean))];
    } catch {
      return [];
    }
  }

  private toAbsolutePath(filePath: string): string {
    if (path.isAbsolute(filePath) || path.win32.isAbsolute(filePath))
      return path.normalize(filePath);
    return path.join(this.checkoutPath, filePath);
  }

  private toRelativePath(filePath: string): string {
    if (!path.isAbsolute(filePath) && !path.win32.isAbsolute(filePath)) return filePath;
    return path.relative(this.checkoutPath, filePath).replace(/\\/g, '/');
  }

  private toRelativePaths(paths: string[]): string[] {
    return paths.map((filePath) => this.toRelativePath(filePath));
  }
}
