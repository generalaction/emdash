import { ok, type Result } from '@emdash/shared/result';
import { createController, type Controller } from '@emdash/wire/api';
import { normalizeRepositoryHost } from '@core/primitives/repository/api';
import {
  githubAuthContract,
  type GitHubAuthError,
} from '@root/src/core/services/pull-requests/api';

type GitHubTokenService = {
  getToken(
    host: string,
    context?: { accountId?: string }
  ): Promise<Result<string, GitHubAuthError>>;
};

export function createPullRequestsGitHubAuthController(
  tokenService: GitHubTokenService,
  apiBaseUrlForHost: (host: string) => string
): Controller {
  return createController(githubAuthContract, {
    resolveAuth: async (input) => {
      const host = normalizeRepositoryHost(input.host);
      const token = await tokenService.getToken(host, { accountId: input.accountId });
      if (!token.success) return { success: false, error: token.error };
      return ok({
        token: token.data,
        host,
        apiBaseUrl: apiBaseUrlForHost(host),
      });
    },
  });
}
