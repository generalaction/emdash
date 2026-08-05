import {
  GITHUB_PROVIDER_ID,
  toGitHubAccount,
} from '@main/core/github/accounts/github-accounts';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import type { GitHubGitAuth } from '@main/core/execution-context/github-auth-execution-context';
import { githubApiAuthService } from './github-api-auth-service-instance';
import { resolveProjectGitHubAuthContext } from './project-github-auth-context';

/**
 * Resolve the GitHub credential to use for git transport for a project, based
 * on the account linked to that project.
 *
 * Returns null when there is no usable linked account — unconfigured, disabled
 * (`githubAccountId: null`), an unknown account id, or a missing token — in
 * which case the caller falls back to the ambient git credential helper,
 * preserving the previous behavior.
 *
 * The account's own host is used (not the git remote's), so the returned
 * `host`-scoped credential only takes effect for requests to the linked
 * account's host; if the remote is on a different host or uses SSH, the
 * credential simply does not apply.
 */
export async function resolveProjectGitHubGitAuth(
  projectId: string
): Promise<GitHubGitAuth | null> {
  const authContext = await resolveProjectGitHubAuthContext(projectId);
  if (!authContext.success) return null;

  const { accountId } = authContext.data;
  const accounts = (await providerAccountRegistry.listAccounts(GITHUB_PROVIDER_ID)).map(
    toGitHubAccount
  );

  let account = accountId ? accounts.find((candidate) => candidate.id === accountId) : undefined;
  if (!account && !accountId) {
    const defaultAccountId = await providerAccountRegistry.getDefaultAccountId(GITHUB_PROVIDER_ID);
    account = defaultAccountId
      ? accounts.find((candidate) => candidate.id === defaultAccountId)
      : undefined;
  }
  if (!account) return null;

  const token = await githubApiAuthService.getToken(account.host, { accountId: account.id });
  if (!token.success) return null;

  return { host: account.host, token: token.data };
}
