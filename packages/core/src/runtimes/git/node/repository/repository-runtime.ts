import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { type LiveJobContext } from '@emdash/wire/live';
import { type LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { expose, type Query } from '@emdash/wire/state';
import type { PortableRelativePath } from '#primitives/path/api';
import {
  gitContract,
  type gitRepositoryContract,
  type FetchJobInput,
  type FetchPrForReviewJobInput,
  type GitCommandError,
  type GitRefsState,
  type GitRemotesState,
  type GitStashesState,
  type GitTransferProgress,
  type GitWorktreesState,
  type PublishBranchJobInput,
  type RepositorySelector,
} from '#runtimes/git/api';
import type { GitAllocationGraph } from '#runtimes/git/node/allocation/allocation-graph';
import { expectedGitCommandError } from '#runtimes/git/node/api/errors';
import type { RepositoryResource } from './repository-resource';

type RepositoryModel = typeof gitRepositoryContract.model;
type RepositoryStateName = 'refs' | 'remotes' | 'stashes' | 'worktrees';

export class GitRepositoryRuntime {
  readonly model: LeasedLiveModelProvider<RepositoryModel>;

  private readonly modelHosts = new Map<string, LeasedLiveModelProvider<RepositoryModel>>();

  constructor(private readonly allocations: GitAllocationGraph) {
    this.model = this.modelHost(gitContract.repository.model);
  }

  modelHost(contract: RepositoryModel = gitContract.repository.model) {
    const existing = this.modelHosts.get(contract.id);
    if (existing) return existing;
    const host = expose(
      contract,
      {
        refs: (key, scope) => this.repositoryState<GitRefsState>(key, 'refs', scope),
        remotes: (key, scope) => this.repositoryState<GitRemotesState>(key, 'remotes', scope),
        stashes: (key, scope) => this.repositoryState<GitStashesState>(key, 'stashes', scope),
        worktrees: (key, scope) => this.repositoryState<GitWorktreesState>(key, 'worktrees', scope),
      },
      {
        mutations: {
          createBranch: (context) =>
            this.run(context.key, (resource) => resource.createBranch(context)),
          deleteBranch: (context) =>
            this.run(context.key, (resource) => resource.deleteBranch(context)),
          renameBranch: (context) =>
            this.run(context.key, (resource) => resource.renameBranch(context)),
          setUpstream: (context) =>
            this.run(context.key, (resource) => resource.setUpstream(context)),
          setBranchBase: (context) =>
            this.run(context.key, (resource) => resource.setBranchBase(context)),
          createTag: (context) => this.run(context.key, (resource) => resource.createTag(context)),
          deleteTag: (context) => this.run(context.key, (resource) => resource.deleteTag(context)),
          addRemote: (context) => this.run(context.key, (resource) => resource.addRemote(context)),
          setRemoteUrl: (context) =>
            this.run(context.key, (resource) => resource.setRemoteUrl(context)),
          removeRemote: (context) =>
            this.run(context.key, (resource) => resource.removeRemote(context)),
          stashDrop: (context) => this.run(context.key, (resource) => resource.stashDrop(context)),
          addWorktree: (context) =>
            this.run(context.key, (resource) => resource.addWorktree(context)),
          removeWorktree: (context) =>
            this.run(context.key, (resource) => resource.removeWorktree(context)),
          moveWorktree: (context) =>
            this.run(context.key, (resource) => resource.moveWorktree(context)),
          pruneWorktrees: (context) =>
            this.run(context.key, (resource) => resource.pruneWorktrees(context)),
        },
      }
    );
    this.modelHosts.set(contract.id, host);
    return host;
  }

  listWorktrees(input: RepositorySelector) {
    return this.read(input, (repository) => repository.listWorktrees());
  }

  getDefaultBranch(input: RepositorySelector & { remote?: string }) {
    return this.read(input, (repository) => repository.getDefaultBranch(input.remote));
  }

  getBranchBase(input: RepositorySelector & { branch: string }) {
    return this.read(input, (repository) => repository.getBranchBase(input.branch));
  }

  readBlobAtRef(input: RepositorySelector & { ref: string; filePath: PortableRelativePath }) {
    return this.read(input, (repository) => repository.readBlobAtRef(input.ref, input.filePath));
  }

  fetch(input: FetchJobInput, context: LiveJobContext<GitTransferProgress>) {
    return this.run(input, (repository) =>
      repository.fetch(
        input.remote,
        {
          signal: context.signal,
          onProgress: context.progress,
        },
        {
          refspec: input.refspec,
          force: input.force,
        }
      )
    );
  }

  publishBranch(input: PublishBranchJobInput, context: LiveJobContext<GitTransferProgress>) {
    return this.run(input, (repository) =>
      repository.publishBranch(input.branchName, input.remote, {
        signal: context.signal,
        onProgress: context.progress,
      })
    );
  }

  fetchPrForReview(input: FetchPrForReviewJobInput, context: LiveJobContext<GitTransferProgress>) {
    return this.run(input, (repository) =>
      repository.fetchPrForReview(input.options, {
        signal: context.signal,
        onProgress: context.progress,
      })
    );
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.modelHosts.values()].map((host) => host.dispose()));
    this.modelHosts.clear();
  }

  private read<T>(
    selector: RepositorySelector,
    read: (resource: RepositoryResource) => Promise<T>
  ) {
    return this.run(
      selector,
      async (resource): Promise<Result<T, never>> => ok(await read(resource))
    );
  }

  private async repositoryState<T>(
    selector: RepositorySelector,
    name: RepositoryStateName,
    scope: Scope
  ): Promise<Query<T>> {
    const lease = this.allocations.acquireRepository(selector);
    scope.add(() => lease.release());
    const repository = await lease.ready();
    switch (name) {
      case 'refs':
        return repository.state('refs') as unknown as Query<T>;
      case 'remotes':
        return repository.state('remotes') as unknown as Query<T>;
      case 'stashes':
        return repository.state('stashes') as unknown as Query<T>;
      case 'worktrees':
        return repository.state('worktrees') as unknown as Query<T>;
    }
  }

  private async run<T, E>(
    selector: RepositorySelector,
    run: (resource: RepositoryResource) => Promise<Result<T, E>>
  ): Promise<Result<T, E | GitCommandError>> {
    try {
      return await this.allocations.useRepository(selector, run);
    } catch (error) {
      const expected = expectedGitCommandError(error);
      if (expected) return err(expected);
      throw error;
    }
  }
}
