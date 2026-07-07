import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { clearOctokitCache } from '../services/octokit-cache';
import { GitHubAccountService } from './github-account-service';
import { githubCliAccountImportService } from './github-cli-account-import-instance';

export const githubAccountService = new GitHubAccountService(
  providerAccountRegistry,
  githubCliAccountImportService,
  clearOctokitCache
);
