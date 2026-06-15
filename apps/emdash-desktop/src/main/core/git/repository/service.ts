import type { GitSequences, IGitRepository } from '@emdash/shared/git';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type {
  BranchesPayload,
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  LocalBranch,
  LocalBranchesPayload,
  PushError,
  RemoteBranch,
  RemoteBranchesPayload,
  RenameBranchError,
} from '@shared/core/git/git';
import { resolveConfiguredRemotes } from '@shared/core/git/git-utils';
import { err, ok, type Result } from '@shared/lib/result';
import type { ProjectRemoteState } from '@shared/projects';
import {
  mapCreateBranchError,
  mapDeleteBranchError,
  mapFetchError,
  mapFetchPrForReviewError,
  mapPushError,
} from './error-mappers';

export class GitRepositoryService {
  constructor(
    private readonly gitRepository: IGitRepository,
    private readonly settings: ProjectSettingsProvider
  ) {}

  getSnapshot() {
    return this.gitRepository.getSnapshot();
  }

  async getConfiguredRemotes(): Promise<{ baseRemote: string; pushRemote: string }> {
    const [settings, remotes] = await Promise.all([
      this.settings.get().catch(() => undefined),
      this.gitRepository.getRemotes().catch(() => ({ remotes: [] })),
    ]);
    const configured = resolveConfiguredRemotes(settings, remotes.remotes);
    return {
      baseRemote: configured.baseRemote.name,
      pushRemote: configured.pushRemote.name,
    };
  }

  async getBaseRemote(): Promise<string> {
    return (await this.getConfiguredRemotes()).baseRemote;
  }

  async getPushRemote(): Promise<string> {
    return (await this.getConfiguredRemotes()).pushRemote;
  }

  async getBranchesPayload(): Promise<BranchesPayload> {
    const [refs, remotesModel, remote] = await Promise.all([
      this.gitRepository.getRefs(),
      this.gitRepository.getRemotes(),
      this.getBaseRemote(),
    ]);
    const gitDefaultBranch = await this.gitRepository.getDefaultBranch(remote);
    return {
      branches: refs.branches,
      currentBranch: null,
      isUnborn: false,
      gitDefaultBranch,
      remotes: remotesModel.remotes,
    };
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    return (await this.gitRepository.getRemotes()).remotes;
  }

  async addRemote(name: string, url: string): Promise<void> {
    const result = await this.gitRepository.addRemote(name, url);
    if (!result.success) throw new Error(result.error.message);
  }

  async createBranch(
    name: string,
    from: string,
    syncWithRemote?: boolean,
    remote?: string
  ): Promise<Result<void, CreateBranchError>> {
    const result = await this.gitRepository.createBranch({ name, from, syncWithRemote, remote });
    if (!result.success) return err(mapCreateBranchError(result.error));
    return ok();
  }

  async renameBranch(
    _oldBranch: string,
    newBranch: string
  ): Promise<Result<void, RenameBranchError>> {
    return err({ type: 'error', message: `Branch rename is not implemented for ${newBranch}` });
  }

  async deleteBranch(branch: string, force?: boolean): Promise<Result<void, DeleteBranchError>> {
    const result = await this.gitRepository.deleteBranch(branch, force);
    if (!result.success) return err(mapDeleteBranchError(result.error));
    return ok();
  }

  async fetchPrForReview(
    prNumber: number,
    headRefName: string,
    headRepositoryUrl: string,
    localBranch: string,
    isFork: boolean,
    remote?: string
  ): Promise<Result<void, FetchPrForReviewError>> {
    const result = await this.gitRepository.fetchPrForReview({
      prNumber,
      headRefName,
      headRepositoryUrl,
      localBranch,
      isFork,
      configuredRemote: remote,
    });
    if (!result.success) return err(mapFetchPrForReviewError(result.error));
    return ok();
  }

  async fetch(remote?: string): Promise<Result<{ sequences: GitSequences }, FetchError>> {
    const result = await this.gitRepository.fetch(remote);
    if (!result.success) return err(mapFetchError(result.error));
    return ok({ sequences: result.data.sequences });
  }

  async publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string }, PushError>> {
    const result = await this.gitRepository.publishBranch(branchName, remote);
    if (!result.success) return err(mapPushError(result.error));
    return ok({ output: result.data.output });
  }

  async getBranches(): Promise<(LocalBranch | RemoteBranch)[]> {
    await this.fetch(await this.getBaseRemote());
    return (await this.gitRepository.getRefs()).branches;
  }

  async getLocalBranchesPayload(): Promise<LocalBranchesPayload> {
    const refs = await this.gitRepository.getRefs();
    const localBranches = refs.branches.filter((b): b is LocalBranch => b.type === 'local');
    return {
      localBranches,
      currentBranch: null,
      isUnborn: false,
    };
  }

  async getRemoteBranchesPayload(): Promise<RemoteBranchesPayload> {
    const [refs, remotesModel, remote] = await Promise.all([
      this.gitRepository.getRefs(),
      this.gitRepository.getRemotes(),
      this.getBaseRemote(),
    ]);
    const remoteBranches = refs.branches.filter((b): b is RemoteBranch => b.type === 'remote');
    const gitDefaultBranch = await this.gitRepository.getDefaultBranch(remote);
    return { remoteBranches, remotes: remotesModel.remotes, gitDefaultBranch };
  }

  async getRemoteState(): Promise<ProjectRemoteState> {
    try {
      const remotes = await this.getRemotes();
      const remoteName = await this.getBaseRemote();
      const remoteUrl = remotes.find((r) => r.name === remoteName)?.url;
      return { hasRemote: remotes.length > 0, selectedRemoteUrl: remoteUrl ?? null };
    } catch {
      return { hasRemote: false, selectedRemoteUrl: null };
    }
  }
}
