import type {
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  GitCommandError,
  GitRemotesState,
  PushError,
} from '@emdash/core/git';
import type { Unsubscribe } from '@emdash/shared';
import type { Result } from '@emdash/shared/result';
import { gitErrorMessage, type RuntimeGitRepository } from '@main/core/git/runtime-git';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import { resolveConfiguredRemotes } from '@shared/core/git/utils';
import type { ProjectRemoteState } from '@shared/projects';

export class GitRepositoryService {
  constructor(
    private readonly gitRepository: RuntimeGitRepository,
    private readonly settings: ProjectSettingsProvider
  ) {}

  getSnapshot() {
    return this.gitRepository.getSnapshot();
  }

  subscribeRemotes(cb: (update: GitRemotesState) => void): Unsubscribe {
    return this.gitRepository.subscribeRemotes(cb);
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
    const result = await this.gitRepository.getDefaultBranch(await this.getBaseRemote());
    if (!result.success) throw new Error(gitErrorMessage(result.error));
    return result.data;
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    return (await this.gitRepository.getRemotes()).remotes;
  }

  async addRemote(name: string, url: string): Promise<Result<void, GitCommandError>> {
    return this.gitRepository.addRemote(name, url);
  }

  async createBranch(
    name: string,
    from: string,
    syncWithRemote?: boolean,
    remote?: string
  ): Promise<Result<void, CreateBranchError>> {
    return this.gitRepository.createBranch({ name, from, syncWithRemote, remote });
  }

  async deleteBranch(branch: string, force?: boolean): Promise<Result<void, DeleteBranchError>> {
    return this.gitRepository.deleteBranch(branch, force);
  }

  async fetchPrForReview(
    prNumber: number,
    headRefName: string,
    headRepositoryUrl: string,
    localBranch: string,
    isFork: boolean,
    remote?: string
  ): Promise<Result<void, FetchPrForReviewError>> {
    return this.gitRepository.fetchPrForReview({
      prNumber,
      headRefName,
      headRepositoryUrl,
      localBranch,
      isFork,
      configuredRemote: remote,
    });
  }

  async fetch(remote?: string): Promise<Result<void, FetchError>> {
    return this.gitRepository.fetch(remote);
  }

  async publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string }, PushError>> {
    return this.gitRepository.publishBranch(branchName, remote);
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
