import type { BoundExec } from '@emdash/core/exec';
import {
  gitErr,
  type AddWorktreeOptions,
  type CreateBranchError,
  type DeleteBranchError,
  type ExplicitCreateBranchOptions,
  type ExplicitTagOptions,
  type FetchError,
  type FetchPrForReviewError,
  type FetchPrForReviewOptions,
  type GitCommandError,
  type GitRefsState,
  type GitRemotesState,
  type GitStashesState,
  type GitWorktreesState,
  type PushError,
  type WorktreeSummary,
} from '@emdash/core/git';
import {
  parsePortableRelativePath,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '@emdash/core/path';
import { ok, type Result } from '@emdash/shared';
import type { RepositoryIdentity } from '../allocation/identity';
import { realpathOrResolve, toHostAbsolutePath, toNativeAbsolutePath } from '../allocation/paths';
import { commandFailed, pushFailed } from '../exec/errors';
import type { GitOperationContext } from '../exec/operation-context';
import { execGitWithProgress, throwIfGitOpAborted } from '../exec/transfer-progress';
import { repositoryFailures } from './errors';
import { CatFileBatch, CatFileBatchProcessError } from './ops/cat-file-batch';
import { computeRefsState } from './ops/refs';
import { computeRemotesState, remoteNameForRepositoryUrl } from './ops/remotes';
import { computeStashesState } from './ops/stashes';
import { parseWorktreeList } from './ops/worktrees';

type GitRepositoryOptions = {
  identity: RepositoryIdentity;
  exec: BoundExec;
};

/**
 * A repository (shared `.git` directory) capability. It knows Git commands and
 * fresh reads; live-state ownership lives in the repository live-model runtime.
 */
export class GitRepository {
  readonly identity: RepositoryIdentity;
  private readonly exec: BoundExec;
  private catFile: CatFileBatch | null = null;

  constructor(options: GitRepositoryOptions) {
    this.identity = options.identity;
    this.exec = options.exec;
  }

  get gitCommonDir(): string {
    return this.identity.gitCommonDir;
  }

  async getRefs(): Promise<GitRefsState> {
    const remotes = await this.getRemotes();
    return computeRefsState(this.exec, remotes.remotes);
  }

  getRemotes(): Promise<GitRemotesState> {
    return computeRemotesState(this.exec);
  }

  getStashes(): Promise<GitStashesState> {
    return computeStashesState(this.exec);
  }

  dispose(): void {
    this.catFile?.dispose();
    this.catFile = null;
  }

  // -- Checkout integration -----------------------------------------------------

  async readBlobAtRef(ref: string, filePath: PortableRelativePath): Promise<string | null> {
    const treePath = normalizeTreePath(filePath);
    const spec = `${ref}:${treePath}`;
    this.catFile ??= new CatFileBatch({ exec: this.exec });
    try {
      return await this.catFile.readText(spec);
    } catch (error) {
      if (error instanceof CatFileBatchProcessError) return this.readBlobOnce(spec);
      throw error;
    }
  }

  // -- Checkouts (worktrees) ------------------------------------------------------

  async listWorktrees(): Promise<GitWorktreesState> {
    const { stdout } = await this.exec.exec(['worktree', 'list', '--porcelain']);
    return parseWorktreeList(stdout, toHostAbsolutePath);
  }

  async addWorktree(
    options: AddWorktreeOptions
  ): Promise<Result<WorktreeSummary, GitCommandError>> {
    try {
      const targetPath = toNativeAbsolutePath(options.path);
      await this.exec.exec([
        'worktree',
        'add',
        ...(options.force ? ['--force'] : []),
        ...(options.newBranch ? ['-b', options.newBranch] : []),
        targetPath,
        options.ref,
      ]);
      const target = realpathOrResolve(targetPath);
      const worktrees = await this.listWorktrees();
      const info = worktrees.find(
        (worktree) => realpathOrResolve(toNativeAbsolutePath(worktree.worktreePath)) === target
      );
      if (!info) {
        return gitErr.commandFailed(`worktree added but not listed: ${targetPath}`);
      }
      return ok(info);
    } catch (error) {
      return commandFailed(error);
    }
  }

  async removeWorktree(
    worktreePath: HostAbsolutePath,
    force = false
  ): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() =>
      this.exec.exec([
        'worktree',
        'remove',
        ...(force ? ['--force'] : []),
        toNativeAbsolutePath(worktreePath),
      ])
    );
  }

  async pruneWorktrees(): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['worktree', 'prune']));
  }

  // -- Branches and tags ----------------------------------------------------------

  async createBranch(
    options: ExplicitCreateBranchOptions
  ): Promise<Result<void, CreateBranchError>> {
    const name = options.name;
    const from = options.from;

    if (options.syncWithRemote) {
      const remote = options.remote ?? 'origin';
      const fetchResult = await this.fetch(remote);
      if (!fetchResult.success) {
        return gitErr.fetchFailed(remote, from, fetchResult.error);
      }
    }

    const base = options.syncWithRemote ? `${options.remote ?? 'origin'}/${from}` : from;
    try {
      await this.exec.exec(['branch', '--no-track', '--', name, base]);
      await this.setBranchBaseConfig(name, base);
      return ok(undefined);
    } catch (error) {
      return repositoryFailures.createBranch(error, name, from);
    }
  }

  async deleteBranch(branch: string, force = false): Promise<Result<void, DeleteBranchError>> {
    try {
      await this.exec.exec(['branch', force ? '-D' : '-d', '--', branch]);
      return ok(undefined);
    } catch (error) {
      return repositoryFailures.deleteBranch(error, branch);
    }
  }

  async renameBranch(oldName: string, newName: string): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['branch', '-m', '--', oldName, newName]));
  }

  async setUpstream(
    branch: string,
    upstream: string | null
  ): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() =>
      this.exec.exec(
        upstream === null
          ? ['branch', '--unset-upstream', '--', branch]
          : ['branch', `--set-upstream-to=${upstream}`, '--', branch]
      )
    );
  }

  async createTag(options: ExplicitTagOptions): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() =>
      this.exec.exec([
        'tag',
        ...(options.force ? ['--force'] : []),
        ...(options.message !== undefined ? ['-a', '-m', options.message] : []),
        options.name,
        options.ref,
      ])
    );
  }

  async deleteTag(name: string): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['tag', '-d', name]));
  }

  // -- Remotes and network ----------------------------------------------------------

  async addRemote(name: string, url: string): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['remote', 'add', name, url]));
  }

  async removeRemote(name: string): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['remote', 'remove', name]));
  }

  async fetch(
    remote?: string,
    context: GitOperationContext = {}
  ): Promise<Result<void, FetchError>> {
    try {
      throwIfGitOpAborted(context.signal);
      await execGitWithProgress(
        this.exec,
        ['fetch', '--progress', ...(remote ? [remote] : [])],
        context
      );
      return ok(undefined);
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return repositoryFailures.fetch(error, remote);
    }
  }

  async publishBranch(
    branchName: string,
    remote = 'origin',
    context: GitOperationContext = {}
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
      return pushFailed(error);
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
    } catch (error) {
      if (!repositoryFailures.isMissingSymbolicRef(error)) throw error;
    }

    try {
      const { stdout } = await this.exec.exec(['remote', 'show', remote]);
      const match = /HEAD branch:\s*(\S+)/.exec(stdout);
      if (match?.[1] && match[1] !== '(unknown)') return match[1];
    } catch (error) {
      if (!repositoryFailures.isRemoteUnavailable(error)) throw error;
    }

    for (const candidate of ['main', 'master', 'develop', 'trunk']) {
      if (await this.branchExistsLocally(candidate)) return candidate;
    }

    return 'main';
  }

  async fetchPrForReview(
    options: FetchPrForReviewOptions,
    context: GitOperationContext = {}
  ): Promise<Result<void, FetchPrForReviewError>> {
    try {
      if (options.isFork) {
        const forkRemote = remoteNameForRepositoryUrl(options.headRepositoryUrl);
        const remotes = await this.exec.exec(['remote'], { signal: context.signal });
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
            if (!repositoryFailures.isMissingUpstream(error)) throw error;
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
          if (!repositoryFailures.isMissingUpstream(error)) throw error;
          return { stdout: '', stderr: '' };
        });
      return ok(undefined);
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return repositoryFailures.fetchPrForReview(error, options.prNumber);
    }
  }

  // -- Stashes ----------------------------------------------------------------------

  async stashDrop(stashIndex: number): Promise<Result<void, GitCommandError>> {
    try {
      await this.exec.exec(['stash', 'drop', `stash@{${stashIndex}}`]);
      return ok(undefined);
    } catch (error) {
      return commandFailed(error);
    }
  }

  // -- Internals ----------------------------------------------------------------------

  private async commandMutation(
    run: () => Promise<unknown>
  ): Promise<Result<void, GitCommandError>> {
    try {
      await run();
      return ok(undefined);
    } catch (error) {
      return commandFailed(error);
    }
  }

  private async readBlobOnce(spec: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec.exec(['cat-file', 'blob', spec]);
      return stdout;
    } catch (error) {
      if (repositoryFailures.isMissingBlob(error)) return null;
      throw error;
    }
  }

  private async branchExistsLocally(branch: string): Promise<boolean> {
    try {
      await this.exec.exec(['rev-parse', '--verify', `refs/heads/${branch}`]);
      return true;
    } catch (error) {
      if (!repositoryFailures.isMissingRef(error)) throw error;
      return false;
    }
  }

  private async setBranchBaseConfig(branchName: string, baseRef: string): Promise<void> {
    await this.exec.exec(['config', `branch.${branchName}.base`, baseRef]);
  }
}

function normalizeTreePath(filePath: PortableRelativePath): PortableRelativePath {
  const parsed = parsePortableRelativePath(filePath, { unicodeNormalization: 'preserve' });
  if (
    !parsed.success ||
    !parsed.data ||
    (process.platform === 'win32' && parsed.data.includes('\\'))
  ) {
    throw new Error(`Invalid repository file path: ${filePath}`);
  }
  return parsed.data;
}
