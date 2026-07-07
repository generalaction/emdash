import { err, ok, type Result, type Unsubscribe } from '@emdash/shared';
import type { BoundExec } from '../../exec';
import type { KeyedMutex } from '../../lib';
import { RefreshScheduler } from '../../lib/refresh-scheduler';
import { LiveModelServer, reconcileDraft } from '../../live/model';
import { realpathOrResolve, type WatchHandle } from '../../watch';
import type {
  AddCheckoutOptions,
  CreateBranchOptions,
  FetchPrForReviewOptions,
  TagOptions,
} from '../api/commands';
import type {
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  GitCommandError,
  PushError,
} from '../api/errors';
import type { CheckoutInfo } from '../api/queries';
import {
  classifyCreateBranchError,
  classifyDeleteBranchError,
  classifyFetchError,
  classifyFetchPrForReviewError,
  classifyPushError,
  toGitCommandError,
} from '../errors';
import { execGitWithProgress, throwIfGitOpAborted, type GitOpContext } from '../transfer-progress';
import { classifyGitWatchEvents } from '../watch/classifier';
import type { GitRefsModel } from './models/refs';
import type { GitRemotesModel } from './models/remotes';
import type { GitStashesModel } from './models/stashes';
import { CatFileBatch } from './ops/cat-file-batch';
import { parseWorktreeList } from './ops/checkouts';
import { computeRefsModel } from './ops/refs';
import { computeRemotesModel, remoteNameForRepositoryUrl } from './ops/remotes';
import { computeStashesModel } from './ops/stashes';
import type { CheckoutWatchRegistration, GitRepositoryOptions, IGitRepository } from './types';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

/**
 * A repository (shared `.git` directory), in workspace-server contract shape.
 *
 * Owns the single commonDir watch: linked-worktree git dirs live inside the
 * commonDir and the main checkout's git dir *is* it, so this is the one place
 * that observes ref/index/HEAD churn. Classified effects fan out to the
 * repository's own models (refs / remotes / stashes) and to registered
 * checkouts. Mutations run the git command, then synchronously refresh the
 * affected models before resolving, so callers read their own writes.
 */
export class GitRepository implements IGitRepository {
  readonly gitCommonDir: string;
  readonly refs: LiveModelServer<GitRefsModel>;
  readonly remotes: LiveModelServer<GitRemotesModel>;
  readonly stashes: LiveModelServer<GitStashesModel>;

  private readonly objectStoreDir: string;
  private readonly exec: BoundExec;
  private readonly objectStoreMutex: KeyedMutex;
  private readonly refsRefresh: RefreshScheduler;
  private readonly remotesRefresh: RefreshScheduler;
  private readonly stashesRefresh: RefreshScheduler;
  private readonly commonDirWatch: WatchHandle;
  private readonly checkouts = new Map<string, CheckoutWatchRegistration>();
  private catFile: CatFileBatch | null = null;

  /** Async factory: seeds all three live models before the instance is observable. */
  static async create(options: GitRepositoryOptions): Promise<GitRepository> {
    const remotes = await computeRemotesModel(options.exec).catch(
      (): GitRemotesModel => ({ remotes: [] })
    );
    const [refs, stashes] = await Promise.all([
      computeRefsModel(options.exec, remotes.remotes).catch(
        (): GitRefsModel => ({ branches: [], tags: [] })
      ),
      computeStashesModel(options.exec).catch((): GitStashesModel => ({ stashes: [] })),
    ]);
    const repository = new GitRepository(options, refs, remotes, stashes);
    await repository.commonDirWatch.ready();
    return repository;
  }

  private constructor(
    options: GitRepositoryOptions,
    initialRefs: GitRefsModel,
    initialRemotes: GitRemotesModel,
    initialStashes: GitStashesModel
  ) {
    this.gitCommonDir = options.gitCommonDir;
    this.objectStoreDir = options.objectStoreDir;
    this.exec = options.exec;
    this.objectStoreMutex = options.objectStoreMutex;
    const onError = options.onError ?? (() => {});

    this.refs = new LiveModelServer<GitRefsModel>(initialRefs);
    this.remotes = new LiveModelServer<GitRemotesModel>(initialRemotes);
    this.stashes = new LiveModelServer<GitStashesModel>(initialStashes);

    this.refsRefresh = new RefreshScheduler({
      refresh: async () => {
        const remotes = await computeRemotesModel(this.exec);
        const fresh = await computeRefsModel(this.exec, remotes.remotes);
        this.refs.produce((draft) => reconcileDraft(draft, fresh) as never);
      },
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`refs ${this.gitCommonDir}`, error),
    });
    this.remotesRefresh = new RefreshScheduler({
      refresh: async () => {
        const fresh = await computeRemotesModel(this.exec);
        this.remotes.produce((draft) => reconcileDraft(draft, fresh) as never);
      },
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`remotes ${this.gitCommonDir}`, error),
    });
    this.stashesRefresh = new RefreshScheduler({
      refresh: async () => {
        const fresh = await computeStashesModel(this.exec);
        this.stashes.produce((draft) => reconcileDraft(draft, fresh) as never);
      },
      debounceMs: WATCH_DEBOUNCE_MS,
      intervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`stashes ${this.gitCommonDir}`, error),
    });

    this.commonDirWatch = options.watcher.watch(
      this.gitCommonDir,
      (events) => {
        const classification = classifyGitWatchEvents(events, this.layout());
        if (classification.repo.refs) this.refsRefresh.invalidate();
        if (classification.repo.remotes) this.remotesRefresh.invalidate();
        if (classification.repo.stashes) this.stashesRefresh.invalidate();
        for (const [id, effects] of classification.worktrees) {
          this.checkouts.get(id)?.onEffects(effects);
        }
      },
      {
        ignore: ['objects/**'],
        onResync: () => {
          this.refsRefresh.invalidate();
          this.remotesRefresh.invalidate();
          this.stashesRefresh.invalidate();
          for (const registration of this.checkouts.values()) {
            registration.onEffects({ status: true, head: true });
          }
        },
      }
    );
  }

  async refresh(): Promise<void> {
    await Promise.all([
      this.refsRefresh.refreshNow(),
      this.remotesRefresh.refreshNow(),
      this.stashesRefresh.refreshNow(),
    ]);
  }

  async dispose(): Promise<void> {
    await this.commonDirWatch.release();
    this.refsRefresh.dispose();
    this.remotesRefresh.dispose();
    this.stashesRefresh.dispose();
    this.checkouts.clear();
    this.catFile?.dispose();
    this.catFile = null;
  }

  // -- Checkout integration -----------------------------------------------------

  registerCheckout(id: string, registration: CheckoutWatchRegistration): Unsubscribe {
    this.checkouts.set(id, registration);
    return () => {
      if (this.checkouts.get(id) === registration) this.checkouts.delete(id);
    };
  }

  async readBlobAtRef(ref: string, filePath: string): Promise<string | null> {
    this.catFile ??= new CatFileBatch({ exec: this.exec });
    try {
      return await this.catFile.readText(`${ref}:${filePath}`);
    } catch {
      try {
        const { stdout } = await this.exec.exec(['show', `${ref}:${filePath}`]);
        return stdout;
      } catch {
        return null;
      }
    }
  }

  /** Sync-refresh hook for checkout mutations that change repository-owned facts. */
  onCheckoutMutation(effect: 'refs' | 'stashes'): Promise<void> {
    return effect === 'refs' ? this.refsRefresh.refreshNow() : this.stashesRefresh.refreshNow();
  }

  // -- Checkouts (worktrees) ------------------------------------------------------

  async listCheckouts(): Promise<CheckoutInfo[]> {
    const { stdout } = await this.exec.exec(['worktree', 'list', '--porcelain']);
    return parseWorktreeList(stdout);
  }

  async addCheckout(options: AddCheckoutOptions): Promise<Result<CheckoutInfo, GitCommandError>> {
    try {
      await this.exec.exec([
        'worktree',
        'add',
        ...(options.force ? ['--force'] : []),
        ...(options.newBranch ? ['-b', options.newBranch] : []),
        options.path,
        ...(options.ref ? [options.ref] : []),
      ]);
      await this.refsRefresh.refreshNow();
      const target = realpathOrResolve(options.path);
      const checkouts = await this.listCheckouts();
      const info = checkouts.find(
        (checkout) => realpathOrResolve(checkout.checkoutPath) === target
      );
      if (!info) {
        return err({
          type: 'git_error',
          message: `worktree added but not listed: ${options.path}`,
        });
      }
      return ok(info);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async removeCheckout(
    checkoutPath: string,
    force = false
  ): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() =>
      this.exec.exec(['worktree', 'remove', ...(force ? ['--force'] : []), checkoutPath])
    );
  }

  async pruneCheckouts(): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['worktree', 'prune']));
  }

  // -- Branches and tags ----------------------------------------------------------

  async createBranch(options: CreateBranchOptions): Promise<Result<void, CreateBranchError>> {
    const name = options.name;
    const from = options.from ?? 'HEAD';

    if (options.syncWithRemote) {
      const remote = options.remote ?? 'origin';
      const fetchResult = await this.fetch(remote);
      if (!fetchResult.success) {
        return err({ type: 'fetch_failed', remote, branch: from, error: fetchResult.error });
      }
    }

    const base = options.syncWithRemote ? `${options.remote ?? 'origin'}/${from}` : from;
    try {
      await this.exec.exec(['branch', '--no-track', '--', name, base]);
      await this.setBranchBaseConfig(name, base);
      await this.refsRefresh.refreshNow();
      return ok(undefined);
    } catch (error) {
      return err(classifyCreateBranchError(error, name, from));
    }
  }

  async deleteBranch(branch: string, force = false): Promise<Result<void, DeleteBranchError>> {
    try {
      await this.exec.exec(['branch', force ? '-D' : '-d', '--', branch]);
      await this.refsRefresh.refreshNow();
      return ok(undefined);
    } catch (error) {
      return err(classifyDeleteBranchError(error, branch));
    }
  }

  async renameBranch(oldName: string, newName: string): Promise<Result<void, GitCommandError>> {
    return this.refsMutation(() => this.exec.exec(['branch', '-m', '--', oldName, newName]));
  }

  async setUpstream(
    branch: string,
    upstream: string | null
  ): Promise<Result<void, GitCommandError>> {
    return this.refsMutation(() =>
      this.exec.exec(
        upstream === null
          ? ['branch', '--unset-upstream', '--', branch]
          : ['branch', `--set-upstream-to=${upstream}`, '--', branch]
      )
    );
  }

  async createTag(options: TagOptions): Promise<Result<void, GitCommandError>> {
    return this.refsMutation(() =>
      this.exec.exec([
        'tag',
        ...(options.force ? ['--force'] : []),
        ...(options.message !== undefined ? ['-a', '-m', options.message] : []),
        options.name,
        ...(options.ref ? [options.ref] : []),
      ])
    );
  }

  async deleteTag(name: string): Promise<Result<void, GitCommandError>> {
    return this.refsMutation(() => this.exec.exec(['tag', '-d', name]));
  }

  // -- Remotes and network ----------------------------------------------------------

  async addRemote(name: string, url: string): Promise<Result<void, GitCommandError>> {
    return this.remotesMutation(() => this.exec.exec(['remote', 'add', name, url]));
  }

  async removeRemote(name: string): Promise<Result<void, GitCommandError>> {
    return this.remotesMutation(() => this.exec.exec(['remote', 'remove', name]));
  }

  async fetch(remote?: string, context: GitOpContext = {}): Promise<Result<void, FetchError>> {
    try {
      throwIfGitOpAborted(context.signal);
      const key = realpathOrResolve(this.objectStoreDir);
      await this.objectStoreMutex.runExclusive(key, async () => {
        throwIfGitOpAborted(context.signal);
        await execGitWithProgress(
          this.exec,
          ['fetch', '--progress', ...(remote ? [remote] : [])],
          context
        );
      });
      await this.refsRefresh.refreshNow();
      return ok(undefined);
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return err(classifyFetchError(error, remote));
    }
  }

  async publishBranch(
    branchName: string,
    remote = 'origin',
    context: GitOpContext = {}
  ): Promise<Result<{ output: string }, PushError>> {
    try {
      const { stdout, stderr } = await execGitWithProgress(
        this.exec,
        ['push', '--progress', '--set-upstream', remote, '--', branchName],
        context
      );
      await this.refsRefresh.refreshNow();
      return ok({ output: (stdout || stderr).trim() });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return err(classifyPushError(error));
    }
  }

  async getDefaultBranch(remote = 'origin'): Promise<string> {
    try {
      const { stdout } = await this.exec.exec([
        'symbolic-ref',
        `refs/remotes/${remote}/HEAD`,
        '--short',
      ]);
      const ref = stdout.trim();
      if (ref) {
        const slash = ref.indexOf('/');
        return slash === -1 ? ref : ref.slice(slash + 1);
      }
    } catch {}

    try {
      const { stdout } = await this.exec.exec(['remote', 'show', remote]);
      const match = /HEAD branch:\s*(\S+)/.exec(stdout);
      if (match?.[1] && match[1] !== '(unknown)') return match[1];
    } catch {}

    for (const candidate of ['main', 'master', 'develop', 'trunk']) {
      if (await this.branchExistsLocally(candidate)) return candidate;
    }

    return 'main';
  }

  async fetchPrForReview(
    options: FetchPrForReviewOptions,
    context: GitOpContext = {}
  ): Promise<Result<void, FetchPrForReviewError>> {
    try {
      if (options.isFork) {
        const forkRemote = remoteNameForRepositoryUrl(options.headRepositoryUrl);
        const remotes = await this.exec
          .exec(['remote'], { signal: context.signal })
          .catch((error) => {
            if (context.signal?.aborted) throw error;
            return { stdout: '' };
          });
        const names = remotes.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (names.includes(forkRemote)) {
          await this.exec.exec(['remote', 'set-url', forkRemote, options.headRepositoryUrl], {
            signal: context.signal,
          });
        } else {
          await this.exec.exec(['remote', 'add', forkRemote, options.headRepositoryUrl], {
            signal: context.signal,
          });
        }
        await execGitWithProgress(
          this.exec,
          [
            'fetch',
            '--progress',
            forkRemote,
            '--force',
            '--',
            `${options.headRefName}:refs/heads/${options.localBranch}`,
          ],
          context
        );
        await this.exec
          .exec(
            [
              'branch',
              `--set-upstream-to=${forkRemote}/${options.headRefName}`,
              '--',
              options.localBranch,
            ],
            { signal: context.signal }
          )
          .catch((error) => {
            if (context.signal?.aborted) throw error;
            return { stdout: '', stderr: '' };
          });
        await Promise.all([this.refsRefresh.refreshNow(), this.remotesRefresh.refreshNow()]);
        return ok(undefined);
      }

      const remote = options.configuredRemote ?? 'origin';
      await execGitWithProgress(
        this.exec,
        [
          'fetch',
          '--progress',
          remote,
          '--force',
          '--',
          `refs/pull/${options.prNumber}/head:refs/heads/${options.localBranch}`,
        ],
        context
      );
      await this.exec
        .exec(
          [
            'branch',
            `--set-upstream-to=${remote}/${options.headRefName}`,
            '--',
            options.localBranch,
          ],
          { signal: context.signal }
        )
        .catch((error) => {
          if (context.signal?.aborted) throw error;
          return { stdout: '', stderr: '' };
        });
      await this.refsRefresh.refreshNow();
      return ok(undefined);
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return err(classifyFetchPrForReviewError(error, options.prNumber));
    }
  }

  // -- Stashes ----------------------------------------------------------------------

  async stashDrop(stashIndex: number): Promise<Result<void, GitCommandError>> {
    try {
      await this.exec.exec(['stash', 'drop', `stash@{${stashIndex}}`]);
      await this.stashesRefresh.refreshNow();
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  // -- Internals ----------------------------------------------------------------------

  private layout() {
    return {
      gitCommonDir: this.gitCommonDir,
      worktrees: [...this.checkouts.entries()].map(([id, registration]) => ({
        id,
        gitDir: registration.gitDir,
        worktree: registration.worktree,
      })),
    };
  }

  private async refsMutation(run: () => Promise<unknown>): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      await this.refsRefresh.refreshNow();
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  /** Remote config changes also remap branch upstreams, so refresh both models. */
  private async remotesMutation(
    run: () => Promise<unknown>
  ): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      await Promise.all([this.remotesRefresh.refreshNow(), this.refsRefresh.refreshNow()]);
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  /** No live model depends on the outcome; run and classify only. */
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

  private async branchExistsLocally(branch: string): Promise<boolean> {
    try {
      await this.exec.exec(['rev-parse', '--verify', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  private async setBranchBaseConfig(branchName: string, baseRef: string): Promise<void> {
    try {
      await this.exec.exec(['config', `branch.${branchName}.base`, baseRef]);
    } catch {}
  }
}
