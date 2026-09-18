import { gitHubCredentialsSchema } from '@emdash/plugins/integrations/github';
import { githubApiBaseUrlForHost } from '@core/features/github/api/node/services/github-api-base-url';
import type { ProviderAccountStore } from '@core/services/provider-accounts/api/provider-account-store';

/** Run before exposing account services, while no connections can be changed concurrently. */
export async function migrateGitHubJsonCredentials(accounts: ProviderAccountStore): Promise<void> {
  for (const account of await accounts.listAccounts('github')) {
    const raw = await accounts.resolveSecret('github', account.accountId);
    if (!raw) continue;
    // JSON payloads (including malformed ones) are never reinterpreted as tokens.
    // A failed secret write leaves the old value available for the next startup.
    const token = raw.trim();
    if (!token || ['[', '{', '"'].some((prefix) => token.startsWith(prefix))) continue;
    try {
      JSON.parse(token);
      continue;
    } catch {
      /* Legacy raw token, not JSON. */
    }
    const credentials = gitHubCredentialsSchema.safeParse({
      accessToken: token,
      apiBaseUrl: githubApiBaseUrlForHost(account.meta?.host ?? 'github.com'),
    });
    if (!credentials.success) continue;
    await accounts.upsertAccount({
      providerId: 'github',
      accountId: account.accountId,
      secret: JSON.stringify(credentials.data),
    });
  }
}
