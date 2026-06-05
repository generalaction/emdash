import { githubAccountRegistry } from './github-account-registry-instance';
import { GitHubApiAuthService } from './github-api-auth-service';

export const githubApiAuthService = new GitHubApiAuthService(githubAccountRegistry);
