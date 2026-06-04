import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import { normalizeRepositoryHost } from '@shared/repository-ref';
import type { GitHubAccount } from './github-account-registry';
import { githubAccountRegistry } from './github-account-registry-instance';

const GITHUB_ACCOUNT_CONFIG_KEYS = ['emdash.githubAccountId', 'emdash.ghaccount'] as const;

export type GitHubAccountLookup = {
  listAccounts(): Promise<GitHubAccount[]>;
};

export type GitHubAccountSelectionProject = {
  settings: Pick<ProjectSettingsProvider, 'get'>;
  ctx: Pick<IExecutionContext, 'exec'>;
};

export type GitHubAccountSelection = {
  accountId: string | null;
  source: 'project-settings' | 'git-config' | 'none';
};

export class GitHubAccountSelectionResolver {
  constructor(private readonly accountLookup: GitHubAccountLookup = githubAccountRegistry) {}

  async resolve(project: GitHubAccountSelectionProject): Promise<GitHubAccountSelection> {
    const settings = await project.settings.get();
    if (Object.hasOwn(settings, 'githubAccountId')) {
      return {
        accountId: settings.githubAccountId?.trim() || null,
        source: 'project-settings',
      };
    }

    const configured = await this.readGitConfig(project.ctx);
    if (!configured) return { accountId: null, source: 'none' };

    return {
      accountId: await this.resolveConfiguredAccountId(configured),
      source: 'git-config',
    };
  }

  private async readGitConfig(ctx: Pick<IExecutionContext, 'exec'>): Promise<string | null> {
    for (const key of GITHUB_ACCOUNT_CONFIG_KEYS) {
      const value = await this.readGitConfigKey(ctx, key);
      if (value) return value;
    }
    return null;
  }

  private async readGitConfigKey(
    ctx: Pick<IExecutionContext, 'exec'>,
    key: string
  ): Promise<string | null> {
    try {
      const result = await ctx.exec('git', ['config', '--get', key], { timeout: 5_000 });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async resolveConfiguredAccountId(configured: string): Promise<string> {
    const normalized = configured.trim();
    const normalizedLower = normalized.toLowerCase();
    const accounts = await this.accountLookup.listAccounts();
    const match = accounts.find((account) => {
      const host = normalizeRepositoryHost(account.host);
      return (
        account.id === normalized ||
        account.login.toLowerCase() === normalizedLower ||
        `${host}:${account.login}`.toLowerCase() === normalizedLower
      );
    });

    return match?.id ?? normalized;
  }
}

export const githubAccountSelectionResolver = new GitHubAccountSelectionResolver();
