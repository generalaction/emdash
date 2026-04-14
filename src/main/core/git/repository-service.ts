import type {
  Branch,
  BranchesPayload,
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrRefError,
  LocalBranch,
  LocalBranchesPayload,
  PushError,
  RemoteBranch,
  RemoteBranchesPayload,
  RenameBranchError,
} from '@shared/git';
import { computeDefaultBranch, selectPreferredRemote } from '@shared/git-utils';
import type { Result } from '@shared/result';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/schema';
import type { RepositoryGitProvider } from './repository-git-provider';

export class GitRepositoryService {
  constructor(
    private readonly git: RepositoryGitProvider,
    private readonly settings: ProjectSettingsProvider
  ) {}

  async getConfiguredRemote(): Promise<string> {
    const [configured, remotes] = await Promise.all([
      this.settings.getRemote().catch(() => undefined),
      this.git.getRemotes().catch(() => []),
    ]);
    return selectPreferredRemote(configured, remotes);
  }

  async getDefaultBranchName(): Promise<string> {
    const configured = await this.settings.getDefaultBranch();
    const remote = await this.getConfiguredRemote();
    const branches = await this.git.getBranches();
    const gitDefault = await this.git.getDefaultBranch(remote);
    return computeDefaultBranch(configured, branches, remote, gitDefault);
  }

  async getRepositoryInfo(): Promise<{ isUnborn: boolean; currentBranch: string | null }> {
    const headState = await this.git.getHeadState();
    const currentBranch = headState.isUnborn
      ? (headState.headName ?? null)
      : await this.git.getCurrentBranch();
    return { isUnborn: headState.isUnborn, currentBranch };
  }

  async getBranchesPayload(): Promise<BranchesPayload> {
    const remotes = await this.git.getRemotes();
    const remote = await this.getConfiguredRemote();
    const branches = await this.git.getBranches();
    const gitDefaultBranch = await this.git.getDefaultBranch(remote);

    if (branches.length === 0) {
      const headState = await this.git.getHeadState();
      return {
        branches: [],
        currentBranch: headState.headName ?? null,
        isUnborn: headState.isUnborn,
        gitDefaultBranch,
        remotes,
      };
    }
    const currentBranch = await this.git.getCurrentBranch();
    return {
      branches,
      currentBranch,
      isUnborn: false,
      gitDefaultBranch,
      remotes,
    };
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    return this.git.getRemotes();
  }

  async addRemote(name: string, url: string): Promise<void> {
    return this.git.addRemote(name, url);
  }

  async createBranch(
    name: string,
    from: string,
    syncWithRemote?: boolean,
    remote?: string
  ): Promise<Result<void, CreateBranchError>> {
    return this.git.createBranch(name, from, syncWithRemote, remote);
  }

  async renameBranch(
    oldBranch: string,
    newBranch: string
  ): Promise<Result<{ remotePushed: boolean }, RenameBranchError>> {
    return this.git.renameBranch(oldBranch, newBranch);
  }

  async deleteBranch(branch: string, force?: boolean): Promise<Result<void, DeleteBranchError>> {
    return this.git.deleteBranch(branch, force);
  }

  async fetchPrRef(
    prNumber: number,
    localBranchName: string,
    remote?: string
  ): Promise<Result<void, FetchPrRefError>> {
    return this.git.fetchPrRef(prNumber, localBranchName, remote);
  }

  async fetch(remote?: string): Promise<Result<void, FetchError>> {
    return this.git.fetch(remote);
  }

  async publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string }, PushError>> {
    return this.git.publishBranch(branchName, remote);
  }

  async getBranches(): Promise<Branch[]> {
    return this.git.getBranches();
  }

  async getLocalBranchesPayload(): Promise<LocalBranchesPayload> {
    const branches = await this.git.getBranches();
    const localBranches = branches.filter((b): b is LocalBranch => b.type === 'local');
    if (localBranches.length === 0) {
      const headState = await this.git.getHeadState();
      return {
        localBranches: [],
        currentBranch: headState.headName ?? null,
        isUnborn: headState.isUnborn,
      };
    }
    const currentBranch = await this.git.getCurrentBranch();
    return { localBranches, currentBranch, isUnborn: false };
  }

  async getRemoteBranchesPayload(): Promise<RemoteBranchesPayload> {
    const [branches, remotes, remote] = await Promise.all([
      this.git.getBranches(),
      this.git.getRemotes(),
      this.getConfiguredRemote(),
    ]);
    const remoteBranches = branches.filter((b): b is RemoteBranch => b.type === 'remote');
    const gitDefaultBranch = await this.git.getDefaultBranch(remote);
    return { remoteBranches, remotes, gitDefaultBranch };
  }
}
