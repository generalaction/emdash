import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { blobSourceFromBytes, type BlobSource } from '@emdash/wire/rpc';
import { claimOwnUpstream } from '#primitives/git/api';
import { parsePortableRelativePath, type PortableRelativePath } from '#primitives/path/api';
import {
  gitErr,
  localBranchRefSchema,
  type BlameResult,
  type CheckoutHeadState,
  type CheckoutStatusState,
  type Commit,
  type CommitError,
  type CommitFile,
  type CommitOptions,
  type DiffTarget,
  type DownloadError,
  type DownloadMeta,
  type GitChange,
  type GitCommandError,
  type BoundGitFileContentKey,
  type GitFileContentState,
  type GitLogOptions,
  type GitLogResult,
  type PullError,
  type PushError,
  type PushOptions,
} from '#runtimes/git/api';
import type { CheckoutIdentity } from '#runtimes/git/node/allocation/identity';
import { blame as readBlame } from '#runtimes/git/node/checkout/ops/blame';
import { readGitFileContent } from '#runtimes/git/node/checkout/ops/content';
import { getChangedFiles as readChangedFiles } from '#runtimes/git/node/checkout/ops/diff';
import { readGitBlobDownload } from '#runtimes/git/node/checkout/ops/download';
import { computeHeadState } from '#runtimes/git/node/checkout/ops/head';
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

const MAX_IGNORE_CHECK_PATHS = 200;

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

  /** True only when git reports every path as ignored; tracked paths never are. Any failure,
   * including exit 1 (none ignored), answers false so callers fall back to a refresh. */
  async allIgnored(paths: readonly string[]): Promise<boolean> {
    const unique = [...new Set(paths)];
    if (unique.length === 0 || unique.length > MAX_IGNORE_CHECK_PATHS) return false;
    try {
      const { stdout } = await this.exec.exec(['check-ignore', '--', ...unique]);
      return stdout.split('\n').filter(Boolean).length === unique.length;
    } catch {
      return false;
    }
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

  /** `git reset --soft HEAD~1`: changes stay staged; returns the undone message for re-editing. */
  async undoLastCommit(): Promise<Result<{ message: string }, GitCommandError>> {
    try {
      const { stdout } = await this.exec.exec(['log', '-1', '--format=%B', 'HEAD']);
      await this.exec.exec(['reset', '--soft', 'HEAD~1']);
      return ok({ message: stdout.trim() });
    } catch (error) {
      return checkoutFailures.command(error);
    }
  }

  async continueOperation(operation: string): Promise<Result<void, GitCommandError>> {
    // core.editor=true: accept the prepared message instead of opening an editor.
    return this.commandMutation(() =>
      this.exec.exec(['-c', 'core.editor=true', operation, '--continue'])
    );
  }

  async switchBranch(branch: string): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(async () => {
      await this.exec.exec(['switch', branch]);
      await claimOwnUpstream(this.exec, branch).catch(() => undefined);
    });
  }

  async abortOperation(operation: string): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec([operation, '--abort']));
  }

  // -- Sync --------------------------------------------------------------------

  async push(
    options: PushOptions = {},
    context: GitOperationContext = {}
  ): Promise<Result<{ output: string }, PushError>> {
    try {
      const args = ['push', '--progress'];
      if (options.force) args.push('--force-with-lease');
      const renamed = await this.renamedUpstreamPush(options.remote);
      if (renamed) args.push(...renamed);
      else if (options.remote) args.push(options.remote);
      const { stdout, stderr } = await execGitWithProgress(this.exec, args, context);
      return ok({ output: (stdout || stderr).trim() });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return pushFailed(error);
    }
  }

  /** `push.default=simple` refuses a branch tracking a differently named one: a PR task branch
   * pushes to its PR head, any other branch (cut from origin/dev) to its own name. */
  private async renamedUpstreamPush(remote?: string): Promise<string[] | null> {
    const read = (args: string[]) =>
      this.exec.exec(args).then(
        (result) => result.stdout.trim(),
        () => ''
      );
    const branch = await read(['symbolic-ref', '--short', '-q', 'HEAD']);
    if (!branch) return null;
    const upstreamRemote = await read(['config', '--get', `branch.${branch}.remote`]);
    const merge = await read(['config', '--get', `branch.${branch}.merge`]);
    if (!upstreamRemote || upstreamRemote === '.' || merge === `refs/heads/${branch}`) return null;
    if (await read(['config', '--get', `branch.${branch}.emdash-pr-url`]))
      return [upstreamRemote, `HEAD:${merge}`];
    const ref = `refs/heads/${branch}`;
    return ['--set-upstream', remote ?? upstreamRemote, `${ref}:${ref}`];
  }

  async publish(
    remote: string,
    context: GitOperationContext = {}
  ): Promise<Result<{ output: string }, PushError>> {
    try {
      const { stdout } = await this.exec.exec(['symbolic-ref', 'HEAD']);
      const branchRef = localBranchRefSchema.parse(stdout.trim());
      const { stdout: pushStdout, stderr } = await execGitWithProgress(
        this.exec,
        ['push', '--progress', '--set-upstream', remote, `${branchRef}:${branchRef}`],
        context
      );
      return ok({ output: (pushStdout || stderr).trim() });
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

  getFileContent(key: BoundGitFileContentKey, signal?: AbortSignal): Promise<GitFileContentState> {
    return readGitFileContent(this.exec, this.toRelativePath(key.path), key.source, signal);
  }

  /** One-shot text read over the same machinery as the content live model. */
  async getFile(
    key: BoundGitFileContentKey
  ): Promise<Result<{ content: string | null }, GitCommandError>> {
    const state = await this.getFileContent(key);
    switch (state.kind) {
      case 'text':
        return ok({ content: state.content });
      case 'missing':
        return ok({ content: null });
      case 'binary':
        return gitErr.commandFailed(`Not a text file: ${key.path}; use download for binary reads`);
      case 'unavailable':
        return err(state.error);
    }
  }

  /** One-shot binary read; bytes are handed off as a blob source for the wire blob channel. */
  async download(
    key: BoundGitFileContentKey
  ): Promise<Result<{ meta: DownloadMeta; source: BlobSource }, DownloadError>> {
    const result = await readGitBlobDownload(this.exec, this.toRelativePath(key.path), key.source);
    if (!result.success) return result;
    return ok({ meta: result.data.meta, source: blobSourceFromBytes(result.data.bytes) });
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
