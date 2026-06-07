import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { githubIdentityClient } from '../services/github-identity-client';
import { githubAccountRegistry } from './github-account-registry-instance';
import { GitHubCliAccountImportService } from './github-cli-account-import';

export const githubCliAccountImportService = new GitHubCliAccountImportService(
  githubAccountRegistry,
  new LocalExecutionContext(),
  githubIdentityClient
);
