import path from 'node:path';
import { ok, type Result } from '@emdash/shared';
import { parsePortableRelativePath, type PortableRelativePath } from '#primitives/path/api';
import {
  type BlameResult,
  type CheckoutHeadState,
  type CheckoutStatusState,
  type Commit,
  type CommitError,
  type CommitFile,
  type CommitOptions,
  type DiffTarget,
  type GitChange,
  type GitCommandError,
  type BoundGitFileContentKey,
  type GitFileContentState,
  type GitLogOptions,
  type GitLogResult,
  type ImageReadResult,
  type PullError,
  type PushError,
  type PushOptions,
} from '#runtimes/git/api';
import type { CheckoutIdentity } from '#runtimes/git/node/allocation/identity';
import { blame as readBlame } from '#runtimes/git/node/checkout/ops/blame';
import { readGitFileContent } from '#runtimes/git/node/checkout/ops/content';
import { getChangedFiles as readChangedFiles } from '#runtimes/git/node/checkout/ops/diff';
import { computeHeadState } from '#runtimes/git/node/checkout/ops/head';
import { getImageBlob } from '#runtimes/git/node/checkout/ops/images';
import {
  getCommit as readCommit,
  getCommitFiles as readCommitFiles,
  getLog as readLog,
} from '#runtimes/git/node/checkout/ops/log';
import { computeStatusState } from '#runtimes/git/node/checkout/ops/status';
import { pushFailed } from '#runtimes/git/node/exec/errors';
import type { GitOperationContext } from '#runtimes/git/node/exec/operation-context';
import { execGitWithProgress } from '#runtimes/git/node/exec/transfer-progress';
import type { BoundExec } from '#services/exec/api';
import { checkoutFailures, InvalidCheckoutPathError } from './errors';

type GitCheckoutOptions = {
  identity: CheckoutIdentity;
  exec: BoundExec;
};

export class GitCheckout {
  readonly identity: CheckoutIdentity;
  private readonly exec: BoundExec;

  constructor(options: GitCheckoutOptions) {
    this.identity = options.identity;
    this.exec = options.exec;
  }

  get checkoutRoot(): string {
    return this.identity.checkoutRoot;
  }

  get gitDir(): string {
    return this.identity.gitDir;
  }

  getStatus(): Promise<CheckoutStatusState> {
    return computeStatusState(this.exec, this.gitDir);
  }

  getHead(): Promise<CheckoutHeadState> {
    return computeHeadState(this.exec);
  }

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
        if (!checkoutFailures.isUnbornHead(error)) throw error;
        await this.exec.exec(['rm', '-r', '--cached', '--', '.']).catch((rmError) => {
          if (!checkoutFailures.isPathNotMatched(rmError)) throw rmError;
        });
      }
    });
  }

  async revert(paths: string[]): Promise<Result<void, GitCommandError>> {
    if (paths.length === 0) return ok(undefined);
    return this.commandMutation(async () => {
      const relativePaths = this.toRelativePaths(paths);
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
        if (!checkoutFailures.isUnbornHead(error)) throw error;
      }
      await this.exec.exec(['clean', '-fd']);
    });
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
      return checkoutFailures.commit(error);
    }
  }

  // -- Sync --------------------------------------------------------------------

  async push(
    options: PushOptions = {},
    context: GitOperationContext = {}
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
      return pushFailed(error);
    }
  }

  async pull(context: GitOperationContext = {}): Promise<Result<{ output: string }, PullError>> {
    try {
      const { stdout, stderr } = await execGitWithProgress(
        this.exec,
        ['pull', '--progress'],
        context
      );
      return ok({ output: (stdout || stderr).trim() });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return checkoutFailures.pull(error, await this.getConflictedPaths());
    }
  }

  // -- Diff reads -----------------------------------------------------------------

  async getChangedFiles(base: DiffTarget): Promise<GitChange[]> {
    return readChangedFiles(this.exec, base, (filePath) => this.toRelativePath(filePath));
  }

  // -- Content / history reads ----------------------------------------------------

  async getFileAtIndex(filePath: string): Promise<string | null> {
    const relativePath = this.toRelativePath(filePath);
    try {
      const { stdout } = await this.exec.exec(['show', `:${relativePath}`]);
      return stdout;
    } catch (error) {
      if (!checkoutFailures.isMissingIndexEntry(error)) throw error;
      return null;
    }
  }

  getFileContent(key: BoundGitFileContentKey): Promise<GitFileContentState> {
    return readGitFileContent(this.exec, this.toRelativePath(key.path), key.source);
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
    return readCommitFiles(this.exec, hash, (filePath) => this.toRelativePath(filePath));
  }

  async blame(filePath: string, ref?: string): Promise<Result<BlameResult, GitCommandError>> {
    try {
      return await readBlame(this.exec, this.toRelativePath(filePath), ref);
    } catch (error) {
      return checkoutFailures.command(error);
    }
  }

  // -- Internals --------------------------------------------------------------------

  private async commandMutation(
    run: () => Promise<unknown>
  ): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      return ok(undefined);
    } catch (error) {
      return checkoutFailures.command(error);
    }
  }

  private async getConflictedPaths(): Promise<PortableRelativePath[] | undefined> {
    const { stdout } = await this.exec.exec(['diff', '--name-only', '--diff-filter=U']);
    const paths = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((filePath) => this.toRelativePath(filePath));
    return paths.length > 0 ? paths : undefined;
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
    } catch (error) {
      if (!checkoutFailures.isUnbornHead(error)) throw error;
      return [];
    }
  }

  private toRelativePath(filePath: string): PortableRelativePath {
    const parsed = parsePortableRelativePath(filePath, { unicodeNormalization: 'preserve' });
    if (!parsed.success || !parsed.data || (path.sep === '\\' && parsed.data.includes('\\'))) {
      throw new InvalidCheckoutPathError(filePath);
    }
    return parsed.data;
  }

  private toRelativePaths(paths: string[]): PortableRelativePath[] {
    return paths.map((filePath) => this.toRelativePath(filePath));
  }
}
