import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { err, ok, type Result, type Unsubscribe } from '@emdash/shared';
import { ExecError, type BoundExec } from '../../exec';
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
} from '../api/errors';
import {
  toRangeString,
  toRefString,
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
  toGitCommandError,
} from '../errors';
import { parseBlamePorcelain } from '../parsers/blame-parser';
import { mapGitChangeStatus } from '../parsers/diff-parser';
import { parseUnifiedFileDiff } from '../parsers/unified-diff-parser';
import { classifyGitWatchEvents } from '../watch/classifier';
import { computeHeadModel, computeStatusModel } from './compute';
import type { GitHeadModel } from './models/head';
import type { CheckoutStatusModel } from './models/status';
import type { CheckoutRepository, GitCheckoutOptions, IGitCheckout } from './types';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;
const MAX_IMAGE_BLOB_BYTES = 10 * 1024 * 1024;
const LFS_POINTER_PREFIX = Buffer.from('version https://git-lfs.github.com/spec/');
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

type Numstat = Map<string, { additions: number; deletions: number }>;
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
      computeStatusModel(options.exec, options.gitDir),
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
        const fresh = await computeStatusModel(this.exec, this.gitDir);
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
      await this.exec.exec(['reset', 'HEAD']).catch(() => {});
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
      await this.exec.exec(['reset', '--hard', 'HEAD']).catch(() => {});
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

  async push(options: PushOptions = {}): Promise<Result<{ output: string }, PushError>> {
    try {
      const { stdout, stderr } = await this.exec.exec([
        'push',
        ...(options.force ? ['--force-with-lease'] : []),
        ...(options.setUpstream
          ? ['--set-upstream', options.remote ?? 'origin', 'HEAD']
          : options.remote
            ? [options.remote]
            : []),
      ]);
      await this.refreshAfterHistoryChange();
      return ok({ output: (stdout || stderr).trim() });
    } catch (error) {
      return err(classifyPushError(error));
    }
  }

  async pull(): Promise<Result<{ output: string }, PullError>> {
    try {
      const { stdout, stderr } = await this.exec.exec(['pull']);
      await this.refreshAfterHistoryChange();
      return ok({ output: (stdout || stderr).trim() });
    } catch (error) {
      await this.refreshAfterHistoryChange();
      return err(classifyPullError(error, await this.getConflictedPaths()));
    }
  }

  async sync(): Promise<Result<{ output: string }, PushError>> {
    const pullResult = await this.pull();
    if (!pullResult.success) {
      const pullError = pullResult.error;
      if (pullError.type === 'auth_failed' || pullError.type === 'network_error') {
        return err(pullError);
      }
      return err({ type: 'git_error', message: pullError.message ?? 'pull failed' });
    }
    const pushResult = await this.push();
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
    const resolved = resolveDiffTarget(base);
    try {
      const args = resolved.cached
        ? ['diff', '--no-color', '--cached', '--', relativePath]
        : ['diff', '--no-color', resolved.ref, '--', relativePath];
      const { stdout } = await this.exec.exec(args);
      if (stdout.trim().length > 0 || resolved.cached) {
        return ok(parseUnifiedFileDiff(stdout, relativePath));
      }
      const untrackedDiff = await this.getUntrackedFileDiff(relativePath);
      return ok(untrackedDiff ?? parseUnifiedFileDiff(stdout, relativePath));
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  subscribeFileDiff(
    filePath: string,
    _base: DiffTarget | undefined,
    cb: (event: FileDiffStalenessEvent) => void
  ): Unsubscribe {
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
    const resolved = resolveDiffTarget(base);
    const diffArgs = resolved.cached
      ? ['diff', '--numstat', '--cached']
      : ['diff', '--numstat', resolved.ref];
    const nameArgs = resolved.cached
      ? ['diff', '--name-status', '--cached']
      : ['diff', '--name-status', resolved.ref];

    const [numstatResult, nameStatusResult] = await Promise.all([
      this.exec.exec(diffArgs).catch(() => ({ stdout: '' })),
      this.exec.exec(nameArgs).catch(() => ({ stdout: '' })),
    ]);
    const numstat = parseNumstat(numstatResult.stdout);
    const changes: GitChange[] = [];

    for (const line of nameStatusResult.stdout.trim().split('\n').filter(Boolean)) {
      const [code = '', ...parts] = line.split('\t');
      const filePath = parts[parts.length - 1]?.trim();
      if (!filePath) continue;
      const stat = numstat.get(filePath);
      changes.push({
        path: this.toAbsolutePath(filePath),
        status: mapGitChangeStatus(code),
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
      });
    }

    return changes;
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
    return this.getImageBlob(relativePath, `${ref}:${relativePath}`);
  }

  async getImageAtIndex(filePath: string): Promise<ImageReadResult> {
    const relativePath = this.toRelativePath(filePath);
    return this.getImageBlob(relativePath, `:${relativePath}`);
  }

  async getLog(options: GitLogOptions = {}): Promise<GitLogResult> {
    const maxCount =
      typeof options.maxCount === 'number'
        ? Math.max(1, Math.floor(options.maxCount))
        : typeof options.limit === 'number'
          ? Math.max(1, Math.floor(options.limit))
          : 50;
    const skip = typeof options.skip === 'number' ? Math.max(0, Math.floor(options.skip)) : 0;
    const head = options.head ? toRefString(options.head) : 'HEAD';
    const range = options.base ? `${toRefString(options.base)}..${head}` : head;
    const aheadCount = await this.getAheadCount(options, head);
    const { stdout } = await this.exec.exec([
      'log',
      `--max-count=${maxCount}`,
      `--skip=${skip}`,
      '--decorate=full',
      `--format=${LOG_FORMAT}`,
      range,
      '--',
    ]);
    const remoteReachable = await this.getRemoteReachableCommits();
    const commits = parseLogRecords(stdout, remoteReachable);
    return { commits, aheadCount };
  }

  async getCommit(hash: string): Promise<Commit | null> {
    try {
      const { stdout } = await this.exec.exec([
        'log',
        '--max-count=1',
        '--decorate=full',
        `--format=${LOG_FORMAT}`,
        hash,
        '--',
      ]);
      const remoteReachable = await this.getRemoteReachableCommits();
      return parseLogRecords(stdout, remoteReachable)[0] ?? null;
    } catch {
      return null;
    }
  }

  async getCommitFiles(hash: string): Promise<CommitFile[]> {
    const [numstatRes, nameStatusRes] = await Promise.all([
      this.exec.exec(['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', hash]),
      this.exec.exec(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', hash]),
    ]);
    const numstat = parseNumstat(numstatRes.stdout);
    const statusByPath = new Map<string, ReturnType<typeof mapGitChangeStatus>>();
    for (const line of nameStatusRes.stdout.trim().split('\n').filter(Boolean)) {
      const [code = '', ...parts] = line.split('\t');
      const filePath = parts[parts.length - 1];
      if (filePath) statusByPath.set(filePath, mapGitChangeStatus(code));
    }
    return [...numstat.entries()].map(([filePath, stat]) => ({
      path: this.toAbsolutePath(filePath),
      status: statusByPath.get(filePath) ?? 'modified',
      additions: stat.additions,
      deletions: stat.deletions,
    }));
  }

  async blame(filePath: string, ref?: string): Promise<Result<BlameResult, GitCommandError>> {
    try {
      const { stdout } = await this.exec.exec([
        'blame',
        '--porcelain',
        ...(ref ? [ref] : []),
        '--',
        this.toRelativePath(filePath),
      ]);
      return ok(parseBlamePorcelain(stdout));
    } catch (error) {
      return err(toGitCommandError(error));
    }
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

  private async getUntrackedFileDiff(relativePath: string): Promise<FileDiff | null> {
    const isTracked = await this.exec
      .exec(['ls-files', '--error-unmatch', '--', relativePath])
      .then(() => true)
      .catch(() => false);
    if (isTracked) return null;
    try {
      await this.exec.exec(['diff', '--no-color', '--no-index', '--', '/dev/null', relativePath]);
      return null;
    } catch (error) {
      if (error instanceof ExecError && error.exitCode === 1) {
        return parseUnifiedFileDiff(error.stdout, relativePath);
      }
      throw error;
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

  private async getImageBlob(filePath: string, spec: string): Promise<ImageReadResult> {
    const mimeType = imageMimeForPath(filePath);
    if (!mimeType) return { kind: 'unavailable', reason: 'unsupported' };

    let buffer: Buffer;
    try {
      const result = await this.exec.execBuffer(['cat-file', '--filters', spec], {
        maxBuffer: MAX_IMAGE_BLOB_BYTES,
      });
      buffer = result.stdout;
    } catch (error) {
      if (error instanceof ExecError && error.stderr.includes('maxBuffer')) {
        return { kind: 'unavailable', reason: 'too-large' };
      }
      const exitCode = error instanceof ExecError ? error.exitCode : null;
      return exitCode === 128 ? { kind: 'missing' } : { kind: 'unavailable', reason: 'git-error' };
    }

    if (buffer.length === 0) {
      return { kind: 'unavailable', reason: 'git-error' };
    }
    if (looksLikeLfsPointer(buffer)) {
      return { kind: 'unavailable', reason: 'lfs-pointer' };
    }
    return {
      kind: 'image',
      image: {
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
        mimeType,
        size: buffer.length,
      },
    };
  }

  private async getAheadCount(options: GitLogOptions, head: string): Promise<number> {
    if (typeof options.knownAheadCount === 'number') return Math.max(0, options.knownAheadCount);
    if (options.base) {
      try {
        const { stdout } = await this.exec.exec([
          'rev-list',
          '--count',
          `${toRefString(options.base)}..${head}`,
        ]);
        return Number.parseInt(stdout.trim(), 10) || 0;
      } catch {
        return 0;
      }
    }

    try {
      const { stdout } = await this.exec.exec(['rev-list', '--count', '@{upstream}..HEAD']);
      return Number.parseInt(stdout.trim(), 10) || 0;
    } catch {}

    const remote = options.preferredRemote?.trim() || 'origin';
    try {
      const { stdout: branchOut } = await this.exec.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
      const branch = branchOut.trim();
      if (!branch || branch === 'HEAD') return 0;
      const { stdout } = await this.exec.exec(['rev-list', '--count', `${remote}/${branch}..HEAD`]);
      return Number.parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  private async getRemoteReachableCommits(): Promise<Set<string>> {
    try {
      const { stdout } = await this.exec.exec(['rev-list', '--remotes', '--max-count=10000']);
      return new Set(
        stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      );
    } catch {
      return new Set();
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
    for (const cb of callbacks) {
      cb({ path: relativePath, reason });
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

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const LOG_FORMAT = `%H${FIELD_SEP}%P${FIELD_SEP}%s${FIELD_SEP}%b${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%D${RECORD_SEP}`;

function parseLogRecords(stdout: string, remoteReachable: Set<string>): Commit[] {
  return stdout
    .split(RECORD_SEP)
    .map((record) => record.replace(/^\n/, '').trimEnd())
    .filter(Boolean)
    .map((record) => {
      const [
        hash = '',
        parents = '',
        subject = '',
        body = '',
        author = '',
        date = '',
        decorations = '',
      ] = record.split(FIELD_SEP);
      return {
        hash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        subject,
        body: body.trim(),
        author,
        date,
        isPushed: remoteReachable.has(hash),
        tags: parseDecoratedTags(decorations),
      };
    });
}

function parseDecoratedTags(decorations: string): string[] {
  return decorations
    .split(',')
    .map((decoration) => decoration.trim())
    .filter((decoration) => decoration.startsWith('tag: '))
    .map((decoration) => decoration.slice('tag: '.length).replace(/^refs\/tags\//, ''))
    .filter(Boolean);
}

function parseNumstat(stdout: string): Numstat {
  const map: Numstat = new Map();
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const [addStr, delStr, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t');
    if (!filePath) continue;
    const current = map.get(filePath) ?? { additions: 0, deletions: 0 };
    current.additions += addStr === '-' ? 0 : Number.parseInt(addStr ?? '0', 10) || 0;
    current.deletions += delStr === '-' ? 0 : Number.parseInt(delStr ?? '0', 10) || 0;
    map.set(filePath, current);
  }
  return map;
}

function resolveDiffTarget(base: DiffTarget): { cached: boolean; ref: string } {
  if ('base' in base) return { cached: false, ref: toRangeString(base) };
  if (base.kind === 'staged') return { cached: true, ref: '--cached' };
  if (base.kind === 'head') return { cached: false, ref: 'HEAD' };
  return { cached: false, ref: toRefString(base) };
}

function extractHunkPatch(diffText: string, hunkHeader: string): string | null {
  const lines = diffText.split('\n');
  const firstHunkIndex = lines.findIndex((line) => line.startsWith('@@'));
  if (firstHunkIndex === -1) return null;

  const headerLines = lines.slice(0, firstHunkIndex);
  let start = -1;
  for (let i = firstHunkIndex; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith('@@') && (line === hunkHeader || line.startsWith(hunkHeader))) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith('@@') || line.startsWith('diff --git')) {
      end = i;
      break;
    }
  }

  const patchLines = [...headerLines, ...lines.slice(start, end)];
  while (patchLines.length > 0 && patchLines[patchLines.length - 1] === '') {
    patchLines.pop();
  }
  return `${patchLines.join('\n')}\n`;
}

function imageMimeForPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? (IMAGE_MIME_BY_EXT[ext] ?? null) : null;
}

function looksLikeLfsPointer(buffer: Buffer): boolean {
  if (buffer.length > 1024) return false;
  return buffer.subarray(0, LFS_POINTER_PREFIX.length).equals(LFS_POINTER_PREFIX);
}
