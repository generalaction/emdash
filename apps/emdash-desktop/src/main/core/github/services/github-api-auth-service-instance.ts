import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { GitHubApiAuthService } from './github-api-auth-service';

export const githubApiAuthService = new GitHubApiAuthService(providerAccountRegistry);
