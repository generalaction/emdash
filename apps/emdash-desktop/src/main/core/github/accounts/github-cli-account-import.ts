import type { IExecutionContext } from '@main/core/execution-context/types';
import type { GitHubUser } from '@shared/github';
import { normalizeRepositoryHost } from '@shared/repository-ref';
import type { GitHubAccount, GitHubAccountRegistry } from './github-account-registry';

export type GitHubCliAccountImportOptions = {
  skipRemovedAccounts?: boolean;
};

type GitHubIdentityClient = {
  getAuthenticatedUser(token: string, host?: string): Promise<GitHubUser | null>;
};

type GitHubCliAuthStatusEntry = {
  state?: unknown;
  host?: unknown;
  login?: unknown;
  token?: unknown;
};

type GitHubCliAuthStatus = {
  hosts?: unknown;
};

const GITHUB_CLI_AUTH_STATUS_TIMEOUT_MS = 5_000;

function parseCliStatus(raw: string): GitHubCliAuthStatus {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function cliEntries(status: GitHubCliAuthStatus): GitHubCliAuthStatusEntry[] {
  if (typeof status.hosts !== 'object' || status.hosts === null) return [];
  const entries: GitHubCliAuthStatusEntry[] = [];
  for (const [host, rawHostEntries] of Object.entries(status.hosts)) {
    if (!Array.isArray(rawHostEntries)) continue;
    for (const rawEntry of rawHostEntries) {
      if (typeof rawEntry !== 'object' || rawEntry === null) continue;
      entries.push({ ...(rawEntry as GitHubCliAuthStatusEntry), host });
    }
  }
  return entries;
}

export class GitHubCliAccountImportService {
  constructor(
    private readonly accountRegistry: GitHubAccountRegistry,
    private readonly ctx: Pick<IExecutionContext, 'exec'>,
    private readonly identityClient: GitHubIdentityClient
  ) {}

  async importAccounts(options: GitHubCliAccountImportOptions = {}): Promise<GitHubAccount[]> {
    const stdout = await this.readCliStatus();
    if (!stdout) return [];

    const removedAccountIds = options.skipRemovedAccounts
      ? new Set(
          (await this.accountRegistry.listRemovedCliAccounts()).map((account) => account.accountId)
        )
      : new Set<string>();
    const imported: GitHubAccount[] = [];
    for (const entry of cliEntries(parseCliStatus(stdout))) {
      if (entry.state !== 'success') continue;
      if (typeof entry.token !== 'string' || entry.token.trim().length === 0) continue;
      const host = typeof entry.host === 'string' ? normalizeRepositoryHost(entry.host) : '';
      if (!host) continue;

      const token = entry.token.trim();
      const user = await this.identityClient.getAuthenticatedUser(token, host);
      if (!user) continue;
      const accountId = `${host}:${String(user.id)}`;
      if (removedAccountIds.has(accountId)) continue;

      const { account } = await this.accountRegistry.upsertAccount({
        accessToken: token,
        credentialSource: 'cli',
        providerAccount: {
          providerId: 'github',
          providerAccountId: String(user.id),
          host,
          login: user.login,
          avatarUrl: user.avatar_url,
        },
      });
      imported.push(account);
    }
    return imported;
  }

  private async readCliStatus(): Promise<string | null> {
    try {
      const { stdout } = await this.ctx.exec(
        'gh',
        ['auth', 'status', '--json', 'hosts', '--show-token'],
        {
          timeout: GITHUB_CLI_AUTH_STATUS_TIMEOUT_MS,
        }
      );
      return stdout;
    } catch {
      return null;
    }
  }
}
