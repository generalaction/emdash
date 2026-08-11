import { ok, type Result } from '@emdash/shared';
import {
  type FetchError,
  type FetchPrForReviewError,
  type FetchPrForReviewOptions,
  type GitCommandError,
  type GitRefsState,
  type GitRemotesState,
  type GitWorktreesState,
  type PushError,
} from '#runtimes/git/api';
import type { RepositoryIdentity } from '#runtimes/git/node/allocation/identity';
import { toHostAbsolutePath } from '#runtimes/git/node/allocation/paths';
import { commandFailed, pushFailed } from '#runtimes/git/node/exec/errors';
import type { GitOperationContext } from '#runtimes/git/node/exec/operation-context';
import {
  execGitWithProgress,
  throwIfGitOpAborted,
} from '#runtimes/git/node/exec/transfer-progress';
import { computeRefsState } from '#runtimes/git/node/repository/ops/refs';
import {
  computeRemotesState,
  remoteNameForRepositoryUrl,
} from '#runtimes/git/node/repository/ops/remotes';
import { parseWorktreeList } from '#runtimes/git/node/repository/ops/worktrees';
import { type BoundExec } from '#services/exec/api';
import { repositoryFailures } from './errors';

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

  // -- Checkouts (worktrees) ------------------------------------------------------

  async listWorktrees(): Promise<GitWorktreesState> {
    const { stdout } = await this.exec.exec(['worktree', 'list', '--porcelain']);
    return parseWorktreeList(stdout, toHostAbsolutePath);
  }

  // -- Remotes and network ----------------------------------------------------------

  async addRemote(name: string, url: string): Promise<Result<void, GitCommandError>> {
    return this.commandMutation(() => this.exec.exec(['remote', 'add', name, url]));
  }

  async fetch(
    remote?: string,
    context: GitOperationContext = {},
    options: { refspec?: string; force?: boolean } = {}
  ): Promise<Result<void, FetchError>> {
    try {
      throwIfGitOpAborted(context.signal);
      await execGitWithProgress(
        this.exec,
        [
          'fetch',
          '--progress',
          ...(options.force ? ['--force'] : []),
          ...(remote ? [remote] : []),
          ...(options.refspec ? [options.refspec] : []),
        ],
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

      const remote = options.configuredRemote;
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

  private async branchExistsLocally(branch: string): Promise<boolean> {
    try {
      await this.exec.exec(['rev-parse', '--verify', `refs/heads/${branch}`]);
      return true;
    } catch (error) {
      if (!repositoryFailures.isMissingRef(error)) throw error;
      return false;
    }
  }
}
