import { ok } from '@emdash/shared/result';
import { createController, type Controller } from '@emdash/wire/api';
import { githubApiAuthService } from '@main/core/github/services/github-api-auth-service-instance';
import { githubApiBaseUrlForHost } from '@main/core/github/services/github-api-base-url';
import { githubAuthContract } from '@root/src/core/services/pull-requests/api';
import { normalizeRepositoryHost } from '@shared/repository-ref';

type GitHubTokenService = Pick<typeof githubApiAuthService, 'getToken'>;

export function createPullRequestsGitHubAuthController(
  tokenService: GitHubTokenService = githubApiAuthService
): Controller {
  return createController(githubAuthContract, {
    resolveAuth: async (input) => {
      const host = normalizeRepositoryHost(input.host);
      const token = await tokenService.getToken(host, { accountId: input.accountId });
      if (!token.success) return { success: false, error: token.error };
      return ok({
        token: token.data,
        host,
        apiBaseUrl: githubApiBaseUrlForHost(host),
      });
    },
  });
}

export const pullRequestsGitHubAuthController = createPullRequestsGitHubAuthController();
