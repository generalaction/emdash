import type { Result } from '@emdash/shared';
import { resolveAccountForHost, type ProjectSettings } from '@core/primitives/project-settings/api';
import { parseRepositoryRef } from '@core/primitives/repository/api';
import { listGitHubAccountSummaries, type GitHubAccountStore } from '../accounts/github-accounts';

type AccountLookup = Pick<GitHubAccountStore, 'getDefaultAccountId' | 'listAccounts'>;

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
    // The single blessed "default account for host" inference (spec:
    // github-git-settings §2/§11) — no local oldest-account tiebreaks.
    const accounts = await listGitHubAccountSummaries(this.accountLookup);
    return resolveAccountForHost(host, accounts).value?.accountId ?? null;
  }
}
