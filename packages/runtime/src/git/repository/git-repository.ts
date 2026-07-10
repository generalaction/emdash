import type { BoundExec } from '@emdash/core/exec';
import {
  classifyCreateBranchError,
  classifyDeleteBranchError,
  classifyFetchError,
  classifyFetchPrForReviewError,
  classifyPushError,
  toGitCommandError,
  type AddCheckoutOptions,
  type CheckoutInfo,
  type CreateBranchError,
  type CreateBranchOptions,
  type DeleteBranchError,
  type FetchError,
  type FetchPrForReviewError,
  type FetchPrForReviewOptions,
  type GitCommandError,
  type GitOpContext,
  type GitRefsModel,
  type GitRemotesModel,
  type GitStashesModel,
  type IGitRepository,
  type PushError,
  type TagOptions,
} from '@emdash/core/git';
import type { KeyedMutex } from '@emdash/core/lib';
import { realpathOrResolve } from '@emdash/core/watch';
import { err, ok, type Result } from '@emdash/shared';
import { execGitWithProgress, throwIfGitOpAborted } from '../exec/transfer-progress';
import { CatFileBatch } from './ops/cat-file-batch';
import { parseWorktreeList } from './ops/checkouts';
import { computeRefsModel } from './ops/refs';
import { computeRemotesModel, remoteNameForRepositoryUrl } from './ops/remotes';
import { computeStashesModel } from './ops/stashes';
import type { GitRepositoryOptions } from './types';

/**
 * A repository (shared `.git` directory) capability. It knows Git commands and
 * fresh reads; live-state ownership lives in the repository live-model runtime.
 */
export class GitRepository implements IGitRepository {
  readonly gitCommonDir: string;

  private readonly objectStoreDir: string;
  private readonly exec: BoundExec;
  private readonly objectStoreMutex: KeyedMutex;
  private catFile: CatFileBatch | null = null;

  static async create(options: GitRepositoryOptions): Promise<GitRepository> {
    return new GitRepository(options);
  }

  private constructor(options: GitRepositoryOptions) {
    this.gitCommonDir = options.gitCommonDir;
    this.objectStoreDir = options.objectStoreDir;
    this.exec = options.exec;
    this.objectStoreMutex = options.objectStoreMutex;
  }

  async getRefs(): Promise<GitRefsModel> {
    const remotes = await this.getRemotes().catch((): GitRemotesModel => ({ remotes: [] }));
    return computeRefsModel(this.exec, remotes.remotes);
  }

  getRemotes(): Promise<GitRemotesModel> {
    return computeRemotesModel(this.exec);
  }

  getStashes(): Promise<GitStashesModel> {
    return computeStashesModel(this.exec);
  }

  async dispose(): Promise<void> {
    this.catFile?.dispose();
    this.catFile = null;
  }

  // -- Checkout integration -----------------------------------------------------

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
      return ok(undefined);
    } catch (error) {
      return err(classifyCreateBranchError(error, name, from));
    }
  }

  async deleteBranch(branch: string, force = false): Promise<Result<void, DeleteBranchError>> {
    try {
      await this.exec.exec(['branch', force ? '-D' : '-d', '--', branch]);
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
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  // -- Internals ----------------------------------------------------------------------

  private async refsMutation(run: () => Promise<unknown>): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  private async remotesMutation(
    run: () => Promise<unknown>
  ): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      return ok(undefined);
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

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
