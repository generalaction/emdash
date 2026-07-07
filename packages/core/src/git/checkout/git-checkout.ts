import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { err, ok, type Result, type Unsubscribe } from '@emdash/shared';
import type { BoundExec } from '../../exec';
import { RefreshScheduler } from '../../lib/refresh-scheduler';
import { LiveModelServer, reconcileDraft } from '../../live/model';
import type { WatchHandle } from '../../watch';
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
  type FileDiffStalenessEvent,
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
import { classifyGitWatchEvents } from '../watch/classifier';
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

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

type StalenessCallback = (event: FileDiffStalenessEvent) => void;

/**
 * A single working tree of a repository, in workspace-server contract shape.
 *
 * State flows one way: filesystem/git-dir watch events (and explicit
 * `refreshNow` after mutations) demand a recompute through per-model
 * RefreshSchedulers; each recompute reconciles the fresh value into a
 * LiveModelServer, which emits minimal patches to subscribers.
 */
export class GitCheckout implements IGitCheckout {
  readonly checkoutPath: string;
  readonly gitDir: string;
  readonly status: LiveModelServer<CheckoutStatusModel>;
  readonly head: LiveModelServer<GitHeadModel>;

  private readonly repository: CheckoutRepository;
  private readonly exec: BoundExec;
  private readonly statusRefresh: RefreshScheduler;
  private readonly headRefresh: RefreshScheduler;
  private readonly worktreeWatch: WatchHandle;
  private readonly unregisterFromRepository: Unsubscribe;
  private readonly diffSubscriptions = new Map<string, Set<StalenessCallback>>();

  static async create(options: GitCheckoutOptions): Promise<GitCheckout> {
    const [status, head] = await Promise.all([
      computeStatusModel(options.exec, options.gitDir, options.checkoutPath),
      computeHeadModel(options.exec).catch(
        (): GitHeadModel => ({ kind: 'unborn', name: 'unknown' })
      ),
    ]);
    const checkout = new GitCheckout(options, status, head);
    await checkout.worktreeWatch.ready();
    return checkout;
  }

  private constructor(
    options: GitCheckoutOptions,
    initialStatus: CheckoutStatusModel,
    initialHead: GitHeadModel
  ) {
    this.checkoutPath = options.checkoutPath;
    this.gitDir = options.gitDir;
    this.repository = options.repository;
    this.exec = options.exec;
    const onError = options.onError ?? (() => {});

    this.status = new LiveModelServer<CheckoutStatusModel>(initialStatus);
    this.head = new LiveModelServer<GitHeadModel>(initialHead);

    this.statusRefresh = new RefreshScheduler({
      refresh: async () => {
        const fresh = await computeStatusModel(this.exec, this.gitDir, this.checkoutPath);
        this.status.produce((draft) => reconcileDraft(draft, fresh) as never);
      },
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`status ${this.checkoutPath}`, error),
    });
    this.headRefresh = new RefreshScheduler({
      refresh: async () => {
        const fresh = await computeHeadModel(this.exec);
        this.head.produce((draft) => reconcileDraft(draft, fresh) as never);
      },
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`head ${this.checkoutPath}`, error),
    });

    this.unregisterFromRepository = this.repository.registerCheckout(this.checkoutPath, {
      gitDir: this.gitDir,
      worktree: this.checkoutPath,
      onEffects: (effects) => {
        if (effects.status) {
          this.statusRefresh.invalidate();
          this.notifyDiffStaleness('index-changed');
        }
        if (effects.head) {
          this.headRefresh.invalidate();
          this.notifyDiffStaleness('ref-changed');
        }
      },
    });

    this.worktreeWatch = options.watcher.watch(
      this.checkoutPath,
      (events) => {
        const classification = classifyGitWatchEvents(events, {
          gitCommonDir: this.repository.gitCommonDir,
          worktrees: [{ id: 'self', gitDir: this.gitDir, worktree: this.checkoutPath }],
        });
        const effects = classification.worktrees.get('self');
        if (effects?.status) this.statusRefresh.invalidate();
        if (effects?.head) this.headRefresh.invalidate();

        for (const event of events) {
          const relative = this.toRelativePath(event.path);
          if (this.diffSubscriptions.has(relative)) {
            this.emitDiffStaleness(relative, 'content-changed');
          }
        }
      },
      {
        ignore: ['.git/**'],
        onResync: () => {
          this.statusRefresh.invalidate();
          this.headRefresh.invalidate();
        },
      }
    );
  }

  async refresh(): Promise<void> {
    await Promise.all([this.statusRefresh.refreshNow(), this.headRefresh.refreshNow()]);
  }

  async dispose(): Promise<void> {
    this.unregisterFromRepository();
    await this.worktreeWatch.release();
    this.statusRefresh.dispose();
    this.headRefresh.dispose();
    this.diffSubscriptions.clear();
  }

  // -- Staging ----------------------------------------------------------------

  async stage(paths: string[]): Promise<Result<void, GitCommandError>> {
    if (paths.length === 0) return ok(undefined);
    return this.statusMutation(() => this.exec.exec(['add', '--', ...this.toRelativePaths(paths)]));
  }

  async unstage(paths: string[]): Promise<Result<void, GitCommandError>> {
    if (paths.length === 0) return ok(undefined);
    return this.statusMutation(() =>
      this.exec.exec(['reset', 'HEAD', '--', ...this.toRelativePaths(paths)])
    );
  }

  async stageAll(): Promise<Result<void, GitCommandError>> {
    return this.statusMutation(() => this.exec.exec(['add', '-A']));
  }

  async unstageAll(): Promise<Result<void, GitCommandError>> {
    return this.statusMutation(async () => {
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
    return this.statusMutation(async () => {
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
    return this.statusMutation(async () => {
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
    return this.statusMutation(() =>
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
      await this.refreshAfterHistoryChange();
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
      await this.refreshAfterHistoryChange();
      return ok(undefined);
    } catch (error) {
      return err(classifySwitchError(error, options.ref));
    }
  }

  async reset(ref: string, mode: ResetMode = 'mixed'): Promise<Result<void, GitCommandError>> {
    return this.historyMutation(() => this.exec.exec(['reset', `--${mode}`, ref]));
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
      await this.refreshAfterHistoryChange();
      return ok(undefined);
    } catch (error) {
      await this.refreshAfterHistoryChange();
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
      await this.refreshAfterHistoryChange();
      return ok(undefined);
    } catch (error) {
      return err(classifyMergeError(error, await this.getConflictedPaths()));
    }
  }

  async mergeAbort(): Promise<Result<void, GitCommandError>> {
    return this.historyMutation(() => this.exec.exec(['merge', '--abort']));
  }

  async rebase(options: RebaseOptions): Promise<Result<void, RebaseError>> {
    try {
      await this.exec.exec(['rebase', options.onto], { env: { GIT_EDITOR: 'true' } });
      await this.refreshAfterHistoryChange();
      return ok(undefined);
    } catch (error) {
      await this.refreshAfterHistoryChange();
      return err(classifyRebaseError(error, await this.getConflictedPaths()));
    }
  }

  async rebaseContinue(): Promise<Result<void, RebaseError>> {
    try {
      await this.exec.exec(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } });
      await this.refreshAfterHistoryChange();
      return ok(undefined);
    } catch (error) {
      return err(classifyRebaseError(error, await this.getConflictedPaths()));
    }
  }

  async rebaseAbort(): Promise<Result<void, GitCommandError>> {
    return this.historyMutation(() => this.exec.exec(['rebase', '--abort']));
  }

  async rebaseSkip(): Promise<Result<void, GitCommandError>> {
    return this.historyMutation(() =>
      this.exec.exec(['rebase', '--skip'], { env: { GIT_EDITOR: 'true' } })
    );
  }

  async cherryPick(commits: string[], noCommit = false): Promise<Result<void, MergeError>> {
    if (commits.length === 0) return ok(undefined);
    try {
      await this.exec.exec(['cherry-pick', ...(noCommit ? ['-n'] : []), ...commits]);
      await this.refreshAfterHistoryChange();
      return ok(undefined);
    } catch (error) {
      await this.refreshAfterHistoryChange();
      return err(classifyMergeError(error, await this.getConflictedPaths()));
    }
  }

  async revertCommit(commit: string, noCommit = false): Promise<Result<void, MergeError>> {
    try {
      await this.exec.exec(['revert', '--no-edit', ...(noCommit ? ['-n'] : []), commit]);
      await this.refreshAfterHistoryChange();
      return ok(undefined);
    } catch (error) {
      await this.refreshAfterHistoryChange();
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
      await this.refreshAfterHistoryChange();
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
      await this.refreshAfterHistoryChange();
      return ok({ output: (stdout || stderr).trim() });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      await this.refreshAfterHistoryChange();
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
    return this.stashMutation(() =>
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
    return this.stashMutation(() =>
      this.exec.exec([
        'stash',
        'apply',
        ...(stashIndex !== undefined ? [`stash@{${stashIndex}}`] : []),
      ])
    );
  }

  async stashPop(stashIndex?: number): Promise<Result<void, GitCommandError>> {
    return this.stashMutation(() =>
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

  subscribeFileDiff(filePath: string, cb: (event: FileDiffStalenessEvent) => void): Unsubscribe {
    const relativePath = this.toRelativePath(filePath);
    let callbacks = this.diffSubscriptions.get(relativePath);
    if (!callbacks) {
      callbacks = new Set();
      this.diffSubscriptions.set(relativePath, callbacks);
    }
    callbacks.add(cb);
    return () => {
      const current = this.diffSubscriptions.get(relativePath);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) this.diffSubscriptions.delete(relativePath);
    };
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

  private async statusMutation(
    run: () => Promise<unknown>
  ): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      await this.statusRefresh.refreshNow();
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  private async historyMutation(
    run: () => Promise<unknown>
  ): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      await this.refreshAfterHistoryChange();
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  private async stashMutation(run: () => Promise<unknown>): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      await this.statusRefresh.refreshNow();
      await this.repository.onCheckoutMutation('stashes');
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  private async refreshAfterHistoryChange(): Promise<void> {
    await Promise.all([
      this.statusRefresh.refreshNow(),
      this.headRefresh.refreshNow(),
      this.repository.onCheckoutMutation('refs'),
    ]);
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
      await this.statusRefresh.refreshNow();
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

  private notifyDiffStaleness(reason: FileDiffStalenessEvent['reason']): void {
    for (const relativePath of this.diffSubscriptions.keys()) {
      this.emitDiffStaleness(relativePath, reason);
    }
  }

  private emitDiffStaleness(relativePath: string, reason: FileDiffStalenessEvent['reason']): void {
    const callbacks = this.diffSubscriptions.get(relativePath);
    if (!callbacks) return;
    const absolutePath = this.toAbsolutePath(relativePath);
    for (const cb of callbacks) {
      cb({ path: absolutePath, reason });
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
