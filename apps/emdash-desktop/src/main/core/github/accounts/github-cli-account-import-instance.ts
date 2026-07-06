import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { githubIdentityClient } from '../services/github-identity-client';
import { GitHubCliAccountImportService } from './github-cli-account-import';

export const githubCliAccountImportService = new GitHubCliAccountImportService(
  providerAccountRegistry,
  new LocalExecutionContext(),
  githubIdentityClient
);
