import {
  gitContract,
  type gitRepositoryContract,
  type FetchJobInput,
  type FetchPrForReviewJobInput,
  type GitCommandError,
  type GitTransferProgress,
  type PublishBranchJobInput,
  type RepositorySelector,
} from '@emdash/core/git';
import type { PortableRelativePath } from '@emdash/core/path';
import { err, ok, type Result } from '@emdash/shared';
import {
  createResourceLiveModelHost,
  type LiveJobContext,
  type ResourceLiveModelHost,
} from '@emdash/wire';
import type { GitAllocationGraph } from '../allocation/allocation-graph';
import { expectedGitCommandError } from '../api/errors';
import type { RepositoryResource } from './repository-resource';

type RepositoryModel = typeof gitRepositoryContract.model;

export class GitRepositoryRuntime {
  readonly model: ResourceLiveModelHost<RepositoryModel>;

  private readonly modelHosts = new Map<string, ResourceLiveModelHost<RepositoryModel>>();

  constructor(private readonly allocations: GitAllocationGraph) {
    this.model = this.modelHost(gitContract.repository.model);
  }

  modelHost(contract: RepositoryModel = gitContract.repository.model) {
    const existing = this.modelHosts.get(contract.id);
    if (existing) return existing;
    const host = createResourceLiveModelHost(contract, {
      acquire: (key) => this.allocations.acquireRepository(key),
      states: {
        refs: ({ resource }) => resource.state('refs'),
        remotes: ({ resource }) => resource.state('remotes'),
        stashes: ({ resource }) => resource.state('stashes'),
        worktrees: ({ resource }) => resource.state('worktrees'),
      },
      mutations: {
        createBranch: (context) => context.resource.createBranch(context),
        deleteBranch: (context) => context.resource.deleteBranch(context),
        renameBranch: (context) => context.resource.renameBranch(context),
        setUpstream: (context) => context.resource.setUpstream(context),
        createTag: (context) => context.resource.createTag(context),
        deleteTag: (context) => context.resource.deleteTag(context),
        addRemote: (context) => context.resource.addRemote(context),
        removeRemote: (context) => context.resource.removeRemote(context),
        stashDrop: (context) => context.resource.stashDrop(context),
        addWorktree: (context) => context.resource.addWorktree(context),
        removeWorktree: (context) => context.resource.removeWorktree(context),
        pruneWorktrees: (context) => context.resource.pruneWorktrees(context),
      },
      toMutationError: (_name, error) => expectedGitCommandError(error),
    });
    this.modelHosts.set(contract.id, host);
    return host;
  }

  listWorktrees(input: RepositorySelector) {
    return this.read(input, (repository) => repository.listWorktrees());
  }

  getDefaultBranch(input: RepositorySelector & { remote?: string }) {
    return this.read(input, (repository) => repository.getDefaultBranch(input.remote));
  }

  readBlobAtRef(input: RepositorySelector & { ref: string; filePath: PortableRelativePath }) {
    return this.read(input, (repository) => repository.readBlobAtRef(input.ref, input.filePath));
  }

  fetch(input: FetchJobInput, context: LiveJobContext<GitTransferProgress>) {
    return this.run(input, (repository) =>
      repository.fetch(input.remote, {
        signal: context.signal,
        onProgress: context.progress,
      })
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
