import type { GitRemotesModel, GitSequences, IGitRepository } from '@emdash/core/git';
import type { Unsubscribe } from '@emdash/core/lib';
import { err, ok, type Result } from '@emdash/shared';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type {
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  PushError,
} from '@shared/core/git/types';
import { resolveConfiguredRemotes } from '@shared/core/git/utils';
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

  subscribeRemotes(cb: (update: GitRemotesModel) => void): Unsubscribe {
    return this.gitRepository.subscribe((update) => {
      if (update.kind === 'remotes') {
        cb(update.model);
      }
    });
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

  async getDefaultBranch(): Promise<string> {
    return this.gitRepository.getDefaultBranch(await this.getBaseRemote());
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
