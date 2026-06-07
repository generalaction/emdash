import type { ProjectSettings } from '@shared/project-settings';
import { normalizeRepositoryHost, parseRepositoryRef } from '@shared/repository-ref';
import type { Result } from '@shared/result';
import type { GitHubAccount, GitHubAccountRegistry } from '../accounts/github-account-registry';

type AccountLookup = Pick<GitHubAccountRegistry, 'getDefaultAccountId' | 'listAccounts'>;

type ProjectSettingsForBackfill = {
  get(): Promise<ProjectSettings>;
  patch(patch: { githubAccountId?: string | null }): Promise<Result<void, unknown>>;
};

type ProjectForGitHubAccountBackfill = {
  projectId: string;
  settings: ProjectSettingsForBackfill;
  getRemoteState(): Promise<{
    hasRemote: boolean;
    selectedRemoteUrl?: string | null;
  }>;
};

export type ProjectGitHubAccountBackfillResult =
  | { status: 'updated'; accountId: string }
  | { status: 'skipped' };

export class ProjectGitHubAccountBackfillService {
  constructor(private readonly accountLookup: AccountLookup) {}

  async backfillProject(
    project: ProjectForGitHubAccountBackfill
  ): Promise<ProjectGitHubAccountBackfillResult> {
    const settings = await project.settings.get();
    if (Object.hasOwn(settings, 'githubAccountId')) return { status: 'skipped' };

    const remoteState = await project.getRemoteState();
    if (!remoteState.hasRemote || !remoteState.selectedRemoteUrl) return { status: 'skipped' };

    const repository = parseRepositoryRef(remoteState.selectedRemoteUrl);
    if (!repository) return { status: 'skipped' };

    const accountId = await this.selectAccountIdForHost(repository.host);
    if (!accountId) return { status: 'skipped' };

    const result = await project.settings.patch({ githubAccountId: accountId });
    return result.success ? { status: 'updated', accountId } : { status: 'skipped' };
  }

  private async selectAccountIdForHost(host: string): Promise<string | null> {
    const normalizedHost = normalizeRepositoryHost(host);
    const [accounts, defaultAccountId] = await Promise.all([
      this.accountLookup.listAccounts(),
      this.accountLookup.getDefaultAccountId(),
    ]);
    const hostAccounts = accounts.filter(
      (account) => normalizeRepositoryHost(account.host) === normalizedHost
    );
    if (hostAccounts.length === 0) return null;

    const defaultAccount = hostAccounts.find((account) => account.id === defaultAccountId);
    return defaultAccount?.id ?? this.oldestAccount(hostAccounts)?.id ?? null;
  }

  private oldestAccount(accounts: GitHubAccount[]): GitHubAccount | undefined {
    return accounts.reduce<GitHubAccount | undefined>((oldest, account) => {
      if (!oldest || account.connectedAt < oldest.connectedAt) return account;
      return oldest;
    }, undefined);
  }
}
