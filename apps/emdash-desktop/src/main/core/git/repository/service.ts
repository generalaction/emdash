import type {
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  GitCommandError,
  GitRemotesModel,
  GitSequences,
  IGitRepository,
  PushError,
} from '@emdash/core/git';
import type { Unsubscribe } from '@emdash/shared';
import { Result } from '@emdash/shared/result';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import { resolveConfiguredRemotes } from '@shared/core/git/utils';
import type { ProjectRemoteState } from '@shared/projects';

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

  async getDefaultBranch(baseRemote?: string): Promise<string> {
    // Callers that already resolved the base remote can pass it to avoid a
    // redundant settings + `git remote` round trip.
    return this.gitRepository.getDefaultBranch(baseRemote ?? (await this.getBaseRemote()));
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    return (await this.gitRepository.getRemotes()).remotes;
  }

  async addRemote(
    name: string,
    url: string
  ): Promise<Result<{ sequences: GitSequences }, GitCommandError>> {
    return this.gitRepository.addRemote(name, url);
  }

  async createBranch(
    name: string,
    from: string,
    syncWithRemote?: boolean,
    remote?: string
  ): Promise<Result<void, CreateBranchError>> {
    return Result.fromAsync(
      this.gitRepository.createBranch({ name, from, syncWithRemote, remote })
    ).map(() => undefined);
  }

  async deleteBranch(branch: string, force?: boolean): Promise<Result<void, DeleteBranchError>> {
    return Result.fromAsync(this.gitRepository.deleteBranch(branch, force)).map(() => undefined);
  }

  async fetchPrForReview(
    prNumber: number,
    headRefName: string,
    headRepositoryUrl: string,
    localBranch: string,
    isFork: boolean,
    remote?: string
  ): Promise<Result<void, FetchPrForReviewError>> {
    return Result.fromAsync(
      this.gitRepository.fetchPrForReview({
        prNumber,
        headRefName,
        headRepositoryUrl,
        localBranch,
        isFork,
        configuredRemote: remote,
      })
    ).map(() => undefined);
  }

  async fetch(remote?: string): Promise<Result<{ sequences: GitSequences }, FetchError>> {
    return this.gitRepository.fetch(remote);
  }

  async publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string }, PushError>> {
    return Result.fromAsync(this.gitRepository.publishBranch(branchName, remote)).map((d) => ({
      output: d.output,
    }));
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
